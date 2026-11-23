import '@/assets/ui.css';
import './style.css';
import { browser, type Browser } from 'wxt/browser';
import { ALL_SITES, type PageStats, type PageStatsMessage, type StatusReply } from '@/lib/messages';
import { isPaused, siteHost, sitePattern } from '@/lib/sites';
import { getSettings, type Settings } from '@/lib/state';
import { describeStatus, formatWhen, type StatusText } from '@/lib/status-text';
import { $, ask, h, onExternalChange, renderCallout, updateSettings } from '@/lib/ui';

let tab: Browser.tabs.Tab | undefined;
let host: string | null = null;
let status: StatusReply | null = null;
let settings: Settings;

const show = (id: string, visible: boolean) => ($(id).hidden = !visible);

async function pageStats(): Promise<PageStats | null> {
  if (tab?.id === undefined) return null;
  const msg: PageStatsMessage = { type: 'page-stats', imageVia: settings.imageSource };
  return (browser.tabs.sendMessage(tab.id, msg, { frameId: 0 }) as Promise<PageStats | undefined>)
    .then((r) => r ?? null)
    .catch(() => null);
}

function renderStats(stats: PageStats) {
  const fixed = stats.duckduckgo + stats.rimgo;
  if (fixed === 0 && stats.failed === 0) {
    $('stats').replaceChildren(h('p', { class: 'note', text: 'No Imgur images on this page.' }));
    return;
  }
  const row = (label: string, n: number) => h('div', {}, h('dt', { text: label }), h('dd', { text: String(n) }));
  $('stats').replaceChildren(
    h(
      'div',
      { class: 'count' },
      h('div', { class: 'count-n', text: String(fixed) }),
      h('div', { class: 'count-label', text: `${fixed === 1 ? 'image' : 'images'} unblocked on this page` }),
    ),
    h(
      'dl',
      { class: 'breakdown' },
      row('Through DuckDuckGo', stats.duckduckgo),
      row('Through a rimgo mirror', stats.rimgo),
      row("Couldn't load", stats.failed),
    ),
  );
}

async function render() {
  [status, settings] = await Promise.all([ask({ type: 'get-status' }), getSettings()]);
  if (!status) {
    renderCallout($('callout'), { tone: 'warn', title: 'ImgurPass is starting', body: 'Open this again in a moment.' });
    return;
  }

  const missing = status.missingHosts.length > 0;
  const paused = isPaused(host, settings.pausedSites);
  const siteAllowed = !!host && (status.allSites || (await browser.permissions.contains({ origins: [sitePattern(host)] })));
  const limited = status.active && !!host && !siteAllowed && !missing;

  let text: StatusText = describeStatus({ ...settings, detection: status.detection, missingHosts: status.missingHosts });
  if (limited) {
    text = {
      tone: 'warn',
      title: "Images on this site can't be fixed yet",
      body: "Your browser only lets ImgurPass fix images on sites you've allowed. Direct i.imgur.com links still work.",
    };
  } else if (status.active && paused) {
    text = { tone: 'off', title: 'Paused on this site', body: 'Imgur images on this site are left as they are.' };
  }
  renderCallout($('callout'), text);

  $<HTMLInputElement>('enabled').checked = settings.enabled;
  show('allow-required', missing);

  show('limited', limited);
  if (limited) $('grant-site').textContent = `Only on ${host}`;

  const siteRow = status.active && !!host && siteAllowed && !missing;
  show('site-row', siteRow);
  if (siteRow) {
    $('site-host').textContent = host;
    $<HTMLInputElement>('site').checked = !paused;
  }

  const stats = siteRow && !paused ? await pageStats() : null;
  show('stats', !!stats);
  if (stats) renderStats(stats);
  // Allowed, but the page was loaded before: the fallback script isn't in it yet.
  show('reload-note', siteRow && !paused && !stats);

  show('idle-note', text.tone === 'good');
  show('proxy-row', settings.enabled && !missing && status.detection.status !== 'blocked');
  $<HTMLInputElement>('always').checked = settings.alwaysProxy;

  $('checked').textContent = `Checked ${formatWhen(status.detection.checkedAt)}`;
}

async function init() {
  [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  host = siteHost(tab?.url);

  $('enabled').addEventListener('change', async (e) => {
    await updateSettings({ enabled: (e.target as HTMLInputElement).checked });
    await render();
  });
  $('always').addEventListener('change', async (e) => {
    await updateSettings({ alwaysProxy: (e.target as HTMLInputElement).checked });
    await render();
  });
  $('site').addEventListener('change', async (e) => {
    if (!host) return;
    const on = (e.target as HTMLInputElement).checked;
    const others = settings.pausedSites.filter((s) => s !== host);
    await updateSettings({ pausedSites: on ? others : [...others, host] });
    await render();
  });

  // permissions.request has to run straight from the click for the prompt to show.
  $('allow-required').addEventListener('click', () => {
    void browser.permissions.request({ origins: status?.missingHosts ?? [] }).then(render);
  });
  $('grant-all').addEventListener('click', () => {
    void browser.permissions.request(ALL_SITES).then(render);
  });
  $('grant-site').addEventListener('click', () => {
    if (host) void browser.permissions.request({ origins: [sitePattern(host)] }).then(render);
  });

  $('reload').addEventListener('click', () => {
    if (tab?.id !== undefined) void browser.tabs.reload(tab.id);
    window.close();
  });
  $('recheck').addEventListener('click', async () => {
    const button = $<HTMLButtonElement>('recheck');
    button.disabled = true;
    button.textContent = 'Checking…';
    await ask({ type: 'recheck' });
    button.disabled = false;
    button.textContent = 'Check now';
    await render();
  });
  $('settings').addEventListener('click', () => {
    void browser.runtime.openOptionsPage();
    window.close();
  });

  onExternalChange(() => void render());
  await render();
}

void init();
