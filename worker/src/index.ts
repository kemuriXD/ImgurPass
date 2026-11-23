/**
 * ImgurPass backup server. Proxies Imgur media and post data for visitors
 * Imgur blocks, and answers like a rimgo mirror so the extension can use it
 * as a custom instance. Only fetches i.imgur.com and api.imgur.com, only for
 * the paths below; everything else is a 404.
 *
 *   GET /{id}{size?}.{ext}           media from i.imgur.com
 *   GET /a/{id}                      album page (rimgo layout)
 *   GET /gallery/{slug-}{id}         gallery post page
 *   GET /{id}                        single post page
 *   GET /api/album/{id}              album as the extension's Album JSON
 *   GET /api/gallery/{id}            gallery post as Album JSON
 */

export interface Env {
  IMGUR_CLIENT_ID?: string;
  ALLOW_VIDEO?: string;
}

// Kept minimal so this file typechecks with or without the Workers types.
interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

interface AlbumMedia {
  id: string;
  ext: string;
  kind: 'image' | 'video';
  title?: string;
  description?: string;
}

interface Album {
  title: string;
  media: AlbumMedia[];
}

type Endpoint = 'albums' | 'posts' | 'media';
type Failure = 'not-found' | 'rate-limited' | 'upstream';

/** rimgo's public client id, used only when no secret is set. */
const DEFAULT_CLIENT_ID = '546c25a59c58ad7';

const MB = 1024 * 1024;
const IMAGE_CAP = 25 * MB;
// Imgur videos are short; anything bigger isn't worth the free plan's bandwidth.
const VIDEO_CAP = 50 * MB;
const JSON_CAP = 2 * MB;
/** Imgur's placeholders are tiny; only images this small get their size checked. */
const SNIFF_CAP = 64 * 1024;

const MEDIA_TTL = 'public, max-age=2592000, immutable';
// Albums rarely change, and every miss spends the shared Imgur API rate limit.
const POST_TTL = 'public, max-age=86400';
const NOT_FOUND_TTL = 'public, max-age=300';

const ID = '([A-Za-z0-9]{5,10})';
const MEDIA_PATH = /^\/([A-Za-z0-9]{5,11})\.(jpe?g|png|gif|webp|avif|mp4|webm|gifv)$/i;
const API_PATH = new RegExp(`^/api/(album|gallery)/${ID}$`);
const ALBUM_PATH = new RegExp(`^/a/${ID}/?$`);
const GALLERY_PATH = new RegExp(`^/gallery/(?:[^/]*-)?${ID}/?$`);
const POST_PATH = new RegExp(`^/${ID}/?$`);
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'];
const VIDEO_EXTS = ['mp4', 'webm', 'gifv'];

/** Imgur's "removed" image and its region-block placeholder. */
const REMOVED_SIZE = '161x81';
const PLACEHOLDER_SIZE = '336x478';

function json(status: number, body: unknown, cacheControl = 'no-store'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl },
  });
}

const notFound = () => json(404, { error: 'not-found' }, NOT_FOUND_TTL);

/**
 * Bump when cached answers change shape (headers, layout). workers.dev caches
 * can't be purged, so a new version is the only way to drop old copies.
 */
const CACHE_VERSION = 2;

/** The cache entry for a path. Never served directly, so the query string is free to use. */
const cacheKey = (origin: string, path: string) => new Request(`${origin}${path}?cache=${CACHE_VERSION}`);

function defaultCache(): Cache {
  return (globalThis as unknown as { caches: { default: Cache } }).caches.default;
}

function store(ctx: Ctx, key: Request, res: Response): void {
  ctx.waitUntil(defaultCache().put(key, res.clone()).catch(() => undefined));
}

/** Errors the stream once more than `max` bytes pass, for bodies without a Content-Length. */
function capped(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > max) controller.error(new Error('too large'));
        else controller.enqueue(chunk);
      },
    }),
  );
}

/** "WxH" of a PNG, GIF or JPEG, or null. */
export function imageSize(b: Uint8Array): string | null {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return `${v.getUint32(16)}x${v.getUint32(20)}`;
  }
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return `${b[6]! | (b[7]! << 8)}x${b[8]! | (b[9]! << 8)}`;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      const len = (b[i + 2]! << 8) | b[i + 3]!;
      // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return `${(b[i + 7]! << 8) | b[i + 8]!}x${(b[i + 5]! << 8) | b[i + 6]!}`;
      }
      i += 2 + len;
    }
  }
  return null;
}

async function handleMedia(request: Request, env: Env, ctx: Ctx, origin: string, id: string, rawExt: string): Promise<Response> {
  let ext = rawExt.toLowerCase();
  const video = VIDEO_EXTS.includes(ext);
  if (video && env.ALLOW_VIDEO !== 'true') return json(403, { error: 'video-disabled' });
  if (ext === 'gifv') ext = 'mp4';
  const file = `${id}.${ext}`;
  const key = cacheKey(origin, `/${file}`);
  const range = video ? request.headers.get('Range') : null;

  if (!range) {
    const hit = await defaultCache().match(key);
    if (hit) return hit;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`https://i.imgur.com/${file}`, {
      redirect: 'manual',
      headers: range ? { Range: range } : {},
    });
  } catch {
    return json(502, { error: 'upstream' });
  }

  const gone = () => {
    const res = notFound();
    store(ctx, key, res);
    return res;
  };
  // Imgur redirects missing media to removed.png.
  if ((upstream.status >= 300 && upstream.status < 400) || upstream.status === 404 || upstream.status === 410) return gone();
  if (upstream.status === 429) return json(429, { error: 'rate-limited' });
  if (upstream.status !== 200 && upstream.status !== 206) return json(502, { error: 'upstream' });

  const type = upstream.headers.get('Content-Type') ?? '';
  if (!/^(image|video)\//i.test(type) || !upstream.body) return json(502, { error: 'upstream' });

  const cap = video ? VIDEO_CAP : IMAGE_CAP;
  const length = upstream.headers.get('Content-Length');
  if (length !== null && Number(length) > cap) {
    await upstream.body.cancel().catch(() => undefined);
    return json(413, { error: 'too-large' });
  }

  const headers: Record<string, string> = { 'Content-Type': type, 'Cache-Control': MEDIA_TTL };
  if (length !== null) headers['Content-Length'] = length;
  if (video) headers['Accept-Ranges'] = 'bytes';
  const contentRange = upstream.headers.get('Content-Range');
  if (upstream.status === 206 && contentRange) headers['Content-Range'] = contentRange;

  let body: ReadableStream<Uint8Array> | ArrayBuffer;
  if (!video && length !== null && Number(length) <= SNIFF_CAP) {
    // Never pass Imgur's placeholders off as the real image.
    body = await upstream.arrayBuffer().catch(() => new ArrayBuffer(0));
    if (body.byteLength === 0) return json(502, { error: 'upstream' });
    const size = imageSize(new Uint8Array(body));
    if (size === REMOVED_SIZE) return gone();
    if (size === PLACEHOLDER_SIZE) return json(502, { error: 'upstream' });
  } else {
    body = capped(upstream.body, cap);
  }

  const res = new Response(body, { status: upstream.status, headers });
  if (res.status === 200) store(ctx, key, res);
  return res;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Imgur descriptions can hold HTML; keep the text, one line per paragraph or <br>. */
export function plainText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[<>]/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function mediaItem(raw: unknown): AlbumMedia | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const id = str(m.id);
  if (!id || !/^[A-Za-z0-9]{5,10}$/.test(id)) return null;

  const mime = (str(m.mime_type) ?? '').toLowerCase();
  const fromUrl = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(str(m.url) ?? '')?.[1];
  const ext = (str(m.ext) ?? fromUrl ?? mime.split('/')[1] ?? '').replace(/^\./, '').toLowerCase();
  const video = m.type === 'video' || mime.startsWith('video/') || VIDEO_EXTS.includes(ext);
  if (!video && !IMAGE_EXTS.includes(ext)) return null;

  const item: AlbumMedia = { id, ext: video ? 'mp4' : ext, kind: video ? 'video' : 'image' };
  const meta = m.metadata && typeof m.metadata === 'object' ? (m.metadata as Record<string, unknown>) : {};
  const title = str(meta.title)?.replace(/\s+/g, ' ').trim();
  if (title) item.title = title;
  const description = plainText(str(meta.description) ?? '');
  if (description) item.description = description;
  return item;
}

/** Maps Imgur's post/v1 album, post or media response to the extension's Album. Never throws. */
export function toAlbum(data: unknown): Album {
  const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const media = Array.isArray(d.media) ? d.media.map(mediaItem).filter((m): m is AlbumMedia => m !== null) : [];
  return { title: (str(d.title) ?? '').replace(/\s+/g, ' ').trim(), media };
}

async function fetchAlbum(env: Env, endpoint: Endpoint, id: string): Promise<Album | Failure> {
  const clientId = encodeURIComponent(env.IMGUR_CLIENT_ID || DEFAULT_CLIENT_ID);
  let upstream: Response;
  try {
    upstream = await fetch(`https://api.imgur.com/post/v1/${endpoint}/${id}?client_id=${clientId}&include=media`, {
      redirect: 'manual',
      headers: { Accept: 'application/json' },
    });
  } catch {
    return 'upstream';
  }
  if (upstream.status === 404) return 'not-found';
  if (upstream.status === 429) return 'rate-limited';
  if (upstream.status !== 200) return 'upstream';
  if (Number(upstream.headers.get('Content-Length') ?? 0) > JSON_CAP) return 'upstream';
  try {
    const body = await upstream.text();
    if (body.length > JSON_CAP) return 'upstream';
    return toAlbum(JSON.parse(body));
  } catch {
    return 'upstream';
  }
}

async function cached(key: Request, ctx: Ctx, make: () => Promise<Response>): Promise<Response> {
  const hit = await defaultCache().match(key);
  if (hit) return hit;
  const res = await make();
  if (res.status === 200 || res.status === 404) store(ctx, key, res);
  return res;
}

function handleApi(env: Env, ctx: Ctx, origin: string, kind: string, id: string): Promise<Response> {
  return cached(cacheKey(origin, `/api/${kind}/${id}`), ctx, async () => {
    const album = await fetchAlbum(env, kind === 'album' ? 'albums' : 'posts', id);
    if (album === 'not-found') return notFound();
    if (typeof album === 'string') return json(album === 'rate-limited' ? 429 : 502, { error: album });
    if (album.media.length === 0) return json(404, { error: 'empty' }, NOT_FOUND_TTL);
    return json(200, album, POST_TTL);
  });
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(status: number, title: string, header: string, items: string, cacheControl: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)} - rimgo</title>
<style>body{font-family:sans-serif;max-width:48rem;margin:0 auto;padding:1rem;background:#1e293b;color:#fff}img,video{display:block;max-width:100%;margin:.5rem 0}</style>
</head>
<body>
<header><h1>${escapeHtml(header)}</h1></header>
<main>
<div class="break-words">
${items}</div>
</main>
</body>
</html>
`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': cacheControl,
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** A <title> that can't be mistaken for one of rimgo's error pages. */
function safeTitle(title: string): string {
  return !title || /^(?:\d{3}|error|not found)$/i.test(title) || /rate limited/i.test(title) ? 'Imgur post' : title;
}

export function renderAlbum(album: Album): string {
  return album.media
    .map((m) => {
      const parts: string[] = [];
      if (m.title) parts.push(`<h4>${escapeHtml(m.title)}</h4>`);
      parts.push(
        m.kind === 'video'
          ? `<video controls loop playsinline><source type="video/mp4" src="/${m.id}.mp4"></video>`
          : `<img src="/${m.id}.${m.ext}" loading="lazy" alt="">`,
      );
      if (m.description) parts.push(`<p>${m.description.split('\n').map(escapeHtml).join('<br>')}</p>`);
      return parts.join('\n') + '\n';
    })
    .join('');
}

function handlePage(env: Env, ctx: Ctx, origin: string, endpoint: Endpoint, path: string, id: string): Promise<Response> {
  return cached(cacheKey(origin, path), ctx, async () => {
    const album = await fetchAlbum(env, endpoint, id);
    if (album === 'not-found') return page(404, '404', 'Not found', '', NOT_FOUND_TTL);
    if (album === 'rate-limited') return page(429, 'Rate limited by Imgur', 'Rate limited by Imgur', '', 'no-store');
    if (album === 'upstream') return page(502, 'Error', 'Imgur could not be reached', '', 'no-store');
    return page(200, safeTitle(album.title), album.title, renderAlbum(album), POST_TTL);
  });
}

async function route(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  let m: RegExpExecArray | null;
  if ((m = MEDIA_PATH.exec(path))) return handleMedia(request, env, ctx, url.origin, m[1]!, m[2]!);
  if ((m = API_PATH.exec(path))) return handleApi(env, ctx, url.origin, m[1]!, m[2]!);
  if ((m = ALBUM_PATH.exec(path))) return handlePage(env, ctx, url.origin, 'albums', `/a/${m[1]}`, m[1]!);
  if ((m = GALLERY_PATH.exec(path))) return handlePage(env, ctx, url.origin, 'posts', `/gallery/${m[1]}`, m[1]!);
  if ((m = POST_PATH.exec(path))) return handlePage(env, ctx, url.origin, 'media', `/${m[1]}`, m[1]!);
  return notFound();
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const res = json(405, { error: 'method-not-allowed' });
      res.headers.set('Allow', 'GET, HEAD');
      return res;
    }
    const res = await route(request, env, ctx);
    if (request.method === 'HEAD') {
      // Not awaited: a cancelled tee branch only settles once the cache copy is read.
      void res.body?.cancel().catch(() => undefined);
      return new Response(null, { status: res.status, headers: res.headers });
    }
    return res;
  },
};
