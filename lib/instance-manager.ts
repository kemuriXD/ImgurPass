import { storage } from '#imports';
import { BUNDLED_INSTANCES } from './bundled-instances';
import { PROBE_ID, PROBE_SIZE, type Size } from './detect';
import { normalizeInstance, rimgoMediaUrl } from './imgur-url';
import {
  INSTANCE_LIST_URL,
  orderInstances,
  parseInstanceList,
  withCheckResult,
  withReportedFailure,
  withReportedSuccess,
  type HealthMap,
  type Instance,
} from './instances';
import type { Settings } from './state';

interface StoredList {
  fetchedAt: number;
  list: Instance[];
}

export const instanceListItem = storage.defineItem<StoredList>('local:instances', {
  fallback: { fetchedAt: 0, list: [] },
});
export const healthItem = storage.defineItem<HealthMap>('local:health', { fallback: {} });

/** Serialise read-modify-write updates of the health map. */
let healthQueue: Promise<unknown> = Promise.resolve();
function updateHealth(fn: (h: HealthMap) => HealthMap): Promise<void> {
  const next = healthQueue.then(async () => healthItem.setValue(fn(await healthItem.getValue())));
  healthQueue = next.catch(() => {});
  return next;
}

/** Fetch the public list. Keeps the previous list (or the bundled one) on any failure. */
export async function refreshInstanceList(fetchFn: typeof fetch = fetch, now = Date.now()): Promise<boolean> {
  try {
    const res = await fetchFn(INSTANCE_LIST_URL, {
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return false;
    const list = parseInstanceList(await res.json());
    if (list.length === 0) return false;
    await instanceListItem.setValue({ fetchedAt: now, list });
    return true;
  } catch {
    return false;
  }
}

export async function getInstances(): Promise<Instance[]> {
  const { list } = await instanceListItem.getValue();
  return list.length > 0 ? list : BUNDLED_INSTANCES;
}

export type ImageSizeProbe = (url: string) => Promise<Size | null>;

/**
 * Load the known probe image through every instance (and the custom one) and
 * record which ones serve it at its real size. A placeholder or error means down.
 */
export async function checkHealth(
  probe: ImageSizeProbe,
  customInstance = '',
  now = Date.now(),
  concurrency = 4,
): Promise<HealthMap> {
  const urls = (await getInstances()).map((i) => i.url);
  const custom = normalizeInstance(customInstance);
  if (custom && !urls.includes(custom)) urls.push(custom);

  const results = new Map<string, boolean>();
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++]!;
      const size = await probe(rimgoMediaUrl(url, PROBE_ID, 'jpg')).catch(() => null);
      results.set(url, size?.width === PROBE_SIZE.width && size.height === PROBE_SIZE.height);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));

  await updateHealth((h) => {
    let out = h;
    for (const [url, ok] of results) out = withCheckResult(out, url, ok, now);
    return out;
  });
  return healthItem.getValue();
}

export async function getOrderedInstances(settings: Settings): Promise<string[]> {
  return orderInstances(await getInstances(), await healthItem.getValue(), {
    onlyNoData: settings.onlyNoDataInstances,
    customInstance: settings.customInstance,
  });
}

/** Called when a page loaded (or failed to load) an image from an instance. */
export function reportInstanceResult(instance: string, ok: boolean, now = Date.now()): Promise<void> {
  const url = normalizeInstance(instance);
  if (!url) return Promise.resolve();
  return updateHealth((h) => (ok ? withReportedSuccess(h, url, now) : withReportedFailure(h, url, now)));
}
