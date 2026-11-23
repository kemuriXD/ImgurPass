// Album, gallery, post and video viewer. The redirect rules send Imgur page
// links here (#a/<id>, #gallery/<id>, #post/<id>, #media/<id>.<ext>). Album
// pages are read from a rimgo mirror; media load through DuckDuckGo (images)
// or rimgo (video), trying the next source whenever one fails.
import { browser } from 'wxt/browser';
import { duckDuckGoUrl, rimgoMediaUrl } from '@/lib/imgur-url';
import type { Capability } from '@/lib/instances';
import { ALL_SITES, type BackgroundMessage, type FallbacksReply } from '@/lib/messages';
import { parseRimgoPost, type Album, type AlbumMedia } from '@/lib/rimgo-parse';
import { imgurRouteUrl, parseViewerRoute, rimgoRouteUrl, type ViewerRoute } from '@/lib/viewer-route';

const MAX_PAGE_TRIES = 5;
const PAGE_TIMEOUT_MS = 12_000;
const embed = window.top !== window;
if (embed) document.body.classList.add('embed');

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const main = $('main');

// ---------- small helpers ----------

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

const send = (msg: BackgroundMessage) => browser.runtime.sendMessage(msg).catch(() => null);

async function fallbacks(capability: Capability): Promise<FallbacksReply> {
  const reply = (await send({ type: 'get-fallbacks', capability })) as FallbacksReply | null;
  return reply ?? { active: false, instances: [], allSites: false };
}

function report(instance: string, ok: boolean, capability: Capability) {
  void send({ type: 'instance-result', instance, ok, capability });
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function copyButton(label: string, text: string, className = 'btn'): HTMLButtonElement {
  const btn = h('button', { type: 'button', class: className }, label);
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
    } catch {
      btn.textContent = "Couldn't copy";
    }
    setTimeout(() => (btn.textContent = label), 1500);
  });
  return btn;
}

function setBar(route: ViewerRoute, source: string, rimgoUrl: string | null) {
  $('source').textContent = source;
  $('copy-page').replaceWith(Object.assign(copyButton('Copy Imgur link', imgurRouteUrl(route)), { id: 'copy-page' }));
  const open = $<HTMLAnchorElement>('open-rimgo');
  open.hidden = !rimgoUrl;
  if (rimgoUrl) open.href = rimgoUrl;
}

function show(...nodes: Child[]) {
  main.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
}

// ---------- media with fallback ----------

interface Source {
  src: string;
  instance?: string;
}

/** Load sources one after another until one works. */
function loadWithFallback(
  el: HTMLImageElement | HTMLVideoElement,
  sources: Source[],
  capability: Capability,
  onGiveUp: () => void,
) {
  let i = -1;
  let reported = -1;
  const current = () => sources[i];
  const next = () => {
    i++;
    const s = current();
    if (!s) return onGiveUp();
    el.src = s.src;
  };
  el.addEventListener('error', () => {
    const s = current();
    if (s?.instance) report(s.instance, false, capability);
    next();
  });
  el.addEventListener(el instanceof HTMLVideoElement ? 'loadeddata' : 'load', () => {
    const s = current();
    if (s?.instance && reported !== i) {
      reported = i;
      report(s.instance, true, capability);
    }
  });
  next();
}

function imageSources(m: { id: string; ext: string }, instances: string[]): Source[] {
  return [
    { src: duckDuckGoUrl(m.id, m.ext) },
    ...instances.map((instance) => ({ src: rimgoMediaUrl(instance, m.id, m.ext), instance })),
  ];
}

function videoSources(id: string, instances: string[]): Source[] {
  return instances.map((instance) => ({ src: rimgoMediaUrl(instance, id, 'mp4'), instance }));
}

function failedBox(what: string, rimgoUrl: string | null): HTMLElement {
  return h(
    'div',
    { class: 'item-failed' },
    h('span', {}, `This ${what} didn't load from any mirror.`),
    rimgoUrl ? h('a', { class: 'btn btn-primary btn-lg', href: rimgoUrl, target: '_blank', rel: 'noreferrer' }, 'Open on rimgo') : null,
  );
}

// ---------- lightbox ----------

const lightbox = $<HTMLDialogElement>('lightbox');
let lbItems: { media: AlbumMedia; el: HTMLImageElement | HTMLVideoElement }[] = [];
let lbIndex = 0;

function showLightbox(index: number) {
  lbIndex = index;
  const item = lbItems[index];
  if (!item) return;
  const src = item.el.currentSrc || item.el.src;
  const view =
    item.el instanceof HTMLVideoElement
      ? h('video', { src, controls: '', loop: '', autoplay: '', playsinline: '' })
      : h('img', { src, alt: item.media.title ?? `Image ${index + 1}` });
  $('lb-media').replaceChildren(view);
  $('lb-count').textContent = `${index + 1} / ${lbItems.length}`;
  $<HTMLAnchorElement>('lb-full').href = src;
  $('lb-copy').replaceWith(
    Object.assign(copyButton('Copy direct link', `https://i.imgur.com/${item.media.id}.${item.media.ext}`, 'btn btn-dark'), {
      id: 'lb-copy',
    }),
  );
  $('lb-caption').textContent = [item.media.title, item.media.description].filter(Boolean).join('\n');
  $<HTMLButtonElement>('lb-prev').disabled = index === 0;
  $<HTMLButtonElement>('lb-next').disabled = index === lbItems.length - 1;
  if (!lightbox.open) lightbox.showModal();
}

$('lb-close').addEventListener('click', () => lightbox.close());
$('lb-prev').addEventListener('click', () => showLightbox(lbIndex - 1));
$('lb-next').addEventListener('click', () => showLightbox(lbIndex + 1));
lightbox.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' && lbIndex > 0) showLightbox(lbIndex - 1);
  if (e.key === 'ArrowRight' && lbIndex < lbItems.length - 1) showLightbox(lbIndex + 1);
});
lightbox.addEventListener('close', () => $('lb-media').replaceChildren());

// ---------- album ----------

async function fetchPage(url: string): Promise<{ status: number; text: string } | null> {
  try {
    const res = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!(res.headers.get('content-type') ?? '').includes('text/html')) return null;
    return { status: res.status, text: await res.text() };
  } catch {
    return null;
  }
}

function renderAlbum(route: ViewerRoute, album: Album, instance: string, images: string[], videos: string[]) {
  const rimgoUrl = rimgoRouteUrl(instance, route);
  setBar(route, `Loaded through rimgo mirror ${hostOf(instance)}`, rimgoUrl);
  const fallbackTitle = route.kind === 'post' ? 'Imgur post' : 'Imgur album';
  document.title = `${album.title || fallbackTitle} · ImgurPass`;

  lbItems = [];
  const items = album.media.map((m, index) => {
    const label = m.title || `${m.kind === 'video' ? 'Video' : 'Image'} ${index + 1} of ${album.media.length}`;
    let mediaNode: HTMLElement;
    if (m.kind === 'video') {
      const video = h('video', { controls: '', loop: '', playsinline: '', preload: 'metadata', 'aria-label': label });
      mediaNode = video;
      lbItems.push({ media: m, el: video });
      loadWithFallback(video, videoSources(m.id, videos), 'video', () => video.replaceWith(failedBox('video', rimgoUrl)));
    } else {
      const img = h('img', { alt: label, loading: index < 3 ? 'eager' : 'lazy', decoding: 'async' });
      const button = h('button', { type: 'button', class: 'item-media', 'aria-label': `Open ${label} full screen` }, img);
      const lbIndexHere = lbItems.length;
      lbItems.push({ media: m, el: img });
      button.addEventListener('click', () => showLightbox(lbIndexHere));
      mediaNode = button;
      loadWithFallback(img, imageSources(m, images), 'image', () => button.replaceWith(failedBox('image', rimgoUrl)));
    }
    return h(
      'article',
      { class: 'item' },
      mediaNode,
      h(
        'div',
        { class: 'item-body' },
        h(
          'div',
          { class: 'item-text' },
          m.title ? h('h2', { class: 'item-title' }, m.title) : null,
          m.description ? h('p', { class: 'item-desc' }, m.description) : null,
        ),
        copyButton('Copy direct link', `https://i.imgur.com/${m.id}.${m.kind === 'video' ? 'mp4' : m.ext}`),
      ),
    );
  });

  show(
    h(
      'header',
      { class: 'head' },
      h('h1', {}, album.title || fallbackTitle),
      h('p', { class: 'muted' }, `${album.media.length} ${album.media.length === 1 ? 'item' : 'items'} · ${imgurRouteUrl(route).replace('https://', '')}`),
    ),
    ...items,
    h(
      'section',
      { class: 'notice', 'aria-label': 'If an item will not load' },
      h('h2', {}, "If an item won't load"),
      h('p', {}, 'ImgurPass already tried the other working mirrors. You can open the album on rimgo yourself, or try again later.'),
      h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary btn-lg', href: rimgoUrl, target: '_blank', rel: 'noreferrer' }, 'Open on rimgo')),
    ),
  );
}

function goToMirror(url: string) {
  if (embed) window.open(url, '_blank', 'noreferrer');
  else location.replace(url);
}

function showNeedsAccess(route: ViewerRoute, best: string | null) {
  const rimgoUrl = best ? rimgoRouteUrl(best, route) : null;
  setBar(route, 'ImgurPass', rimgoUrl);
  const grant = h('button', { type: 'button', class: 'btn btn-primary btn-lg' }, 'Show albums here');
  const open = rimgoUrl ? h('a', { class: 'btn btn-lg', href: rimgoUrl, target: embed ? '_blank' : '_self', rel: 'noreferrer' }, 'Open on rimgo now') : null;
  const countdown = h('p', {});
  show(
    h(
      'section',
      { class: 'notice' },
      h('h2', {}, 'This album opens on a rimgo mirror'),
      h('p', {}, 'To show albums here, ImgurPass needs access to all sites so it can read the album from a mirror. That also fixes Imgur images embedded on other sites.'),
      countdown,
      h('div', { class: 'actions' }, grant, open),
    ),
  );

  let timer: ReturnType<typeof setInterval> | undefined;
  if (rimgoUrl && !embed) {
    let left = 5;
    const tick = () => {
      countdown.textContent = `Opening on ${hostOf(best!)} in ${left} s.`;
      if (left-- <= 0) {
        clearInterval(timer);
        goToMirror(rimgoUrl);
      }
    };
    tick();
    timer = setInterval(tick, 1000);
  } else if (!rimgoUrl) {
    countdown.textContent = 'No rimgo mirror is working right now. Try again later.';
  }

  grant.addEventListener('click', async () => {
    clearInterval(timer);
    countdown.textContent = '';
    // Must be called straight from the click.
    if (await browser.permissions.request(ALL_SITES)) void start();
  });
}

async function loadAlbum(route: ViewerRoute) {
  const [albums, images, videos] = await Promise.all([fallbacks('album'), fallbacks('image'), fallbacks('video')]);
  const best = albums.instances[0] ?? null;
  if (!albums.allSites) return showNeedsAccess(route, best);

  for (const instance of albums.instances.slice(0, MAX_PAGE_TRIES)) {
    show(h('p', { class: 'muted' }, `Loading from ${hostOf(instance)}…`));
    const page = await fetchPage(rimgoRouteUrl(instance, route));
    if (!page) {
      report(instance, false, 'album');
      continue;
    }
    const parsed = parseRimgoPost(page.text);
    if (parsed.ok) {
      report(instance, true, 'album');
      return renderAlbum(route, parsed.album, instance, images.instances, videos.instances);
    }
    if (parsed.reason === 'not-found') {
      report(instance, true, 'album');
      setBar(route, `Checked on rimgo mirror ${hostOf(instance)}`, rimgoRouteUrl(instance, route));
      return show(
        h('section', { class: 'notice' }, h('h2', {}, 'Not found'), h('p', {}, "This album or post doesn't exist any more, or it was never public.")),
      );
    }
    report(instance, false, 'album');
  }

  // Every mirror we could read is blocked, rate limited or behind a bot check.
  // Opening one as a normal page lets the browser deal with those checks.
  const rimgoUrl = best ? rimgoRouteUrl(best, route) : null;
  setBar(route, 'ImgurPass', rimgoUrl);
  show(
    h(
      'section',
      { class: 'notice' },
      h('h2', {}, rimgoUrl ? `Opening on ${hostOf(best!)}…` : 'No mirror could load this'),
      h('p', {}, rimgoUrl ? "The mirrors wouldn't let ImgurPass read this album, so it opens on rimgo instead." : 'No rimgo mirror is working right now. Try again later.'),
      rimgoUrl ? h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary btn-lg', href: rimgoUrl, target: embed ? '_blank' : '_self', rel: 'noreferrer' }, 'Open on rimgo')) : null,
    ),
  );
  if (rimgoUrl && !embed) goToMirror(rimgoUrl);
}

// ---------- single video ----------

async function loadVideo(route: Extract<ViewerRoute, { kind: 'media' }>) {
  const videos = await fallbacks('video');
  const best = videos.instances[0] ?? null;
  const rimgoUrl = best ? rimgoRouteUrl(best, route) : null;
  setBar(route, 'Imgur video through rimgo', rimgoUrl);
  document.title = 'Imgur video · ImgurPass';
  const video = h('video', { controls: '', loop: '', autoplay: '', muted: '', playsinline: '', 'aria-label': 'Imgur video' });
  video.muted = true;
  const wrap = h('div', { class: 'solo' }, video);
  show(
    h('header', { class: 'head' }, h('h1', {}, 'Imgur video'), h('p', { class: 'muted' }, imgurRouteUrl(route).replace('https://', ''))),
    wrap,
    h('div', { class: 'actions' }, copyButton('Copy direct link', imgurRouteUrl(route))),
  );
  loadWithFallback(video, videoSources(route.id, videos.instances), 'video', () => video.replaceWith(failedBox('video', rimgoUrl)));
  video.addEventListener('loadeddata', () => {
    const src = video.currentSrc || video.src;
    $('source').textContent = `Playing through rimgo mirror ${hostOf(src)}`;
  });
}

// ---------- start ----------

async function start() {
  const route = parseViewerRoute(location.hash);
  if (!route) {
    show(h('section', { class: 'notice' }, h('h2', {}, 'Nothing to show'), h('p', {}, "This link doesn't point to an Imgur album, post or video.")));
    return;
  }
  if (route.kind === 'media') await loadVideo(route);
  else await loadAlbum(route);
}

window.addEventListener('hashchange', () => void start());
void start();
