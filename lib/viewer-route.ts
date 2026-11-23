import { rimgoAlbumUrl, rimgoGalleryUrl, rimgoMediaUrl } from './imgur-url';

/** What the viewer page shows, from its URL hash (set by the redirect rules). */
export type ViewerRoute =
  | { kind: 'a' | 'gallery' | 'post'; id: string }
  | { kind: 'media'; id: string; ext: string };

const ID = '[A-Za-z0-9]{5,10}';

export function parseViewerRoute(hash: string): ViewerRoute | null {
  const h = hash.replace(/^#/, '');
  let m = new RegExp(`^(a|gallery|post)/(${ID})$`).exec(h);
  if (m) return { kind: m[1] as 'a' | 'gallery' | 'post', id: m[2]! };
  m = new RegExp(`^media/(${ID})\\.(gifv|mp4|webm)$`, 'i').exec(h);
  if (m) return { kind: 'media', id: m[1]!, ext: m[2]!.toLowerCase() };
  return null;
}

/** The same thing on a rimgo instance. */
export function rimgoRouteUrl(instance: string, route: ViewerRoute): string {
  switch (route.kind) {
    case 'a':
      return rimgoAlbumUrl(instance, route.id);
    case 'gallery':
      return rimgoGalleryUrl(instance, route.id);
    case 'post':
      return `${instance.replace(/\/+$/, '')}/${route.id}`;
    case 'media':
      return rimgoMediaUrl(instance, route.id, 'mp4');
  }
}

/** The original Imgur URL, for copying and sharing. */
export function imgurRouteUrl(route: ViewerRoute): string {
  switch (route.kind) {
    case 'a':
      return `https://imgur.com/a/${route.id}`;
    case 'gallery':
      return `https://imgur.com/gallery/${route.id}`;
    case 'post':
      return `https://imgur.com/${route.id}`;
    case 'media':
      return `https://i.imgur.com/${route.id}.${route.ext}`;
  }
}
