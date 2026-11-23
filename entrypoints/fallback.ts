// Registered at runtime on all sites once the user grants access. When an
// Imgur image (already redirected to DuckDuckGo by the DNR rules) fails to
// load, retry it through healthy rimgo instances in turn.
import { browser } from 'wxt/browser';
import { parseImgurUrl, rimgoMediaUrl, unwrapDuckDuckGo } from '@/lib/imgur-url';
import type { BackgroundMessage, FallbacksReply } from '@/lib/messages';

interface Attempt {
  id: string;
  ext: string;
  queue: string[];
  /** Instance currently being tried, and the src we set for it. */
  instance?: string;
  src?: string;
}

export default defineUnlistedScript(() => {
  const MAX_ROUNDS = 3;
  const attempts = new WeakMap<HTMLImageElement, Attempt>();
  const rounds = new WeakMap<HTMLImageElement, number>();
  let fallbacks: { at: number; reply: Promise<FallbacksReply | null> } | null = null;

  const send = (msg: BackgroundMessage) => browser.runtime.sendMessage(msg).catch(() => null);

  function getFallbacks(): Promise<FallbacksReply | null> {
    if (!fallbacks || Date.now() - fallbacks.at > 60_000) {
      const reply = send({ type: 'get-fallbacks' }) as Promise<FallbacksReply | null>;
      const entry = { at: Date.now(), reply };
      fallbacks = entry;
      // Don't cache a missing reply (background still starting): ask again next time.
      void reply.then((r) => {
        if (!r && fallbacks === entry) fallbacks = null;
      });
    }
    return fallbacks.reply;
  }

  function setSrc(img: HTMLImageElement, src: string) {
    // Some mirrors refuse hotlinks with a foreign Referer.
    img.referrerPolicy = 'no-referrer';
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    if (img.parentElement instanceof HTMLPictureElement) {
      for (const source of img.parentElement.querySelectorAll('source')) source.remove();
    }
    img.src = src;
  }

  async function onError(img: HTMLImageElement) {
    const src = img.currentSrc || img.src;
    let attempt = attempts.get(img);

    if (attempt?.src === src && attempt.instance) {
      void send({ type: 'instance-result', instance: attempt.instance, ok: false });
    } else {
      // New image (or the page changed its src): is it an Imgur image?
      const parsed = parseImgurUrl(unwrapDuckDuckGo(src) ?? src);
      if (parsed?.kind !== 'image' || !parsed.id || !parsed.ext) return;
      // Pages that keep resetting src would otherwise restart the rotation forever.
      const round = (rounds.get(img) ?? 0) + 1;
      if (round > MAX_ROUNDS) return;
      rounds.set(img, round);
      const reply = await getFallbacks();
      if (!reply?.active) return;
      attempt = { id: parsed.id, ext: parsed.ext, queue: [...reply.instances] };
      attempts.set(img, attempt);
    }

    const instance = attempt.queue.shift();
    if (!instance) {
      img.dataset.imgurpass = 'failed';
      attempt.instance = attempt.src = undefined;
      return;
    }
    const next = rimgoMediaUrl(instance, attempt.id, attempt.ext);
    attempt.instance = instance;
    attempt.src = next;
    img.dataset.imgurpass = 'retrying';
    img.addEventListener(
      'load',
      () => {
        if ((img.currentSrc || img.src) !== next) return;
        img.dataset.imgurpass = 'rimgo';
        void send({ type: 'instance-result', instance, ok: true });
      },
      { once: true },
    );
    setSrc(img, next);
  }

  // Load errors don't bubble, but they can be caught on the way down.
  document.addEventListener(
    'error',
    (event) => {
      if (event.target instanceof HTMLImageElement) void onError(event.target);
    },
    true,
  );
});
