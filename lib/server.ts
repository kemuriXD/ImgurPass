/**
 * The ImgurPass server: a backup run by the extension's author that answers
 * like a rimgo mirror (same media paths, same album and post pages). Tried
 * before the public mirrors while the "Use the ImgurPass server" setting is on.
 */
export const IMGURPASS_SERVER = 'https://imgurpass.kemurixd.workers.dev';

/** Whether a URL points at the ImgurPass server. */
export const isServerUrl = (url: string | null | undefined) => !!url && (url === IMGURPASS_SERVER || url.startsWith(`${IMGURPASS_SERVER}/`));

/** Button text for opening a page on a mirror: the server is named, anything else is "rimgo". */
export const openOnLabel = (url: string | null | undefined) => (isServerUrl(url) ? 'Open on the ImgurPass server' : 'Open on rimgo');

/** Host permission pattern for the server, so the extension can read its album pages. */
export const IMGURPASS_SERVER_HOSTS = `${IMGURPASS_SERVER}/*`;
