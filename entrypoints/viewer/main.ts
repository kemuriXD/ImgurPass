// Album, gallery, post and video viewer. The redirect rules send Imgur page
// links here (#a/<id>, #gallery/<id>, #post/<id>, #media/<id>.<ext>). Album
// pages are read from a rimgo mirror; media load through DuckDuckGo (images)
// or rimgo (video), trying the next source whenever one fails.
import { browser } from 'wxt/browser';
import { fetchHtml, type PageReply } from '@/lib/fetch-page';
import { duckDuckGoUrl, rimgoMediaUrl } from '@/lib/imgur-url';
import type { Capability } from '@/lib/instances';
import { ALL_SITES, type BackgroundMessage, type FallbacksReply } from '@/lib/messages';
import { parseRimgoPost, type Album, type AlbumMedia } from '@/lib/rimgo-parse';
import { IMGURPASS_SERVER, IMGURPASS_SERVER_HOSTS } from '@/lib/server';
import { imgurRouteUrl, parseViewerRoute, rimgoRouteUrl, type ViewerRoute } from '@/lib/viewer-route';

const MAX_PAGE_TRIES = 4;
const PAGE_TIMEOUT_MS = 8_000;
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
    // A mirror that is itself blocked serves Imgur's region placeholder.
    if (el instanceof HTMLImageElement && el.naturalWidth === 336 && el.naturalHeight === 478) {
      if (s?.instance) report(s.instance, false, capability);
      return next();
    }
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

const isFailed = (i: number) => !lbItems[i]?.el.isConnected;
function step(from: number, dir: 1 | -1): number | null {
  for (let i = from + dir; i >= 0 && i < lbItems.length; i += dir) if (!isFailed(i)) return i;
  return null;
}

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
  $<HTMLButtonElement>('lb-prev').disabled = step(index, -1) === null;
  $<HTMLButtonElement>('lb-next').disabled = step(index, 1) === null;
  if (!lightbox.open) lightbox.showModal();
}

function go(dir: 1 | -1) {
  const i = step(lbIndex, dir);
  if (i !== null) showLightbox(i);
}

$('lb-close').addEventListener('click', () => lightbox.close());
$('lb-prev').addEventListener('click', () => go(-1));
$('lb-next').addEventListener('click', () => go(1));
lightbox.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') go(-1);
  if (e.key === 'ArrowRight') go(1);
});
lightbox.addEventListener('close', () => $('lb-media').replaceChildren());

// ---------- album ----------

async function fetchPage(url: string): Promise<PageReply | null> {
  // Inside another site's iframe, Firefox gives this page that site's cookie
  // jar, so a mirror's bot-check cookie isn't sent. The background page uses
  // the normal one.
  if (embed) return ((await send({ type: 'fetch-page', url })) as PageReply | null) ?? null;
  return fetchHtml(url, PAGE_TIMEOUT_MS);
}

function renderAlbum(route: ViewerRoute, album: Album, instance: string, images: string[], videos: string[]) {
  const rimgoUrl = rimgoRouteUrl(instance, route);
  setBar(route, `Loaded through ${sourceName(instance)}`, rimgoUrl);
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

/** Bumped on every start(); stale async work checks it and stops. */
let generation = 0;
let countdownTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Navigate this tab to a mirror, unless we just did that for the same link
 * (a mirror redirecting back to imgur.com would otherwise loop forever).
 */
function goToMirror(url: string): boolean {
  const key = `imgurpass:sent:${location.hash}`;
  try {
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Storage blocked: navigate anyway.
  }
  location.replace(url);
  return true;
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

  if (rimgoUrl && !embed) {
    startCountdown(countdown, best!, rimgoUrl);
  } else if (!rimgoUrl) {
    countdown.textContent = 'No rimgo mirror is working right now. Try again later.';
  }

  grant.addEventListener('click', async () => {
    clearInterval(countdownTimer);
    countdown.textContent = '';
    // Must be called straight from the click.
    if (await browser.permissions.request(ALL_SITES)) void start();
  });
}

function showNotFound(route: ViewerRoute, instance: string) {
  setBar(route, `Checked on ${sourceName(instance)}`, rimgoRouteUrl(instance, route));
  show(h('section', { class: 'notice' }, h('h2', {}, 'Not found'), h('p', {}, "This album or post doesn't exist any more, or it was never public.")));
}

/** "the ImgurPass server" or "rimgo mirror <host>", for the bar above the album. */
function sourceName(instance: string): string {
  return instance === IMGURPASS_SERVER ? 'the ImgurPass server' : `rimgo mirror ${hostOf(instance)}`;
}

/** Mirrors whose pages the viewer may read. Without all-sites access, only the ImgurPass server's. */
async function readableMirrors(albums: FallbacksReply): Promise<string[]> {
  if (albums.allSites) return albums.instances;
  if (!albums.instances.includes(IMGURPASS_SERVER)) return [];
  const granted = await browser.permissions.contains({ origins: [IMGURPASS_SERVER_HOSTS] }).catch(() => false);
  return granted ? [IMGURPASS_SERVER] : [];
}

async function loadAlbum(route: ViewerRoute, gen: number) {
  const [albums, images, videos] = await Promise.all([fallbacks('album'), fallbacks('image'), fallbacks('video')]);
  const readable = await readableMirrors(albums);
  if (gen !== generation) return;
  const best = albums.instances[0] ?? null;
  if (readable.length === 0) return showNeedsAccess(route, best);

  // Two mirrors agreeing on "not found" is enough; one could be misconfigured.
  let notFound = 0;
  const attempts: { host: string; result: string }[] = [];
  let challenged: string | undefined;
  let notFoundAt: string | undefined;
  for (const instance of readable.slice(0, MAX_PAGE_TRIES)) {
    show(h('p', { class: 'muted' }, `Loading from ${hostOf(instance)}…`));
    const page = await fetchPage(rimgoRouteUrl(instance, route));
    if (gen !== generation) return;
    const note = (result: string) => {
      attempts.push({ host: hostOf(instance), result });
      console.info(`ImgurPass: ${hostOf(instance)}: ${result}`);
    };
    if (!page) {
      note('no answer, timed out, or not a web page');
      report(instance, false, 'album');
      continue;
    }
    const parsed = parseRimgoPost(page.text);
    if (parsed.ok && page.status === 200) {
      report(instance, true, 'album');
      return renderAlbum(route, parsed.album, instance, images.instances, videos.instances);
    }
    if (page.status === 404 && !parsed.ok && parsed.reason === 'not-found') {
      note('says the album was not found');
      report(instance, true, 'album');
      notFoundAt ??= instance;
      if (++notFound < 2) continue;
      return showNotFound(route, instance);
    }
    const why = parsed.ok
      ? `HTTP ${page.status}`
      : {
          'rate-limited': 'rate limited by Imgur',
          'not-found': `HTTP ${page.status}, error page`,
          'not-rimgo': 'answered with a bot check or another page',
          empty: 'answered with an empty album',
        }[parsed.reason];
    note(page.status === 200 || parsed.ok ? why : `HTTP ${page.status}, ${why}`);
    // A bot check is a mirror that's up and that the browser can get past.
    // It isn't the mirror failing, so don't hold it against it.
    if (!parsed.ok && parsed.reason === 'not-rimgo' && [200, 403, 503].includes(page.status)) {
      challenged ??= instance;
      continue;
    }
    report(instance, false, 'album');
  }

  // One mirror said "not found" and none of the others could answer at all:
  // believe it rather than sending the reader to a mirror that can't help.
  if (notFoundAt) return showNotFound(route, notFoundAt);
  // The ImgurPass server couldn't help, and the public mirrors need all-sites access.
  if (!albums.allSites) return showNeedsAccess(route, albums.instances.find((url) => !readable.includes(url)) ?? best);

  // Every mirror we tried is blocked, rate limited or behind a bot check.
  // Opening one as a normal page lets the browser deal with its check; after
  // that, its cookie lets the viewer read albums from it too.
  const target = challenged ?? best;
  const rimgoUrl = target ? rimgoRouteUrl(target, route) : null;
  setBar(route, 'ImgurPass', rimgoUrl);
  const countdown = h('p', {});
  const stay = h('button', { type: 'button', class: 'btn btn-lg' }, 'Stay here');
  const retry = h('button', { type: 'button', class: 'btn btn-lg' }, 'Try again');
  stay.addEventListener('click', () => {
    clearInterval(countdownTimer);
    countdown.textContent = '';
    stay.remove();
  });
  retry.addEventListener('click', () => void start());
  show(
    h(
      'section',
      { class: 'notice' },
      h('h2', {}, rimgoUrl ? "Couldn't read this album here" : 'No mirror could load this'),
      h('p', {}, rimgoUrl ? "These mirrors wouldn't let ImgurPass read the album, so it opens on rimgo instead:" : 'No rimgo mirror is working right now. Try again later.'),
      attempts.length ? h('ul', { class: 'attempts' }, ...attempts.map((a) => h('li', {}, `${a.host}: ${a.result}`))) : null,
      challenged
        ? h('p', {}, `${hostOf(challenged)} asks browsers to pass a quick check first. Once you have, its albums can show here again.`)
        : null,
      countdown,
      h(
        'div',
        { class: 'actions' },
        rimgoUrl ? h('a', { class: 'btn btn-primary btn-lg', href: rimgoUrl, target: embed ? '_blank' : '_self', rel: 'noreferrer' }, 'Open on rimgo') : null,
        rimgoUrl && !embed ? stay : null,
        retry,
      ),
    ),
  );
  if (rimgoUrl && !embed) startCountdown(countdown, target!, rimgoUrl);
}

/** Count down, then forward to the mirror (unless we just did for this link). */
function startCountdown(countdown: HTMLElement, instance: string, url: string) {
  let left = 5;
  const tick = () => {
    countdown.textContent = `Opening on ${hostOf(instance)} in ${left} s.`;
    if (left-- <= 0) {
      clearInterval(countdownTimer);
      // Sent there a moment ago and came back: don't bounce again by ourselves.
      if (!goToMirror(url)) countdown.textContent = `You were sent to ${hostOf(instance)} for this a moment ago. Use the buttons to try again.`;
    }
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

// ---------- single video ----------

async function loadVideo(route: Extract<ViewerRoute, { kind: 'media' }>, gen: number) {
  const videos = await fallbacks('video');
  if (gen !== generation) return;
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
    $('source').textContent = `Playing through ${sourceName(src)}`;
  });
}

// ---------- start ----------

async function start() {
  const gen = ++generation;
  clearInterval(countdownTimer);
  if (lightbox.open) lightbox.close();
  const route = parseViewerRoute(location.hash);
  if (!route) {
    show(h('section', { class: 'notice' }, h('h2', {}, 'Nothing to show'), h('p', {}, "This link doesn't point to an Imgur album, post or video.")));
    return;
  }
  if (route.kind === 'media') await loadVideo(route, gen);
  else await loadAlbum(route, gen);
}

window.addEventListener('hashchange', () => void start());
void start();
