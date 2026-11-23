import type { Size } from './detect';
import type { Capability } from './instances';
import type { Detection } from './state';

/** Messages handled by the background script. */
export type BackgroundMessage =
  | { type: 'get-fallbacks'; capability?: Capability }
  | { type: 'instance-result'; instance: string; ok: boolean; capability?: Capability }
  | { type: 'get-status' }
  | { type: 'recheck' };

export interface FallbacksReply {
  active: boolean;
  /** rimgo instance origins, best first. */
  instances: string[];
  /** Whether the extension may fetch pages from any site (needed to read album pages). */
  allSites: boolean;
}

export interface StatusReply {
  detection: Detection;
  active: boolean;
  allSites: boolean;
  /** Required host permissions that are currently withheld. */
  missingHosts: string[];
  healthyInstances: number;
  knownInstances: number;
}

/** Sent from the background to the Chrome offscreen document. */
export interface OffscreenProbeMessage {
  target: 'offscreen';
  type: 'probe-image';
  url: string;
}
export type OffscreenProbeReply = Size | null;

export const ALL_SITES = { origins: ['*://*/*'] };
