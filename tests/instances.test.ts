import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import fixture from './fixtures/rimgo-api.json';
import { BUNDLED_INSTANCES } from '../lib/bundled-instances';
import {
  checkHealth,
  getInstances,
  getOrderedInstances,
  healthItem,
  lastHealthCheckItem,
  instanceListItem,
  refreshInstanceList,
  reportInstanceResult,
} from '../lib/instance-manager';
import {
  orderInstances,
  parseInstanceList,
  SOFT_FAILURE_LIMIT,
  CAPABILITY_RETRY_MS,
  withCapabilityResult,
  withCheckResult,
  withReportedFailure,
  type HealthMap,
  type Instance,
} from '../lib/instances';
import { DEFAULT_SETTINGS } from '../lib/state';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('parseInstanceList', () => {
  it('keeps valid https origins, dedupes, and reads the data note', () => {
    expect(parseInstanceList(fixture)).toEqual([
      { url: 'https://ri.bcow.xyz', noData: false, country: 'CA' },
      { url: 'https://imgur.artemislena.eu', noData: true, country: 'DE' },
      { url: 'https://rimgo.ducks.party', noData: true, country: 'NL' },
      { url: 'https://rimgo.canine.tools', noData: false, country: 'US' },
      { url: 'https://odd.example.net', noData: false },
    ]);
  });

  it.each([null, undefined, 'x', 42, {}, { clearnet: 'nope' }])('returns [] for %j', (input) => {
    expect(parseInstanceList(input)).toEqual([]);
  });
});

describe('orderInstances', () => {
  const list: Instance[] = [
    { url: 'https://a.example', noData: true },
    { url: 'https://b.example', noData: false },
    { url: 'https://c.example', noData: true },
    { url: 'https://d.example', noData: false },
    { url: 'https://e.example', noData: true },
  ];
  const health: HealthMap = {
    'https://a.example': { ok: false, checkedAt: 1, failures: 3 },
    'https://b.example': { ok: true, checkedAt: 1, failures: 0 },
    'https://c.example': { ok: true, checkedAt: 1, failures: 0 },
  };
  const noShuffle = () => 0.999;

  it('puts healthy no-data first, skips dead ones, then untested', () => {
    expect(orderInstances(list, health, { onlyNoData: false, random: noShuffle })).toEqual([
      'https://c.example',
      'https://b.example',
      'https://e.example',
      'https://d.example',
    ]);
  });

  it('can restrict to no-data instances', () => {
    expect(orderInstances(list, health, { onlyNoData: true, random: noShuffle })).toEqual([
      'https://c.example',
      'https://e.example',
    ]);
  });

  it('puts the custom instance last, even when listed', () => {
    expect(
      orderInstances(list, health, { onlyNoData: true, customInstance: 'c.example/', random: noShuffle }),
    ).toEqual(['https://e.example', 'https://c.example']);
    expect(
      orderInstances(list, health, { onlyNoData: true, customInstance: 'my.rimgo.example', random: noShuffle }),
    ).toEqual(['https://c.example', 'https://e.example', 'https://my.rimgo.example']);
  });

  it('orders by video or album capability, retrying old failures', () => {
    const now = 10 * CAPABILITY_RETRY_MS;
    const capHealth: HealthMap = {
      'https://a.example': { ok: true, checkedAt: 1, failures: 0, video: { ok: true, at: now - 1 } },
      'https://b.example': { ok: true, checkedAt: 1, failures: 0, video: { ok: false, at: now - 1 } },
      'https://c.example': { ok: true, checkedAt: 1, failures: 0, video: { ok: false, at: now - CAPABILITY_RETRY_MS - 1 } },
      'https://d.example': { ok: false, checkedAt: 1, failures: 3, video: { ok: true, at: now - 1 } },
    };
    expect(orderInstances(list, capHealth, { onlyNoData: false, capability: 'video', now, random: noShuffle })).toEqual([
      'https://a.example',
      'https://c.example',
      'https://e.example',
    ]);
    // Images ignore video results.
    expect(orderInstances(list, capHealth, { onlyNoData: false, now, random: noShuffle })).toContain('https://b.example');
  });

  it('keeps capability results when image health changes', () => {
    let h = withCapabilityResult({}, 'https://a.example', 'album', true, 5);
    h = withReportedFailure(h, 'https://a.example', 6);
    h = withCheckResult(h, 'https://a.example', true, 7);
    expect(h['https://a.example']).toEqual({ ok: true, checkedAt: 7, failures: 0, album: { ok: true, at: 5 } });
  });

  it('shuffles within a group to spread load', () => {
    const many: Instance[] = Array.from({ length: 6 }, (_, i) => ({ url: `https://i${i}.example`, noData: true }));
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(orderInstances(many, {}, { onlyNoData: false })[0]!);
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('instance manager', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('uses the bundled list until a fetch succeeds', async () => {
    expect(await getInstances()).toBe(BUNDLED_INSTANCES);
    const fetchFn = vi.fn(async () => jsonResponse(fixture));
    expect(await refreshInstanceList(fetchFn as unknown as typeof fetch, 1000)).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith('https://rimgo.codeberg.page/api.json', expect.anything());
    expect((await getInstances()).map((i) => i.url)).toContain('https://rimgo.ducks.party');
    expect((await instanceListItem.getValue()).fetchedAt).toBe(1000);
  });

  it('keeps the previous list when the fetch fails or is empty', async () => {
    await refreshInstanceList((async () => jsonResponse(fixture)) as unknown as typeof fetch);
    const before = await getInstances();
    const failing = [
      async () => jsonResponse({}, 500),
      async () => jsonResponse({ clearnet: [] }),
      async () => new Response('<html>not json'),
      async () => {
        throw new TypeError('offline');
      },
    ];
    for (const f of failing) {
      expect(await refreshInstanceList(f as unknown as typeof fetch)).toBe(false);
    }
    expect(await getInstances()).toEqual(before);
  });

  it('marks instances by whether they serve the probe at its real size', async () => {
    await refreshInstanceList((async () => jsonResponse(fixture)) as unknown as typeof fetch);
    const probe = vi.fn(async (url: string) => {
      if (url.startsWith('https://ri.bcow.xyz/')) return { width: 1800, height: 1200 };
      if (url.startsWith('https://rimgo.ducks.party/')) return { width: 336, height: 478 };
      if (url.startsWith('https://my.rimgo.example/')) return { width: 1800, height: 1200 };
      return null;
    });
    const health = await checkHealth(probe, 'my.rimgo.example', 5);
    expect(probe).toHaveBeenCalledWith('https://ri.bcow.xyz/OB0y6MR.jpg');
    expect(health['https://ri.bcow.xyz']?.ok).toBe(true);
    expect(health['https://rimgo.ducks.party']?.ok).toBe(false);
    expect(health['https://rimgo.canine.tools']?.ok).toBe(false);
    expect(health['https://my.rimgo.example']?.ok).toBe(true);

    expect(await getOrderedInstances({ ...DEFAULT_SETTINGS, customInstance: 'my.rimgo.example' })).toEqual([
      'https://ri.bcow.xyz',
      'https://my.rimgo.example',
    ]);
  });

  it('needs several page failures before an instance is down, and one success to recover', async () => {
    const url = 'https://ri.bcow.xyz';
    for (let i = 1; i < SOFT_FAILURE_LIMIT; i++) await reportInstanceResult(url, false);
    expect((await healthItem.getValue())[url]?.ok).toBe(true);
    await reportInstanceResult(url, false);
    expect((await healthItem.getValue())[url]?.ok).toBe(false);
    await reportInstanceResult(`${url}/`, true);
    expect((await healthItem.getValue())[url]).toMatchObject({ ok: true, failures: 0 });
  });

  it('only a full check moves the last-check time', async () => {
    await reportInstanceResult('https://ri.bcow.xyz', true, 'image', 50);
    expect(await lastHealthCheckItem.getValue()).toBe(0);
    await checkHealth(async () => null, '', 99);
    expect(await lastHealthCheckItem.getValue()).toBe(99);
    await reportInstanceResult('https://ri.bcow.xyz', true, 'image', 200);
    expect((await healthItem.getValue())['https://ri.bcow.xyz']?.checkedAt).toBe(99);
  });

  it('serialises concurrent reports', async () => {
    await Promise.all(Array.from({ length: SOFT_FAILURE_LIMIT }, () => reportInstanceResult('https://x.example', false)));
    expect((await healthItem.getValue())['https://x.example']?.failures).toBe(SOFT_FAILURE_LIMIT);
  });
});
