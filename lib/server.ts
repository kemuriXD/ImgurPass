/**
 * The ImgurPass server: a backup run by the extension's author that answers
 * like a rimgo mirror (same media paths, same album and post pages). Tried
 * before the public mirrors while the "Use the ImgurPass server" setting is on.
 */
export const IMGURPASS_SERVER = 'https://imgurpass.kemurixd.workers.dev';

/** Host permission pattern for the server, so the extension can read its album pages. */
export const IMGURPASS_SERVER_HOSTS = `${IMGURPASS_SERVER}/*`;
