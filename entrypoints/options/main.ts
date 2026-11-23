import '@/assets/ui.css';
import { browser } from 'wxt/browser';
import { PLACEHOLDER_SIZE, PROBE_ID, PROBE_SIZE } from '@/lib/detect';
import { normalizeInstance, rimgoMediaUrl } from '@/lib/imgur-url';
import { ALL_SITES, type StatusReply } from '@/lib/messages';
import { loadImageSize } from '@/lib/probe';
import { sitePattern } from '@/lib/sites';
import { getSettings, type ImageSource, type Settings } from '@/lib/state';
import { explainReason, formatWhen } from '@/lib/status-text';
import { $, ask, h, hostLabel, onExternalChange, updateSettings } from '@/lib/ui';

const SOURCES: Record<ImageSource, { title: string; desc: string }> = {
  duckduckgo: { title: 'DuckDuckGo image proxy', desc: 'Images only. Fast and full size.' },
  rimgo: { title: 'Public rimgo mirrors', desc: 'Images, videos and albums. Working mirrors in random order.' },
};
const CUSTOM_HELP = 'Used after the public mirrors. Run your own, or use one you trust.';

let status: StatusReply | null = null;
let settings: Settings;

const checkbox = (id: string) => $<HTMLInputElement>(id);

function chevron(direction: 'up' | 'down'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', direction === 'down' ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function statusTitle(s: StatusReply): string {
  switch (s.detection.status) {
    case 'blocked':
      return 'Imgur is blocked on this connection';
    case 'unblocked':
      return "Imgur isn't blocked on this connection";
    default:
      return s.detection.checkedAt ? "Couldn't tell whether Imgur is blocked" : 'Checking whether Imgur is blocked';
  }
}

function renderStatus(s: StatusReply) {
  $('status-h').textContent = statusTitle(s);
  const state = !settings.enabled
    ? 'ImgurPass is off.'
    : s.active
      ? 'Unblocking is on.'
      : 'Unblocking stays off until Imgur gets blocked.';
  const checked = s.detection.checkedAt ? `Checked ${formatWhen(s.detection.checkedAt)}.` : '';
  $('status-body').textContent = [state, explainReason(s.detection.reason), checked].filter(Boolean).join(' ');
}

function renderAccess(s: StatusReply) {
  const labels = [...new Set(s.missingHosts.map(hostLabel))];
  $('access-warning').hidden = labels.length === 0;
  $('access-body').textContent =
    `Your browser's site access for ImgurPass leaves out ${labels.join(', ')}. ` +
    "Nothing gets unblocked until they're allowed.";
  checkbox('everywhere').checked = s.allSites;

  $('single-sites').hidden = s.grantedSites.length === 0;
  $('single-list').replaceChildren(
    ...s.grantedSites.map((host) => {
      const remove = h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Remove ${host}`, text: 'Remove' });
      remove.addEventListener('click', () => {
        void browser.permissions.remove({ origins: [sitePattern(host)] }).then(render);
      });
      return h('li', { class: 'row' }, h('span', { class: 'row-main row-title', text: host }), remove);
    }),
  );
}

function renderPaused() {
  $('paused-empty').hidden = settings.pausedSites.length > 0;
  $('paused-list').hidden = settings.pausedSites.length === 0;
  $('paused-list').replaceChildren(
    ...settings.pausedSites.map((host) => {
      const resume = h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Resume on ${host}`, text: 'Resume' });
      resume.addEventListener('click', async () => {
        settings = await updateSettings({ pausedSites: settings.pausedSites.filter((p) => p !== host) });
        renderPaused();
      });
      return h('li', { class: 'row' }, h('span', { class: 'row-main row-title', text: host }), resume);
    }),
  );
}

function renderSources(s: StatusReply, focus?: ImageSource) {
  const order: ImageSource[] = settings.imageSource === 'rimgo' ? ['rimgo', 'duckduckgo'] : ['duckduckgo', 'rimgo'];
  const rows = order.map((source, i) => {
    const { title, desc } = SOURCES[source];
    const dir = i === 0 ? 'down' : 'up';
    const move = h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': `Move ${title} ${dir}` });
    move.append(chevron(dir));
    move.addEventListener('click', async () => {
      settings = await updateSettings({ imageSource: order[1]! });
      renderSources(s, source);
    });
    const row = h(
      'li',
      { class: 'row' },
      h('span', { class: 'rank', text: String(i + 1) }),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: title }), h('span', { class: 'row-desc', text: desc })),
      move,
    );
    if (source === focus) queueMicrotask(() => move.focus());
    return row;
  });
  const custom = normalizeInstance(settings.customInstance);
  rows.push(
    h(
      'li',
      { class: 'row' },
      h('span', { class: 'rank', text: '3' }),
      h(
        'span',
        { class: 'row-main' },
        h('span', { class: 'row-title', text: 'Your own mirror' }),
        h('span', { class: 'row-desc', text: custom ?? 'Not set' }),
      ),
    ),
  );
  $('sources').replaceChildren(...rows);

  const updated = s.listUpdatedAt ? `list updated ${formatWhen(s.listUpdatedAt).replace(/ at .*/, '')}` : 'built-in list';
  $('mirror-count').textContent = `${s.healthyInstances} of ${s.knownInstances} rimgo mirrors working · ${updated}`;
}

async function render() {
  [status, settings] = await Promise.all([ask({ type: 'get-status' }), getSettings()]);
  checkbox('enabled').checked = settings.enabled;
  checkbox('always').checked = settings.alwaysProxy;
  checkbox('nodata').checked = settings.onlyNoDataInstances;
  checkbox('server').checked = settings.useImgurPassServer;
  // Don't overwrite what someone is typing.
  if (document.activeElement !== $('custom')) $<HTMLInputElement>('custom').value = settings.customInstance;
  renderPaused();
  if (!status) return;
  renderStatus(status);
  renderAccess(status);
  renderSources(status);
}

function setCustomHelp(text: string, invalid = false) {
  $('custom-help').textContent = text;
  $('custom').setAttribute('aria-invalid', String(invalid));
}

async function saveCustom(): Promise<string | null> {
  const input = $<HTMLInputElement>('custom');
  const raw = input.value.trim();
  if (!raw) {
    settings = await updateSettings({ customInstance: '' });
    setCustomHelp(CUSTOM_HELP);
    return null;
  }
  const url = normalizeInstance(raw);
  if (!url) {
    setCustomHelp('Enter an https address, like https://rimgo.example.org', true);
    return null;
  }
  input.value = url;
  settings = await updateSettings({ customInstance: url });
  setCustomHelp(CUSTOM_HELP);
  return url;
}

async function testCustom() {
  const url = await saveCustom();
  if (!url) return;
  const button = $<HTMLButtonElement>('test');
  button.disabled = true;
  setCustomHelp(`Testing ${url}…`);
  const size = await loadImageSize(rimgoMediaUrl(url, PROBE_ID, 'jpg'), 10_000);
  button.disabled = false;
  if (size?.width === PROBE_SIZE.width && size.height === PROBE_SIZE.height) {
    setCustomHelp('Works: it served the test image.');
  } else if (size?.width === PLACEHOLDER_SIZE.width && size.height === PLACEHOLDER_SIZE.height) {
    setCustomHelp('It answered with Imgur\'s "not available in your region" image, so Imgur is blocked there too.', true);
  } else {
    setCustomHelp("It didn't serve the test image. Check the address, or try again later.", true);
  }
}

async function init() {
  $('version').textContent = `Version ${browser.runtime.getManifest().version}`;

  const toggle = (id: string, key: 'enabled' | 'alwaysProxy' | 'onlyNoDataInstances' | 'useImgurPassServer') =>
    checkbox(id).addEventListener('change', async (e) => {
      settings = await updateSettings({ [key]: (e.target as HTMLInputElement).checked });
      await render();
    });
  toggle('enabled', 'enabled');
  toggle('always', 'alwaysProxy');
  toggle('nodata', 'onlyNoDataInstances');
  toggle('server', 'useImgurPassServer');

  // permissions.request has to run straight from the click for the prompt to show.
  checkbox('everywhere').addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    void (on ? browser.permissions.request(ALL_SITES) : browser.permissions.remove(ALL_SITES)).then(render);
  });
  $('allow-required').addEventListener('click', () => {
    void browser.permissions.request({ origins: status?.missingHosts ?? [] }).then(render);
  });

  $('custom').addEventListener('change', () => void saveCustom().then(render));
  $('test').addEventListener('click', () => void testCustom());

  $('recheck').addEventListener('click', async () => {
    const button = $<HTMLButtonElement>('recheck');
    button.disabled = true;
    button.textContent = 'Checking…';
    await ask({ type: 'recheck' });
    button.disabled = false;
    button.textContent = 'Check again';
    await render();
  });

  onExternalChange(() => void render());
  await render();
}

void init();
