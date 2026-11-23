// Registered at runtime on all sites once the user grants access. When an
// Imgur image or video fails to load (images are already redirected to
// DuckDuckGo, videos to a rimgo mirror, by the DNR rules), retry it through
// the other healthy rimgo mirrors in turn. A video that fails everywhere gets
// an "Open on rimgo" link.
import { browser } from 'wxt/browser';
import { parseImgurUrl, rimgoMediaUrl, unwrapDuckDuckGo } from '@/lib/imgur-url';
import type { Capability } from '@/lib/instances';
import type { BackgroundMessage, FallbacksReply } from '@/lib/messages';

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

    if (attempt?.src && attempt.src === src && attempt.instance) {
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
        queue: [...reply.instances],
        best: reply.instances[0],
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
    const next = rimgoMediaUrl(instance, attempt.id, attempt.ext);
    const capability = attempt.capability;
    attempt.instance = instance;
    attempt.src = next;
    el.dataset.imgurpass = 'retrying';
    el.addEventListener(
      el instanceof HTMLVideoElement ? 'loadeddata' : 'load',
      () => {
        if (currentSrc(el) !== next) return;
        el.dataset.imgurpass = 'rimgo';
        void send({ type: 'instance-result', instance, ok: true, capability });
      },
      { once: true },
    );
    setSrc(el, next);
  }

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
});
