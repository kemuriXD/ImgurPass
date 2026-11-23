import type { Instance } from './instances';

/**
 * Fallback copy of the public rimgo instance list, used until (or whenever)
 * https://rimgo.codeberg.page/api.json can't be fetched. Snapshot 2026-11-23.
 */
export const BUNDLED_INSTANCES: Instance[] = [
  ['https://ri.bcow.xyz', false, 'CA'],
  ['https://rimgo.pussthecat.org', false, 'DE'],
  ['https://imgur.artemislena.eu', true, 'DE'],
  ['https://rimgo.hostux.net', false, 'FR'],
  ['https://ri.nadeko.net', true, 'CL'],
  ['https://rimgo.nohost.network', true, 'MX'],
  ['https://rimgo.catsarch.com', false, 'US'],
  ['https://rimgo.ducks.party', true, 'NL'],
  ['https://rmgur.com', true, 'PL'],
  ['https://rimgo.privacyredirect.com', true, 'FI'],
  ['https://rimgo.reallyaweso.me', true, 'DE'],
  ['https://rimgo.bloat.cat', true, 'DE'],
  ['https://rimgo.darkness.services', true, 'US'],
  ['https://rimgo.4o1x5.dev', false, 'HU'],
  ['https://rimgo.aketawi.space', true, 'RU'],
  ['https://imgur.nerdvpn.de', true, 'UA'],
  ['https://rimgo.canine.tools', false, 'US'],
  ['https://r.opnxng.com', true, 'DE'],
  ['https://rimgo.proxik.cloud', true, 'DE'],
  ['https://anaimg.starbeamrainbowlabs.com', true, 'FR'],
  ['https://rimgo.wuemeli.com', false, 'CH'],
  ['https://rimgo.manerakai.com', false, 'TR'],
].map(([url, noData, country]) => ({ url, noData, country }) as Instance);
