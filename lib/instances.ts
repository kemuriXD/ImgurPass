import { normalizeInstance } from './imgur-url';

export const INSTANCE_LIST_URL = 'https://rimgo.codeberg.page/api.json';

export interface Instance {
  /** Normalised origin, e.g. "https://ri.bcow.xyz". */
  url: string;
  /** The list says "Data not collected". */
  noData: boolean;
  country?: string;
}

export interface Health {
  ok: boolean;
  checkedAt: number;
  /** Consecutive failures reported from pages since the last success. */
  failures: number;
}

export type HealthMap = Record<string, Health>;

/** Failures reported by pages before an instance counts as down. One bad image isn't enough. */
export const SOFT_FAILURE_LIMIT = 3;

/**
 * Parse rimgo's api.json. Data only: anything that isn't a well-formed https
 * origin is dropped, and only the fields we need are kept.
 */
export function parseInstanceList(json: unknown): Instance[] {
  const clearnet = (json as { clearnet?: unknown } | null)?.clearnet;
  if (!Array.isArray(clearnet)) return [];
  const seen = new Set<string>();
  const out: Instance[] = [];
  for (const entry of clearnet) {
    if (!entry || typeof entry !== 'object') continue;
    const { url, note, country } = entry as Record<string, unknown>;
    if (typeof url !== 'string') continue;
    const origin = normalizeInstance(url);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    const noteText = typeof note === 'string' ? note : '';
    out.push({
      url: origin,
      noData: /data not collected/i.test(noteText),
      ...(typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? { country } : {}),
    });
  }
  return out;
}

/** Fisher-Yates shuffle (copy). */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface OrderOptions {
  onlyNoData: boolean;
  customInstance?: string;
  random?: () => number;
}

/**
 * Instances to try, best first. Healthy before untested; within each, "data
 * not collected" first; each group shuffled to spread load. Down instances are
 * skipped. The user's custom instance always comes last.
 */
export function orderInstances(list: readonly Instance[], health: HealthMap, opts: OrderOptions): string[] {
  const random = opts.random ?? Math.random;
  const groups: Instance[][] = [[], [], [], []];
  for (const inst of list) {
    if (opts.onlyNoData && !inst.noData) continue;
    const h = health[inst.url];
    if (h && !h.ok) continue;
    groups[(h ? 0 : 2) + (inst.noData ? 0 : 1)]!.push(inst);
  }
  const ordered = groups.flatMap((g) => shuffle(g, random).map((i) => i.url));

  const custom = opts.customInstance ? normalizeInstance(opts.customInstance) : null;
  if (custom) return [...ordered.filter((u) => u !== custom), custom];
  return ordered;
}

/** Result of a full health check (known probe image): authoritative. */
export function withCheckResult(health: HealthMap, url: string, ok: boolean, now: number): HealthMap {
  return { ...health, [url]: { ok, checkedAt: now, failures: ok ? 0 : SOFT_FAILURE_LIMIT } };
}

/** An image failed to load from this instance on a page. Might just be a missing image. */
export function withReportedFailure(health: HealthMap, url: string, now: number): HealthMap {
  const prev = health[url];
  const failures = (prev?.failures ?? 0) + 1;
  return { ...health, [url]: { ok: failures < SOFT_FAILURE_LIMIT, checkedAt: prev?.checkedAt ?? now, failures } };
}

/** An image loaded from this instance on a page. */
export function withReportedSuccess(health: HealthMap, url: string, now: number): HealthMap {
  return { ...health, [url]: { ok: true, checkedAt: now, failures: 0 } };
}
