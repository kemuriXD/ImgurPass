import { describe, expect, it, vi } from 'vitest';
import { decide, detect, isRegionError, type ProbeResult } from '../lib/detect';

const size = (width: number, height: number): ProbeResult => ({ kind: 'size', size: { width, height } });

describe('decide', () => {
  it('is unblocked when the probe has its real size', () => {
    expect(decide({ probe: size(1800, 1200) }).status).toBe('unblocked');
  });

  it('is blocked on the 336x478 placeholder', () => {
    expect(decide({ probe: size(336, 478) })).toEqual({
      status: 'blocked',
      reason: 'Imgur served its region placeholder',
    });
  });

  it('is blocked on any other size', () => {
    expect(decide({ probe: size(161, 81) }).status).toBe('blocked');
  });

  it('is blocked when the response is not an image', () => {
    expect(decide({ probe: { kind: 'not-image' } }).status).toBe('blocked');
  });

  it('uses the API region error when the probe fails', () => {
    expect(decide({ probe: { kind: 'network-error' }, apiRegionError: true }).status).toBe('blocked');
  });

  it('is blocked when Imgur is unreachable but the proxy works', () => {
    expect(decide({ probe: { kind: 'network-error' }, apiRegionError: null, proxyWorks: true }).status).toBe('blocked');
  });

  it('is unknown when nothing can be reached', () => {
    expect(decide({ probe: { kind: 'network-error' }, apiRegionError: null, proxyWorks: false })).toEqual({
      status: 'unknown',
      reason: 'probe failed with a network error',
    });
    expect(decide({ probe: { kind: 'http-error', status: 503 } }).reason).toBe('probe failed with HTTP 503');
  });
});

describe('isRegionError', () => {
  it('matches the 403 region reply only', () => {
    const body = '{"data":{"error":"Content not available in your region."}}';
    expect(isRegionError(403, body)).toBe(true);
    expect(isRegionError(200, body)).toBe(false);
    expect(isRegionError(403, '{"data":{"error":"Invalid client_id"}}')).toBe(false);
  });
});

describe('detect', () => {
  it('skips secondary checks when the probe is conclusive', async () => {
    const deps = {
      probe: async () => size(336, 478),
      apiRegionError: vi.fn(async () => null),
      proxyWorks: vi.fn(async () => null),
    };
    expect((await detect(deps)).status).toBe('blocked');
    expect(deps.apiRegionError).not.toHaveBeenCalled();
    expect(deps.proxyWorks).not.toHaveBeenCalled();
  });

  it('only checks the proxy when the API is inconclusive', async () => {
    const proxyWorks = vi.fn(async () => true);
    const blockedByApi = await detect({
      probe: async () => ({ kind: 'network-error' }),
      apiRegionError: async () => true,
      proxyWorks,
    });
    expect(blockedByApi.status).toBe('blocked');
    expect(proxyWorks).not.toHaveBeenCalled();

    const viaProxy = await detect({
      probe: async () => ({ kind: 'network-error' }),
      apiRegionError: async () => null,
      proxyWorks,
    });
    expect(viaProxy.status).toBe('blocked');
    expect(proxyWorks).toHaveBeenCalledOnce();
  });
});
