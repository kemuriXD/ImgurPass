// Registered at runtime on the sites the user allowed. When an Imgur image or
// video fails to load (the DNR rules already sent images to DuckDuckGo or a
// rimgo mirror, and videos to a rimgo mirror), retry it through the other
// sources in turn. A video that fails everywhere gets an "Open on rimgo" link.
// The toolbar popup also asks it how many images on the page were fixed.
import { browser } from 'wxt/browser';
import { duckDuckGoUrl, parseImgurUrl, rimgoMediaUrl, unwrapDuckDuckGo } from '@/lib/imgur-url';
import type { Capability } from '@/lib/instances';
import {
  DDG_SOURCE,
  type BackgroundMessage,
  type FallbacksReply,
  type PageStats,
  type PageStatsMessage,
} from '@/lib/messages';

const PLACEHOLDER = { width: 336, height: 478 };

type Media = HTMLImageElement | HTMLVideoElement;

interface Attempt {
  id: string;
  ext: string;
  capability: 'image' | 'video';
  queue: string[];
  /** First instance in the list, for the "Open on rimgo" link. */
  best?: string;
  /** Instance currently being tried, and the src we set for it. */
  instance?: string;
  src?: string;
}

export default defineUnlistedScript(() => {
  const MAX_ROUNDS = 3;
  const attempts = new WeakMap<Media, Attempt>();
  const rounds = new WeakMap<Media, number>();
  const cache = new Map<Capability, { at: number; reply: Promise<FallbacksReply | null> }>();

  const send = (msg: BackgroundMessage) => browser.runtime.sendMessage(msg).catch(() => null);

  function getFallbacks(capability: 'image' | 'video'): Promise<FallbacksReply | null> {
    const cached = cache.get(capability);
    if (cached && Date.now() - cached.at < 60_000) return cached.reply;
    const reply = send({ type: 'get-fallbacks', capability }) as Promise<FallbacksReply | null>;
    const entry = { at: Date.now(), reply };
    cache.set(capability, entry);
    // Don't cache a missing reply (background still starting): ask again next time.
    void reply.then((r) => {
      if (!r && cache.get(capability) === entry) cache.delete(capability);
    });
    return reply;
  }

  const currentSrc = (el: Media) =>
    el.currentSrc || el.getAttribute('src') || (el instanceof HTMLVideoElement ? el.querySelector('source')?.src : '') || '';

  function setSrc(el: Media, src: string) {
    // Some mirrors refuse hotlinks with a foreign Referer.
    if (el instanceof HTMLImageElement) {
      el.referrerPolicy = 'no-referrer';
      el.removeAttribute('srcset');
      el.removeAttribute('sizes');
      if (el.parentElement instanceof HTMLPictureElement) {
        for (const source of el.parentElement.querySelectorAll('source')) source.remove();
      }
      el.src = src;
    } else {
      for (const source of el.querySelectorAll('source')) source.remove();
      el.src = src;
      el.load();
    }
  }

  function addRimgoLink(video: HTMLVideoElement, href: string) {
    if (video.nextElementSibling?.hasAttribute('data-imgurpass-link')) return;
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.textContent = 'Open video on rimgo';
    a.setAttribute('data-imgurpass-link', '');
    a.style.cssText =
      'display:inline-block;margin:6px 0;padding:8px 12px;border-radius:8px;background:#4B5BDC;color:#fff;font:600 13px system-ui,sans-serif;text-decoration:none';
    video.insertAdjacentElement('afterend', a);
  }

  async function onError(el: Media) {
    const src = currentSrc(el);
    let attempt = attempts.get(el);

    if (attempt?.src && attempt.src === src && attempt.instance && attempt.instance !== DDG_SOURCE) {
      void send({ type: 'instance-result', instance: attempt.instance, ok: false, capability: attempt.capability });
    } else {
      // New element (or the page changed its src): is it Imgur media?
      const parsed = parseImgurUrl(unwrapDuckDuckGo(src) ?? src);
      if (!parsed?.id || !parsed.ext) return;
      const capability = el instanceof HTMLVideoElement ? 'video' : 'image';
      if (capability === 'image' && parsed.kind !== 'image') return;
      if (capability === 'video' && parsed.kind !== 'video') return;
      // Pages that keep resetting src would otherwise restart the rotation forever.
      const round = (rounds.get(el) ?? 0) + 1;
      if (round > MAX_ROUNDS) return;
      rounds.set(el, round);
      const reply = await getFallbacks(capability);
      if (!reply?.active) return;
      attempt = {
        id: parsed.id,
        ext: capability === 'video' ? 'mp4' : parsed.ext,
        capability,
        // DuckDuckGo only proxies images.
        queue: reply.instances.filter((s) => capability === 'image' || s !== DDG_SOURCE),
        best: reply.instances.find((s) => s !== DDG_SOURCE),
      };
      attempts.set(el, attempt);
    }

    const instance = attempt.queue.shift();
    if (!instance) {
      el.dataset.imgurpass = 'failed';
      attempt.instance = attempt.src = undefined;
      if (el instanceof HTMLVideoElement && attempt.best) {
        addRimgoLink(el, rimgoMediaUrl(attempt.best, attempt.id, 'mp4'));
      }
      return;
    }
    const next =
      instance === DDG_SOURCE ? duckDuckGoUrl(attempt.id, attempt.ext) : rimgoMediaUrl(instance, attempt.id, attempt.ext);
    const capability = attempt.capability;
    attempt.instance = instance;
    attempt.src = next;
    el.dataset.imgurpass = 'retrying';
    el.addEventListener(
      el instanceof HTMLVideoElement ? 'loadeddata' : 'load',
      () => {
        if (currentSrc(el) !== next) return;
        // A mirror that is itself blocked serves Imgur's region placeholder: try the next one.
        if (isPlaceholder(el)) {
          void onError(el);
          return;
        }
        if (instance === DDG_SOURCE) {
          el.dataset.imgurpass = DDG_SOURCE;
          return;
        }
        el.dataset.imgurpass = 'rimgo';
        void send({ type: 'instance-result', instance, ok: true, capability });
      },
      { once: true },
    );
    setSrc(el, next);
  }

  const isPlaceholder = (el: Media) =>
    el instanceof HTMLImageElement && el.naturalWidth === PLACEHOLDER.width && el.naturalHeight === PLACEHOLDER.height;

  /** Count the Imgur media on this page by where it ended up loading from. */
  function pageStats(imageVia: PageStatsMessage['imageVia']): PageStats {
    const stats: PageStats = { duckduckgo: 0, rimgo: 0, failed: 0 };
    for (const el of document.querySelectorAll<Media>('img, video')) {
      const state = el.dataset.imgurpass;
      if (state === 'failed') stats.failed++;
      else if (state === 'rimgo') stats.rimgo++;
      else if (state === DDG_SOURCE) stats.duckduckgo++;
      else if (state === 'retrying') continue;
      else {
        // Untouched: loaded wherever the redirect rules sent it, if it's Imgur at all.
        const src = currentSrc(el);
        const parsed = parseImgurUrl(unwrapDuckDuckGo(src) ?? src);
        if (!parsed?.id || !parsed.ext) continue;
        if (el instanceof HTMLImageElement) {
          if (!el.complete || el.naturalWidth === 0 || isPlaceholder(el)) continue;
          stats[imageVia === 'rimgo' ? 'rimgo' : 'duckduckgo']++;
        } else if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          stats.rimgo++;
        }
      }
    }
    return stats;
  }

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as PageStatsMessage | null;
    // The popup asks the top frame only.
    if (msg?.type !== 'page-stats' || window !== window.top) return;
    sendResponse(pageStats(msg.imageVia));
  });

  // Load errors don't bubble, but they can be caught on the way down. A
  // <video>'s <source> children fire their own error events.
  document.addEventListener(
    'error',
    (event) => {
      const t = event.target;
      if (t instanceof HTMLImageElement || t instanceof HTMLVideoElement) void onError(t);
      else if (t instanceof HTMLSourceElement && t.parentElement instanceof HTMLVideoElement) {
        // Only act once the last source has failed.
        const sources = t.parentElement.querySelectorAll('source');
        if (sources[sources.length - 1] === t) void onError(t.parentElement);
      }
    },
    true,
  );

  // Imgur's embed code is a <blockquote class="imgur-embed-pub" data-id="a/ID">
  // plus a script from s.imgur.com that swaps it for an iframe. Where Imgur is
  // blocked that script never loads, so swap it for the viewer ourselves.
  function embedRoute(dataId: string | undefined): string | null {
    const album = /^a\/([A-Za-z0-9]{5,10})$/.exec(dataId ?? '');
    if (album) return `a/${album[1]}`;
    const post = /^([A-Za-z0-9]{5,10})$/.exec(dataId ?? '');
    return post ? `post/${post[1]}` : null;
  }

  async function replaceEmbeds() {
    const quotes = [...document.querySelectorAll<HTMLElement>('blockquote.imgur-embed-pub[data-id]')];
    if (quotes.length === 0 || !(await getFallbacks('image'))?.active) return;
    for (const quote of quotes) {
      const route = embedRoute(quote.dataset.id);
      if (!route || !quote.isConnected) continue;
      const frame = document.createElement('iframe');
      frame.src = browser.runtime.getURL(`/viewer.html#${route}`);
      frame.title = quote.textContent?.trim() || 'Imgur post';
      frame.loading = 'lazy';
      frame.setAttribute('data-imgurpass-embed', '');
      frame.style.cssText = 'display:block;width:100%;max-width:540px;height:500px;border:0;border-radius:8px';
      quote.replaceWith(frame);
    }
  }

  let pending = false;
  const scheduleEmbeds = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      void replaceEmbeds();
    }, 200);
  };
  const watch = () => {
    scheduleEmbeds();
    new MutationObserver(scheduleEmbeds).observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true });
  else watch();
});
