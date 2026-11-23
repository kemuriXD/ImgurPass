import { browser } from 'wxt/browser';

/**
 * Required host permissions the user (or browser) has withheld. Chrome lets
 * users switch off individual sites, and Firefox lets them revoke host access.
 * Without these, detection and the redirect rules don't work.
 */
export async function missingRequiredHosts(): Promise<string[]> {
  const required: string[] = browser.runtime.getManifest().host_permissions ?? [];
  const granted = await Promise.all(required.map((origin) => browser.permissions.contains({ origins: [origin] })));
  return required.filter((_, i) => !granted[i]);
}
