/**
 * Parse a rimgo post page (album, gallery or single post) into plain data.
 * Mirrors often answer with bot checks, rate-limit pages or decoy text, so
 * anything that isn't clearly a rimgo post page returns a reason instead.
 */
import { parseImgurUrl } from './imgur-url';

export interface AlbumMedia {
  id: string;
  ext: string;
  kind: 'image' | 'video';
  title?: string;
  /** Plain text. Imgur descriptions can hold HTML; only the text is kept. */
  description?: string;
}

export interface Album {
  title: string;
  media: AlbumMedia[];
}

export type ParseResult =
  | { ok: true; album: Album }
  | { ok: false; reason: 'rate-limited' | 'not-found' | 'not-rimgo' | 'empty' };

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function mediaFromSrc(src: string | null): { id: string; ext: string } | null {
  if (!src) return null;
  // Media URLs are instance-relative ("/abc1234.jpg") or point at i.imgur.com.
  // Anything deeper (e.g. /static/icons/x.svg) is the mirror's own asset.
  const path = src.split(/[?#]/)[0]!.replace(/^https?:\/\/i\.imgur\.com/, '');
  const file = /^\/[^/]+$/.test(path) ? path.slice(1) : '';
  if (!/\.(jpe?g|png|gif|webp|avif|mp4|webm|gifv)$/i.test(file)) return null;
  const parsed = parseImgurUrl(`https://i.imgur.com/${file}`);
  return parsed?.id && parsed.ext ? { id: parsed.id, ext: parsed.ext } : null;
}

export function parseRimgoPost(html: string): ParseResult {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const pageTitle = text(doc.querySelector('title'));

  if (!/\brimgo$/i.test(pageTitle)) return { ok: false, reason: 'not-rimgo' };
  if (/rate limited/i.test(pageTitle)) return { ok: false, reason: 'rate-limited' };
  // rimgo's own error pages, not a post that happens to be titled "404 memes".
  if (/^(?:\d{3}|error|not found)\s*-\s*rimgo$/i.test(pageTitle)) return { ok: false, reason: 'not-found' };

  const container = doc.querySelector('main .break-words') ?? doc.querySelector('main');
  if (!container) return { ok: false, reason: 'not-rimgo' };

  const media: AlbumMedia[] = [];
  let pendingTitle: string | undefined;
  for (const el of Array.from(container.children)) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'h4') {
      pendingTitle = text(el) || undefined;
    } else if (tag === 'img' || tag === 'video') {
      const src = tag === 'img' ? el.getAttribute('src') : (el.querySelector('source')?.getAttribute('src') ?? el.getAttribute('src'));
      const m = mediaFromSrc(src);
      if (!m) continue;
      const kind = tag === 'video' || ['mp4', 'webm', 'gifv'].includes(m.ext) ? 'video' : 'image';
      media.push({ ...m, ext: kind === 'video' ? 'mp4' : m.ext, kind, ...(pendingTitle ? { title: pendingTitle } : {}) });
      pendingTitle = undefined;
    } else if (tag === 'p' && media.length > 0) {
      const last = media[media.length - 1]!;
      for (const br of Array.from(el.querySelectorAll('br'))) br.replaceWith('\n');
      const desc = (el.textContent ?? '')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
      if (desc && !last.description) last.description = desc;
    }
  }

  if (media.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, album: { title: text(doc.querySelector('header h1')), media } };
}
