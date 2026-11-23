import type { BlockStatus } from './state';

export const PROBE_ID = 'OB0y6MR';
export const PROBE_URL = `https://i.imgur.com/${PROBE_ID}.jpg`;
export const PROBE_SIZE = { width: 1800, height: 1200 } as const;
/** What i.imgur.com serves for every id when the region is blocked. */
export const PLACEHOLDER_SIZE = { width: 336, height: 478 } as const;
export const API_PROBE_URL = `https://api.imgur.com/3/image/${PROBE_ID}`;

export interface Size {
  width: number;
  height: number;
}

/** Outcome of loading the probe image. */
export type ProbeResult =
  | { kind: 'size'; size: Size }
  /** Got a response, but it wasn't a decodable image (e.g. a filter's block page). */
  | { kind: 'not-image' }
  | { kind: 'http-error'; status: number }
  | { kind: 'network-error' };

export interface Signals {
  probe: ProbeResult;
  /** true if api.imgur.com replied with the region error, null if not checked or unreachable. */
  apiRegionError?: boolean | null;
  /** true if the DuckDuckGo proxy served the probe at its real size, null if not checked. */
  proxyWorks?: boolean | null;
}

export interface Verdict {
  status: BlockStatus;
  reason: string;
}

const sameSize = (a: Size, b: Size) => a.width === b.width && a.height === b.height;

/**
 * Turn probe signals into a block status. The probe is authoritative when it
 * returns an image; the API and proxy only decide when Imgur can't be reached.
 */
export function decide(signals: Signals): Verdict {
  const { probe } = signals;

  if (probe.kind === 'size') {
    if (sameSize(probe.size, PROBE_SIZE)) return { status: 'unblocked', reason: 'probe image has its real size' };
    if (sameSize(probe.size, PLACEHOLDER_SIZE)) return { status: 'blocked', reason: 'Imgur served its region placeholder' };
    return { status: 'blocked', reason: `probe image is ${probe.size.width}x${probe.size.height}, expected 1800x1200` };
  }

  if (probe.kind === 'not-image') return { status: 'blocked', reason: 'Imgur returned something that is not an image' };

  if (signals.apiRegionError === true) return { status: 'blocked', reason: 'Imgur API reports a region block' };
  if (signals.proxyWorks === true) {
    return { status: 'blocked', reason: 'Imgur is unreachable but the proxy works' };
  }
  const what = probe.kind === 'http-error' ? `HTTP ${probe.status}` : 'a network error';
  return { status: 'unknown', reason: `probe failed with ${what}` };
}

/** Does an api.imgur.com reply look like the region block? */
export function isRegionError(status: number, body: string): boolean {
  return status === 403 && /not available in your region/i.test(body);
}

export interface DetectDeps {
  probe: () => Promise<ProbeResult>;
  apiRegionError: () => Promise<boolean | null>;
  proxyWorks: () => Promise<boolean | null>;
}

/** Run the probe, and the secondary checks only when the probe is inconclusive. */
export async function detect(deps: DetectDeps): Promise<Verdict> {
  const probe = await deps.probe();
  if (probe.kind === 'size' || probe.kind === 'not-image') return decide({ probe });

  const apiRegionError = await deps.apiRegionError();
  if (apiRegionError) return decide({ probe, apiRegionError });

  return decide({ probe, apiRegionError, proxyWorks: await deps.proxyWorks() });
}
