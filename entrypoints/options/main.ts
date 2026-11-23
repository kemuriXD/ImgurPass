// Minimal settings page. The full settings UI replaces this later.
import { browser } from 'wxt/browser';
import { ALL_SITES, type BackgroundMessage, type StatusReply } from '@/lib/messages';
import { getSettings, settingsItem, type Settings } from '@/lib/state';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function render(s: StatusReply | null) {
  if (!s) return;
  const when = s.detection.checkedAt ? new Date(s.detection.checkedAt).toLocaleString() : 'never';
  $('status').textContent = `${s.detection.status}: ${s.detection.reason} (checked ${when})`;
  $('active').textContent = s.active ? 'on' : 'off';
  $('all-sites').textContent = s.allSites ? 'granted' : 'not granted (only direct i.imgur.com links work)';
  $('instances').textContent = `${s.healthyInstances} healthy of ${s.knownInstances}`;
  $<HTMLButtonElement>('grant').hidden = s.allSites;
}

const ask = (msg: BackgroundMessage) => browser.runtime.sendMessage(msg) as Promise<StatusReply | null>;

async function update(patch: Partial<Settings>) {
  await settingsItem.setValue({ ...(await getSettings()), ...patch });
  render(await ask({ type: 'get-status' }));
}

async function init() {
  const settings = await getSettings();
  $<HTMLInputElement>('enabled').checked = settings.enabled;
  $<HTMLInputElement>('always-proxy').checked = settings.alwaysProxy;
  $<HTMLInputElement>('only-no-data').checked = settings.onlyNoDataInstances;
  $<HTMLInputElement>('custom').value = settings.customInstance;

  $('enabled').addEventListener('change', (e) => update({ enabled: (e.target as HTMLInputElement).checked }));
  $('always-proxy').addEventListener('change', (e) => update({ alwaysProxy: (e.target as HTMLInputElement).checked }));
  $('only-no-data').addEventListener('change', (e) =>
    update({ onlyNoDataInstances: (e.target as HTMLInputElement).checked }),
  );
  $('custom').addEventListener('change', (e) => update({ customInstance: (e.target as HTMLInputElement).value.trim() }));

  $('recheck').addEventListener('click', async () => {
    $('status').textContent = 'checking…';
    render(await ask({ type: 'recheck' }));
  });
  $('grant').addEventListener('click', async () => {
    // Must be called straight from the click for the prompt to show.
    await browser.permissions.request(ALL_SITES);
    render(await ask({ type: 'get-status' }));
  });

  render(await ask({ type: 'get-status' }));
}

void init();
