import type { Size } from './detect';
import type { Capability } from './instances';
import type { Detection, ImageSource } from './state';

/** Messages handled by the background script. */
export type BackgroundMessage =
  | { type: 'get-fallbacks'; capability?: Capability }
  | { type: 'instance-result'; instance: string; ok: boolean; capability?: Capability }
  | { type: 'get-status' }
  /** Embedded viewers read album pages through the background (see fetch-page in background.ts). */
  | { type: 'fetch-page'; url: string }
  | { type: 'recheck' };

/** Stands for the DuckDuckGo proxy in a fallback list. */
export const DDG_SOURCE = 'duckduckgo';

export interface FallbacksReply {
  /** False when unblocking is off, or paused on the page's site. */
  active: boolean;
  /** rimgo instance origins (or DDG_SOURCE), best first. */
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
  /** When the public mirror list was last downloaded (0: using the bundled copy). */
  listUpdatedAt: number;
  /** Sites the user allowed one at a time, as hostnames. */
  grantedSites: string[];
}

/** Sent from the popup to the content script in the page's top frame. */
export interface PageStatsMessage {
  type: 'page-stats';
  /** Where the redirect rules send images first. */
  imageVia: ImageSource;
}

export interface PageStats {
  duckduckgo: number;
  rimgo: number;
  failed: number;
}

/** Sent from the background to the Chrome offscreen document. */
export interface OffscreenProbeMessage {
  target: 'offscreen';
  type: 'probe-image';
  url: string;
}
export type OffscreenProbeReply = Size | null;

export const ALL_SITES = { origins: ['*://*/*'] };
