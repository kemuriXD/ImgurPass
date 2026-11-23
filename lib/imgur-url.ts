/**
 * Pure helpers for recognising Imgur URLs and building proxy/mirror URLs.
 * No browser APIs here so everything is unit-testable.
 */

export type ImgurKind = 'image' | 'video' | 'album' | 'gallery' | 'post' | 'other';

export interface ImgurUrl {
  kind: ImgurKind;
  /** Media, album or post id. Absent for kind "other". */
  id?: string;
  /** Lower-cased extension for direct media ("jpg", "gifv", ...). */
  ext?: string;
  /** Gallery slug without the trailing id, e.g. "funny-cat". */
  slug?: string;
}

export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'tif', 'tiff'] as const;
export const VIDEO_EXTS = ['gifv', 'mp4', 'webm'] as const;

const ID_RE = /^[A-Za-z0-9]{5,10}$/;
const MEDIA_HOSTS = new Set(['i.imgur.com']);
const PAGE_HOSTS = new Set(['imgur.com', 'www.imgur.com', 'm.imgur.com']);

/** First path segments on imgur.com that are site pages, not post ids. */
export const RESERVED_PATHS = [
  'about', 'account', 'apps', 'blog', 'contact', 'download', 'emerald', 'explore',
  'favorites', 'gallery', 'help', 'hot', 'jobs', 'logout', 'memegen', 'messages',
  'new', 'notifications', 'popular', 'privacy', 'random', 'register',
  'removalrequest', 'rules', 'search', 'settings', 'signin', 'signout', 'topics',
  'tos', 'top', 'trending', 'upload', 'user', 'vidgif',
] as const;
const RESERVED = new Set<string>(RESERVED_PATHS);

function toUrl(input: string | URL): URL | null {
  if (input instanceof URL) return input;
  const raw = input.trim();
  try {
    return new URL(raw.startsWith('//') ? `https:${raw}` : raw);
  } catch {
    return null;
  }
}

function classifyMedia(file: string): ImgurUrl {
  const dot = file.lastIndexOf('.');
  const id = dot === -1 ? file : file.slice(0, dot);
  if (!ID_RE.test(id)) return { kind: 'other' };
  if (dot === -1) return { kind: 'image', id, ext: 'jpg' };

  // Strip junk some sites append, e.g. "jpg:large" or "jpg_original".
  const ext = (file.slice(dot + 1).toLowerCase().match(/^[a-z0-9]+/)?.[0] ?? '');
  if ((VIDEO_EXTS as readonly string[]).includes(ext)) return { kind: 'video', id, ext };
  if ((IMAGE_EXTS as readonly string[]).includes(ext)) return { kind: 'image', id, ext };
  // i.imgur.com serves the image for any extension, so fall back to jpg.
  return { kind: 'image', id, ext: 'jpg' };
}

export function parseImgurUrl(input: string | URL): ImgurUrl | null {
  const url = toUrl(input);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (MEDIA_HOSTS.has(host)) {
    if (parts.length !== 1) return { kind: 'other' };
    return classifyMedia(parts[0]!);
  }

  if (!PAGE_HOSTS.has(host)) return null;
  const [first, second, third] = parts;
  if (!first) return { kind: 'other' };

  if (first === 'a' && second && ID_RE.test(second)) return { kind: 'album', id: second };

  if (first === 'gallery' && second) {
    const dash = second.lastIndexOf('-');
    const id = dash === -1 ? second : second.slice(dash + 1);
    if (!ID_RE.test(id)) return { kind: 'other' };
    return dash === -1 ? { kind: 'gallery', id } : { kind: 'gallery', id, slug: second.slice(0, dash) };
  }

  // /t/<tag>/<id> and /r/<sub>/<id> are post views.
  if ((first === 't' || first === 'r') && third && parts.length === 3 && ID_RE.test(third)) {
    return { kind: 'post', id: third };
  }

  if (parts.length === 1) {
    // imgur.com/<id>.<ext> serves the same file as i.imgur.com.
    if (first.includes('.')) return classifyMedia(first);
    if (!RESERVED.has(first.toLowerCase()) && ID_RE.test(first)) return { kind: 'post', id: first };
  }

  return { kind: 'other' };
}

/** Canonical https://i.imgur.com/<id>.<ext> URL, without query or fragment. */
export function directMediaUrl(id: string, ext: string): string {
  return `https://i.imgur.com/${id}.${ext}`;
}

export const DDG_PROXY_PREFIX = 'https://external-content.duckduckgo.com/iu/?u=';

/** DuckDuckGo image proxy URL for an Imgur image. Images only: no video or albums. */
export function duckDuckGoUrl(id: string, ext: string): string {
  return DDG_PROXY_PREFIX + encodeURIComponent(directMediaUrl(id, ext));
}

/** Normalise an instance base URL: https only, no trailing slash, no path. Returns null if unusable. */
export function normalizeInstance(base: string): string | null {
  const url = toUrl(base.includes('://') ? base : `https://${base}`);
  if (!url || url.protocol !== 'https:' || !url.hostname.includes('.')) return null;
  if (url.username || url.password) return null;
  return url.origin;
}

export function rimgoMediaUrl(instance: string, id: string, ext: string): string {
  return `${instance.replace(/\/+$/, '')}/${id}.${ext}`;
}

export function rimgoAlbumUrl(instance: string, id: string): string {
  return `${instance.replace(/\/+$/, '')}/a/${id}`;
}

export function rimgoGalleryUrl(instance: string, id: string, slug?: string): string {
  return `${instance.replace(/\/+$/, '')}/gallery/${slug ? `${slug}-${id}` : id}`;
}

/** If url is a DuckDuckGo proxy URL wrapping an Imgur URL, return the inner URL. */
export function unwrapDuckDuckGo(url: string): string | null {
  if (!url.startsWith(DDG_PROXY_PREFIX)) return null;
  try {
    return new URL(url).searchParams.get('u');
  } catch {
    return null;
  }
}
