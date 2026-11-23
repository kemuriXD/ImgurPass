import type { Size } from './detect';
import type { Detection } from './state';

/** Messages handled by the background script. */
export type BackgroundMessage =
  | { type: 'get-fallbacks' }
  | { type: 'instance-result'; instance: string; ok: boolean }
  | { type: 'get-status' }
  | { type: 'recheck' };

export interface FallbacksReply {
  active: boolean;
  /** rimgo instance origins, best first. */
  instances: string[];
}

export interface StatusReply {
  detection: Detection;
  active: boolean;
  allSites: boolean;
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
