import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRimgoPost } from '../lib/rimgo-parse';
import worker, { imageSize, toAlbum, type Env } from '../worker/src/index';

const ORIGIN = 'https://imgurpass.example.workers.dev';
const env: Env = { IMGUR_CLIENT_ID: 'testclient', ALLOW_VIDEO: 'true' };

// A post/v1 album response, shaped like what rimgo reads.
const albumJson = {
  id: 'AbCdE',
  title: 'Retro PC build',
  media: [
    {
      id: 'AbCdE12',
      name: 'case.jpg',
      mime_type: 'image/jpeg',
      type: 'image',
      ext: 'jpg',
      url: 'https://i.imgur.com/AbCdE12.jpg',
      metadata: { title: 'The case', description: 'Found at a <a href="https://example.org">flea market</a>.\nNeeds cleaning.' },
    },
    { id: 'FgHiJ34', mime_type: 'image/png', type: 'image', ext: 'png', url: 'https://i.imgur.com/FgHiJ34.png', metadata: {} },
    {
      id: 'KlMnO56',
      mime_type: 'video/mp4',
      type: 'video',
      ext: 'mp4',
      url: 'https://i.imgur.com/KlMnO56.mp4',
      metadata: { title: 'First boot', description: '<b>It</b> works. <script>alert(1)</script>' },
    },
    { id: 'PqRsT78', mime_type: 'image/gif', type: 'image', url: 'https://i.imgur.com/PqRsT78.gif', metadata: null },
    'junk',
    { id: '../etc', ext: 'jpg' },
    { id: 'UvWxY90', ext: 'exe' },
  ],
};

const expectedAlbum = {
  title: 'Retro PC build',
  media: [
    { id: 'AbCdE12', ext: 'jpg', kind: 'image', title: 'The case', description: 'Found at a flea market.\nNeeds cleaning.' },
    { id: 'FgHiJ34', ext: 'png', kind: 'image' },
    { id: 'KlMnO56', ext: 'mp4', kind: 'video', title: 'First boot', description: 'It works.' },
    { id: 'PqRsT78', ext: 'gif', kind: 'image' },
  ],
};

class StubCache {
  store = new Map<string, Response>();
  async match(req: Request) {
    return this.store.get(req.url)?.clone();
  }
  async put(req: Request, res: Response) {
    if (res.status === 206) throw new TypeError('206 not cacheable');
    this.store.set(req.url, res.clone());
  }
}

let cache: StubCache;
let waits: Promise<unknown>[];
const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function call(path: string, init?: RequestInit & { env?: Env }) {
  return worker.fetch(new Request(ORIGIN + path, init), init?.env ?? env, ctx);
}

const upstreamUrl = (n = 0) => String(fetchMock.mock.calls[n]![0]);

function png(width: number, height: number, pad = 0): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(24 + pad);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

function jpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
  // SOI, an APP0 segment, then SOF0 with the size.
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0, 0, 0, 0,
  ]);
}

function media(body: Uint8Array<ArrayBuffer> | string, type: string, status = 200, extra: Record<string, string> = {}) {
  const length = typeof body === 'string' ? body.length : body.byteLength;
  return new Response(body, { status, headers: { 'Content-Type': type, 'Content-Length': String(length), 'Set-Cookie': 'a=b', ...extra } });
}

beforeEach(() => {
  cache = new StubCache();
  waits = [];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('caches', { default: cache });
  vi.stubGlobal('DOMParser', new Window().DOMParser);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('worker: requests', () => {
  it.each(['POST', 'OPTIONS'])('rejects %s', async (method) => {
    const res = await call('/AbCdE12.jpg', { method, ...(method === 'POST' ? { body: 'x' } : {}) });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET, HEAD');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    '/',
    '/favicon.ico',
    '/AbCdE12.exe',
    '/AbCdE12.jpg/extra',
    '/ab.jpg',
    '/api/album/',
    '/api/album/AbCdE/x',
    '/api/user/AbCdE',
    '/a/AbCdE/embed',
    '/static/app.css',
    '/https://evil.example/x.jpg',
  ])('404s %s without fetching anything', async (path) => {
    const res = await call(path);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('only ever fetches i.imgur.com and api.imgur.com', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 404 }));
    for (const path of ['/AbCdE12.jpg', '/AbCdE12s.png', '/a/AbCdE', '/gallery/x-AbCdE12', '/AbCdE12', '/api/album/AbCdE']) await call(path);
    for (const [input] of fetchMock.mock.calls) expect(new URL(String(input)).host).toMatch(/^(i|api)\.imgur\.com$/);
  });
});

describe('worker: media', () => {
  it('proxies an image with long caching, no CORS and no cookies', async () => {
    fetchMock.mockResolvedValue(media(png(1800, 1200, 70000), 'image/png'));
    const res = await call('/AbCdE12.png');
    expect(upstreamUrl()).toBe('https://i.imgur.com/AbCdE12.png');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=2592000, immutable');
    // Other sites can still show it in <img>, but can't read it from scripts.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect((await res.arrayBuffer()).byteLength).toBe(70024);
  });

  it('serves the second request from the cache, keyed without the query string', async () => {
    fetchMock.mockImplementation(async () => media(png(1800, 1200), 'image/png'));
    await call('/AbCdE12.png?x=1');
    await Promise.all(waits);
    expect([...cache.store.keys()]).toEqual([`${ORIGIN}/AbCdE12.png`]);
    const res = await call('/AbCdE12.png?y=2');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('turns the removed.png redirect into a short-cached 404', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://i.imgur.com/removed.png' } }));
    const res = await call('/AbCdE12.jpg');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found' });
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never passes the removed image or the region placeholder off as success', async () => {
    fetchMock.mockResolvedValueOnce(media(png(161, 81), 'image/png'));
    expect((await call('/AbCdE12.jpg')).status).toBe(404);
    fetchMock.mockResolvedValueOnce(media(png(336, 478), 'image/png'));
    expect((await call('/BbCdE12.jpg')).status).toBe(502);
    fetchMock.mockResolvedValueOnce(media(jpeg(336, 478), 'image/jpeg'));
    expect((await call('/CbCdE12.jpg')).status).toBe(502);
    await Promise.all(waits);
    expect([...cache.store.values()].every((r) => r.status === 404)).toBe(true);
  });

  it('passes the real probe image', async () => {
    fetchMock.mockResolvedValue(media(jpeg(1800, 1200), 'image/jpeg'));
    const res = await call('/OB0y6MR.jpg');
    expect(res.status).toBe(200);
    expect(imageSize(new Uint8Array(await res.arrayBuffer()))).toBe('1800x1200');
  });

  it('maps rate limits to 429 and other failures to 502', async () => {
    fetchMock.mockResolvedValueOnce(new Response('slow down', { status: 429 }));
    const limited = await call('/AbCdE12.jpg');
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate-limited' });

    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    expect(await (await call('/AbCdE12.jpg')).json()).toEqual({ error: 'upstream' });
    fetchMock.mockResolvedValueOnce(media('<html>', 'text/html'));
    expect((await call('/AbCdE12.jpg')).status).toBe(502);
    fetchMock.mockRejectedValueOnce(new TypeError('network'));
    expect((await call('/AbCdE12.jpg')).status).toBe(502);
    await Promise.all(waits);
    expect(cache.store.size).toBe(0);
  });

  it('refuses media over the size cap', async () => {
    fetchMock.mockResolvedValueOnce(media('x', 'image/jpeg', 200, { 'Content-Length': String(26 * 1024 * 1024) }));
    expect((await call('/AbCdE12.jpg')).status).toBe(413);
    fetchMock.mockResolvedValueOnce(media('x', 'video/mp4', 200, { 'Content-Length': String(201 * 1024 * 1024) }));
    expect((await call('/AbCdE12.mp4')).status).toBe(413);
  });

  it('refuses videos over 50 MB', async () => {
    fetchMock.mockResolvedValue(media('x', 'video/mp4', 200, { 'Content-Length': String(51 * 1024 * 1024) }));
    const res = await call('/AbCdE12.mp4');
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'too-large' });
  });

  it('refuses video when ALLOW_VIDEO is off', async () => {
    for (const ext of ['mp4', 'webm', 'gifv']) {
      const res = await call(`/AbCdE12.${ext}`, { env: { ALLOW_VIDEO: 'false' } });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'video-disabled' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves gifv as mp4', async () => {
    fetchMock.mockResolvedValue(media('video', 'video/mp4'));
    const res = await call('/AbCdE12.gifv');
    expect(upstreamUrl()).toBe('https://i.imgur.com/AbCdE12.mp4');
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
  });

  it('passes Range through for video and does not cache partial answers', async () => {
    fetchMock.mockResolvedValue(media('vi', 'video/mp4', 206, { 'Content-Range': 'bytes 0-1/100' }));
    const res = await call('/AbCdE12.mp4', { headers: { Range: 'bytes=0-1' } });
    expect(new Headers(fetchMock.mock.calls[0]![1]!.headers).get('Range')).toBe('bytes=0-1');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-1/100');
    expect(await res.text()).toBe('vi');
    await Promise.all(waits);
    expect(cache.store.size).toBe(0);
  });

  it('answers HEAD without a body', async () => {
    fetchMock.mockResolvedValue(media(png(1800, 1200), 'image/png'));
    const res = await call('/AbCdE12.png', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});

describe('worker: album JSON', () => {
  it('maps an album', async () => {
    fetchMock.mockResolvedValue(Response.json(albumJson));
    const res = await call('/api/album/AbCdE');
    expect(upstreamUrl()).toBe('https://api.imgur.com/post/v1/albums/AbCdE?client_id=testclient&include=media');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(await res.json()).toEqual(expectedAlbum);
  });

  it('maps a gallery post with a video and no title', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'XyZ1234', media: [albumJson.media[2]] }));
    const res = await call('/api/gallery/XyZ1234', { env: { ALLOW_VIDEO: 'true' } });
    expect(upstreamUrl()).toBe('https://api.imgur.com/post/v1/posts/XyZ1234?client_id=546c25a59c58ad7&include=media');
    expect(await res.json()).toEqual({ title: '', media: [expectedAlbum.media[2]] });
  });

  it('keeps only plain text from HTML descriptions', () => {
    const album = toAlbum({
      media: [{ id: 'AbCdE12', ext: 'jpg', metadata: { description: '<p>One &amp; <i>two</i></p><p>three<br/>four &lt;b&gt;</p><img src=x onerror=alert(1)>' } }],
    });
    expect(album.media[0]!.description).toBe('One & two\nthree\nfour b');
  });

  it('never throws on unexpected shapes', () => {
    for (const data of [null, 'x', 1, [], { media: 'x' }, { media: [null, 1, {}, { id: 5 }] }, { title: 5, media: [] }]) {
      expect(toAlbum(data)).toEqual({ title: '', media: [] });
    }
  });

  it('maps upstream errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    const missing = await call('/api/album/AbCdE');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not-found' });

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429 }));
    expect(await (await call('/api/album/BbCdE')).json()).toEqual({ error: 'rate-limited' });
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    expect((await call('/api/album/CbCdE')).status).toBe(502);
    fetchMock.mockResolvedValueOnce(Response.json({ media: [] }));
    const empty = await call('/api/album/DbCdE');
    expect(empty.status).toBe(404);
    expect(await empty.json()).toEqual({ error: 'empty' });
  });
});

describe('worker: rimgo pages', () => {
  it('round-trips an album through the extension parser', async () => {
    fetchMock.mockResolvedValue(Response.json(albumJson));
    const res = await call('/a/AbCdE');
    expect(upstreamUrl()).toBe('https://api.imgur.com/post/v1/albums/AbCdE?client_id=testclient&include=media');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(parseRimgoPost(await res.text())).toEqual({ ok: true, album: expectedAlbum });
  });

  it('reads gallery posts by their trailing id and plain ids as posts', async () => {
    fetchMock.mockImplementation(async () => Response.json(albumJson));
    await call('/gallery/retro-pc-build-XyZ1234');
    expect(upstreamUrl(0)).toBe('https://api.imgur.com/post/v1/posts/XyZ1234?client_id=testclient&include=media');
    await call('/XyZ1234');
    expect(upstreamUrl(1)).toBe('https://api.imgur.com/post/v1/media/XyZ1234?client_id=testclient&include=media');
  });

  it('escapes everything that comes from Imgur', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        title: '<script>alert(1)</script> & "x"',
        media: [{ id: 'AbCdE12', ext: 'jpg', metadata: { title: '<img src=x onerror=alert(1)>', description: 'a &lt;b&gt; c' } }],
      }),
    );
    const html = await (await call('/a/AbCdE')).text();
    expect(html).not.toMatch(/<script>|<img src=x/);
    expect(parseRimgoPost(html)).toEqual({
      ok: true,
      album: {
        title: '<script>alert(1)</script> & "x"',
        media: [{ id: 'AbCdE12', ext: 'jpg', kind: 'image', title: '<img src=x onerror=alert(1)>', description: 'a b c' }],
      },
    });
  });

  it('does not let a post title look like an error page', async () => {
    fetchMock.mockResolvedValue(Response.json({ title: '404', media: [albumJson.media[1]] }));
    const parsed = parseRimgoPost(await (await call('/a/AbCdE')).text());
    expect(parsed).toEqual({ ok: true, album: { title: '404', media: [expectedAlbum.media[1]] } });
  });

  it('answers missing posts like rimgo', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));
    const res = await call('/gallery/AbCdE12');
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('<title>404 - rimgo</title>');
    expect(parseRimgoPost(html)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('answers rate limits like rimgo', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }));
    const res = await call('/a/AbCdE');
    expect(res.status).toBe(429);
    expect(parseRimgoPost(await res.text())).toEqual({ ok: false, reason: 'rate-limited' });
    await Promise.all(waits);
    expect(cache.store.size).toBe(0);
  });

  it('answers an empty post with a page the parser calls empty', async () => {
    fetchMock.mockResolvedValue(Response.json({ title: 'Nothing', media: [] }));
    expect(parseRimgoPost(await (await call('/a/AbCdE')).text())).toEqual({ ok: false, reason: 'empty' });
  });
});
