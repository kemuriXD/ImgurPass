import { storage } from '#imports';
import { browser, type Browser } from 'wxt/browser';
import { API_PROBE_URL, detect, isRegionError, PROBE_ID, PROBE_SIZE, PROBE_URL, type Size } from '@/lib/detect';
import { setRules } from '@/lib/dnr';
import { fetchHtml } from '@/lib/fetch-page';
import { duckDuckGoUrl, normalizeInstance } from '@/lib/imgur-url';
import {
  checkHealth,
  getInstances,
  getOrderedInstances,
  healthItem,
  lastHealthCheckItem,
  instanceListItem,
  refreshInstanceList,
  reportInstanceResult,
  type ImageSizeProbe,
} from '@/lib/instance-manager';
import {
  ALL_SITES,
  DDG_SOURCE,
  type BackgroundMessage,
  type FallbacksReply,
  type OffscreenProbeMessage,
  type StatusReply,
} from '@/lib/messages';
import { missingRequiredHosts } from '@/lib/permissions';
import { fetchImageSize, loadImageSize } from '@/lib/probe';
import { grantedSites, isPaused, siteHost, sitePattern } from '@/lib/sites';
import { detectionItem, getSettings, isActive, settingsItem, type Settings } from '@/lib/state';

const HOUR = 60 * 60 * 1000;
const DETECT_EVERY_MIN = 4 * 60;
const RETRY_UNKNOWN_MIN = 15;
const LIST_MAX_AGE = 24 * HOUR;
const HEALTH_MAX_AGE = 6 * HOUR;
const HEALTH_RETRY_WHEN_FEW = HOUR / 2;
const HEALTH_TIMEOUT_MS = 8_000;
const PAGE_FETCH_TIMEOUT_MS = 8_000;
const FALLBACK_SCRIPT_ID = 'imgurpass-fallback';

/** The rimgo mirror the image rules point at right now, if any. */
const imageRuleInstance = storage.defineItem<string | null>('session:imageRuleInstance', { fallback: null });

const isRealSize = (s: Size | null) => s?.width === PROBE_SIZE.width && s.height === PROBE_SIZE.height;

async function runDetection() {
  const verdict = await detect({
    probe: () => fetchImageSize(PROBE_URL),
    apiRegionError: async () => {
      try {
        const res = await fetch(API_PROBE_URL, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15_000) });
        return isRegionError(res.status, await res.text()) ? true : null;
      } catch {
        return null;
      }
    },
    proxyWorks: async () => {
      const r = await fetchImageSize(duckDuckGoUrl(PROBE_ID, 'jpg'));
      return r.kind === 'size' && isRealSize(r.size);
    },
  });

  const prev = await detectionItem.getValue();
  // An inconclusive check keeps the last known status and retries soon.
  const status = verdict.status === 'unknown' && prev.status !== 'unknown' ? prev.status : verdict.status;
  await detectionItem.setValue({ status, reason: verdict.reason, checkedAt: Date.now() });
  if (verdict.status === 'unknown') browser.alarms.create('detect-retry', { delayInMinutes: RETRY_UNKNOWN_MIN });
}

const hasAllSites = () => browser.permissions.contains(ALL_SITES);
const requiredHosts = (): string[] => browser.runtime.getManifest().host_permissions ?? [];

async function singleSites(): Promise<string[]> {
  return grantedSites((await browser.permissions.getAll()).origins ?? [], requiredHosts());
}

/** Run the fallback script on every site, or only on the sites the user allowed one by one. */
async function syncFallbackScript(active: boolean) {
  const matches = !active ? [] : (await hasAllSites()) ? ALL_SITES.origins : (await singleSites()).map(sitePattern);
  const [existing] = await browser.scripting.getRegisteredContentScripts({ ids: [FALLBACK_SCRIPT_ID] });
  if (existing && existing.matches?.join() === matches.join()) return;
  if (existing) await browser.scripting.unregisterContentScripts({ ids: [FALLBACK_SCRIPT_ID] });
  if (matches.length === 0) return;
  await browser.scripting.registerContentScripts([
    { id: FALLBACK_SCRIPT_ID, js: ['fallback.js'], matches, allFrames: true, runAt: 'document_start' },
  ]);
}

/** A known-good rimgo mirror for images, when the user puts rimgo first. */
async function pickImageInstance(settings: Settings): Promise<string | null> {
  if (settings.imageSource !== 'rimgo') return null;
  const health = await healthItem.getValue();
  const ordered = await getOrderedInstances(settings, 'image');
  return ordered.find((url) => health[url]?.ok && health[url].checkedAt > 0) ?? null;
}

async function currentlyActive() {
  return isActive(await getSettings(), await detectionItem.getValue());
}

let applying: Promise<void> = Promise.resolve();
/** Bring DNR rules and the content script in line with the stored state. */
function applyState(): Promise<void> {
  applying = applying
    .then(async () => {
      const settings = await getSettings();
      const active = isActive(settings, await detectionItem.getValue());
      const [videoInstance] = await getOrderedInstances(settings, 'video');
      const imageInstance = active ? await pickImageInstance(settings) : null;
      await setRules(
        active
          ? {
              viewerUrl: browser.runtime.getURL('/viewer.html'),
              videoInstance: videoInstance ?? null,
              imageInstance,
              pausedSites: settings.pausedSites,
            }
          : null,
      );
      await imageRuleInstance.setValue(imageInstance);
      await syncFallbackScript(active);
    })
    .catch((err) => console.error('ImgurPass: failed to apply state', err));
  return applying;
}

/** Image probe for health checks: fetch when we have host access, else a real <img>. */
async function withHealthProbe<T>(fn: (probe: ImageSizeProbe) => Promise<T>): Promise<T> {
  if (await hasAllSites()) {
    return fn(async (url) => {
      const r = await fetchImageSize(url, HEALTH_TIMEOUT_MS);
      return r.kind === 'size' ? r.size : null;
    });
  }
  if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
    // Firefox event page has a DOM.
    return fn((url) => loadImageSize(url, HEALTH_TIMEOUT_MS));
  }
  await ensureOffscreen();
  try {
    return await fn((url) =>
      browser.runtime.sendMessage({ target: 'offscreen', type: 'probe-image', url } satisfies OffscreenProbeMessage),
    );
  } finally {
    await browser.offscreen.closeDocument().catch(() => {});
  }
}

async function ensureOffscreen() {
  const contexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as Browser.runtime.ContextType],
  });
  if (contexts.length > 0) return;
  await browser.offscreen.createDocument({
    url: browser.runtime.getURL('/offscreen.html'),
    reasons: ['DOM_SCRAPING' as Browser.offscreen.Reason],
    justification: 'Loads a test image from each rimgo mirror to check it still serves Imgur images.',
  });
}

let healthRun: Promise<unknown> | null = null;
function runHealthCheck() {
  healthRun ??= (async () => {
    const settings = await getSettings();
    await withHealthProbe((probe) => checkHealth(probe, settings.customInstance));
    // The embedded-video rule points at a specific mirror: pick from fresh results.
    await applyState();
  })()
    .catch((err) => console.error('ImgurPass: health check failed', err))
    .finally(() => (healthRun = null));
  return healthRun;
}

/** Re-check every few hours, or much sooner when hardly any mirror works. */
async function healthIsStale() {
  const health = await healthItem.getValue();
  const working = Object.values(health).filter((h) => h.ok && h.checkedAt > 0).length;
  const maxAge = working < 2 ? HEALTH_RETRY_WHEN_FEW : HEALTH_MAX_AGE;
  return Date.now() - (await lastHealthCheckItem.getValue()) > maxAge;
}

/** Full cycle: refresh the list if old, detect, apply, and health-check while active. */
async function runCycle(force = false) {
  const { fetchedAt } = await instanceListItem.getValue();
  if (force || Date.now() - fetchedAt > LIST_MAX_AGE) await refreshInstanceList();
  await runDetection();
  await applyState();
  if ((await currentlyActive()) && (force || (await healthIsStale()))) await runHealthCheck();
}

async function ensureAlarms() {
  if (!(await browser.alarms.get('detect'))) {
    browser.alarms.create('detect', { periodInMinutes: DETECT_EVERY_MIN });
  }
  // Cheap: only runs a check when healthIsStale() says so.
  if (!(await browser.alarms.get('health'))) {
    browser.alarms.create('health', { periodInMinutes: 30 });
  }
}

async function status(): Promise<StatusReply> {
  const health = await healthItem.getValue();
  const instances = await getInstances();
  return {
    detection: await detectionItem.getValue(),
    active: await currentlyActive(),
    allSites: await hasAllSites(),
    missingHosts: await missingRequiredHosts(),
    healthyInstances: instances.filter((i) => health[i.url]?.ok && health[i.url]!.checkedAt > 0).length,
    knownInstances: instances.length,
    listUpdatedAt: (await instanceListItem.getValue()).fetchedAt,
    grantedSites: await singleSites(),
  };
}

/** Mirrors (and DuckDuckGo) for a page to retry failed media through, in order. */
async function fallbacks(capability: 'image' | 'video' | 'album', settings: Settings): Promise<string[]> {
  const instances = await getOrderedInstances(settings, capability);
  if (capability !== 'image' || settings.imageSource !== 'rimgo') return instances;
  // The rules sent the image to a rimgo mirror first: DuckDuckGo is next, then the other mirrors.
  const first = await imageRuleInstance.getValue();
  return [DDG_SOURCE, ...instances.filter((url) => url !== first)];
}

async function handleMessage(msg: BackgroundMessage, sender: Browser.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case 'get-fallbacks': {
      const settings = await getSettings();
      const paused = isPaused(siteHost(sender.tab?.url), settings.pausedSites);
      return {
        active: !paused && isActive(settings, await detectionItem.getValue()),
        instances: await fallbacks(msg.capability ?? 'image', settings),
        allSites: await hasAllSites(),
      } satisfies FallbacksReply;
    }
    case 'instance-result':
      await reportInstanceResult(msg.instance, msg.ok, msg.capability ?? 'image');
      // A dead video mirror shouldn't stay in the embedded-video rule.
      if (msg.capability === 'video' && !msg.ok) void applyState();
      return null;
    case 'get-status':
      return status();
    case 'recheck':
      await runCycle(true);
      return status();
    case 'fetch-page':
      return fetchMirrorPage(msg.url, sender);
  }
}

/** Read a rimgo page for a viewer embedded in another site. Only known mirrors, only for the viewer. */
async function fetchMirrorPage(url: string, sender: Browser.runtime.MessageSender) {
  if (!sender.url?.startsWith(browser.runtime.getURL('/viewer.html'))) return null;
  let origin: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    origin = u.origin;
  } catch {
    return null;
  }
  const known = new Set((await getInstances()).map((i) => i.url));
  const custom = normalizeInstance((await getSettings()).customInstance);
  if (custom) known.add(custom);
  if (!known.has(origin)) return null;
  return fetchHtml(url, PAGE_FETCH_TIMEOUT_MS);
}

export default defineBackground(() => {
  // Firefox doesn't keep alarms across restarts or re-enabling, so check on every wake.
  void ensureAlarms();
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });
    void ensureAlarms().then(() => runCycle());
  });
  browser.runtime.onStartup.addListener(() => {
    void ensureAlarms().then(() => runCycle());
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'detect' || alarm.name === 'detect-retry') void runCycle();
    if (alarm.name === 'health') {
      void (async () => {
        if ((await currentlyActive()) && (await healthIsStale())) await runHealthCheck();
      })();
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const msg = message as BackgroundMessage & { target?: string };
    if (sender.id !== browser.runtime.id || msg?.target === 'offscreen') return;
    handleMessage(msg, sender).then(sendResponse, (err) => {
      console.error('ImgurPass: message failed', err);
      sendResponse(null);
    });
    return true;
  });

  settingsItem.watch(() => {
    void applyState().then(async () => {
      if ((await currentlyActive()) && (await healthIsStale())) await runHealthCheck();
    });
  });
  browser.permissions.onAdded.addListener(async (added) => {
    // Detection probably failed while Imgur access was withheld: run it again.
    const required: string[] = browser.runtime.getManifest().host_permissions ?? [];
    if (added.origins?.some((o) => required.includes(o) || o === ALL_SITES.origins[0])) {
      if ((await missingRequiredHosts()).length === 0) return void runCycle();
    }
    void applyState();
  });
  browser.permissions.onRemoved.addListener(() => void applyState());
});
