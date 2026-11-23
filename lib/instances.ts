import { normalizeInstance } from './imgur-url';

export const INSTANCE_LIST_URL = 'https://rimgo.codeberg.page/api.json';

export interface Instance {
  /** Normalised origin, e.g. "https://ri.bcow.xyz". */
  url: string;
  /** The list says "Data not collected". */
  noData: boolean;
  country?: string;
}

/** What an instance is used for. Many mirrors serve images but not video or album pages. */
export type Capability = 'image' | 'video' | 'album';

export interface CapabilityHealth {
  ok: boolean;
  at: number;
  /** Consecutive failures since the last success. */
  failures?: number;
}

/** Album or video failures in a row before a mirror is benched for that use. */
export const CAPABILITY_FAILURE_LIMIT = 2;
/** Down mirrors still tried after everything else, so the list is never empty. */
export const LAST_RESORT_COUNT = 3;

export interface Health {
  /** Image health. */
  ok: boolean;
  checkedAt: number;
  /** Consecutive failures reported from pages since the last success. */
  failures: number;
  video?: CapabilityHealth;
  album?: CapabilityHealth;
}

/** A benched video or album mirror is tried normally again after this long. */
export const CAPABILITY_RETRY_MS = 30 * 60 * 1000;

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
  /** Defaults to "image". */
  capability?: Capability;
  now?: number;
  random?: () => number;
}

type Rank = 0 | 1 | 2 | 'down';

/**
 * 0 = known good for this use, 1 = known to serve images but not yet tried for
 * this use, 2 = untested, 'down' = failed. Down ones carry when they last
 * failed, so the longest-ago (likeliest recovered) go first.
 */
function rank(h: Health | undefined, capability: Capability, now: number): { r: Rank; failedAt: number } {
  const imageTested = !!h && (h.checkedAt > 0 || h.failures > 0);
  if (imageTested && !h.ok) return { r: 'down', failedAt: h.checkedAt };
  if (capability === 'image') return { r: imageTested ? 0 : 2, failedAt: 0 };
  const cap = h?.[capability];
  // A mirror that serves images is a better bet for albums and videos than one nobody has tried.
  const untried = { r: imageTested ? 1 : 2, failedAt: 0 } as const;
  if (!cap) return untried;
  if (cap.ok) return { r: 0, failedAt: 0 };
  return now - cap.at > CAPABILITY_RETRY_MS ? untried : { r: 'down', failedAt: cap.at };
}

/**
 * Instances to try, best first. Known good before untested; within each, "data
 * not collected" first; each group shuffled to spread load. Then, as a last
 * resort, a few down instances (they may have recovered since), so the list is
 * never empty while any instance exists. The user's custom instance comes last.
 */
export function orderInstances(list: readonly Instance[], health: HealthMap, opts: OrderOptions): string[] {
  const random = opts.random ?? Math.random;
  const capability = opts.capability ?? 'image';
  const now = opts.now ?? Date.now();
  const groups: Instance[][] = [[], [], [], [], [], []];
  const down: { url: string; failedAt: number }[] = [];
  for (const inst of list) {
    if (opts.onlyNoData && !inst.noData) continue;
    const { r, failedAt } = rank(health[inst.url], capability, now);
    if (r === 'down') down.push({ url: inst.url, failedAt });
    else groups[r * 2 + (inst.noData ? 0 : 1)]!.push(inst);
  }
  const ordered = [
    ...groups.flatMap((g) => shuffle(g, random).map((i) => i.url)),
    ...down
      .sort((a, b) => a.failedAt - b.failedAt)
      .slice(0, LAST_RESORT_COUNT)
      .map((d) => d.url),
  ];

  const custom = opts.customInstance ? normalizeInstance(opts.customInstance) : null;
  if (custom) return [...ordered.filter((u) => u !== custom), custom];
  return ordered;
}

const base = (h: Health | undefined): Health => h ?? { ok: true, checkedAt: 0, failures: 0 };

/** Result of a full health check (known probe image): authoritative. */
export function withCheckResult(health: HealthMap, url: string, ok: boolean, now: number): HealthMap {
  return { ...health, [url]: { ...base(health[url]), ok, checkedAt: now, failures: ok ? 0 : SOFT_FAILURE_LIMIT } };
}

/** An image failed to load from this instance on a page. Might just be a missing image. */
export function withReportedFailure(health: HealthMap, url: string, now: number): HealthMap {
  const prev = base(health[url]);
  const failures = prev.failures + 1;
  return { ...health, [url]: { ...prev, ok: failures < SOFT_FAILURE_LIMIT, checkedAt: prev.checkedAt || now, failures } };
}

/** An image loaded from this instance on a page. */
export function withReportedSuccess(health: HealthMap, url: string, now: number): HealthMap {
  const prev = base(health[url]);
  return { ...health, [url]: { ...prev, ok: true, checkedAt: prev.checkedAt || now, failures: 0 } };
}

/** A video or album page loaded (or didn't) from this instance. */
export function withCapabilityResult(
  health: HealthMap,
  url: string,
  capability: 'video' | 'album',
  ok: boolean,
  now: number,
): HealthMap {
  const prev = base(health[url]);
  const failures = ok ? 0 : (prev[capability]?.failures ?? 0) + 1;
  // One failure can be a rate limit or a timeout: bench only after several in a row.
  const result = { ok: ok || failures < CAPABILITY_FAILURE_LIMIT, at: now, failures };
  return { ...health, [url]: { ...prev, [capability]: result } };
}
