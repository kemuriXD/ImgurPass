/** Hosts ImgurPass itself talks to. Pausing or granting them makes no sense. */
const OWN_HOSTS = /(?:^|\.)(?:imgur\.com|duckduckgo\.com)$/i;

/**
 * The site a tab is on, as a hostname, when it's a web page ImgurPass could
 * fix images on. Null for browser pages, extension pages and Imgur itself.
 */
export function siteHost(url: string | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (!host || OWN_HOSTS.test(host)) return null;
  return host;
}

/** Host permission pattern for one site. */
export const sitePattern = (host: string) => `*://${host}/*`;

/** Whether a hostname is one of the paused sites or a subdomain of one. */
export function isPaused(host: string | null | undefined, paused: readonly string[]): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return paused.some((p) => h === p || h.endsWith(`.${p}`));
}

/**
 * Sites the user granted one by one: granted origins that are plain
 * `*://host/*` patterns, minus the ones the manifest asks for anyway.
 */
export function grantedSites(origins: readonly string[], required: readonly string[]): string[] {
  const hosts = new Set<string>();
  for (const origin of origins) {
    if (required.includes(origin)) continue;
    const m = /^(?:\*|https?):\/\/([^/*]+)\/\*$/.exec(origin);
    if (m) hosts.add(m[1]!.toLowerCase());
  }
  return [...hosts].sort();
}
