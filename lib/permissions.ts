import { browser } from 'wxt/browser';
import { IMGURPASS_SERVER_HOSTS } from './server';

/**
 * Required host permissions the user (or browser) has withheld. Chrome lets
 * users switch off individual sites, and Firefox lets them revoke host access.
 * Without these, detection and the redirect rules don't work. The ImgurPass
 * server isn't counted: without it, only its album pages need all-sites access.
 */
export async function missingRequiredHosts(): Promise<string[]> {
  const listed: string[] = browser.runtime.getManifest().host_permissions ?? [];
  const required = listed.filter((origin) => origin !== IMGURPASS_SERVER_HOSTS);
  const granted = await Promise.all(required.map((origin) => browser.permissions.contains({ origins: [origin] })));
  return required.filter((_, i) => !granted[i]);
}
