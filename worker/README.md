# ImgurPass backup server

A small Cloudflare Worker that fetches Imgur media and posts from Cloudflare's
servers, where Imgur isn't blocked. It answers like a rimgo mirror, so the
extension can use it as a custom rimgo instance.

It only ever fetches `i.imgur.com` and `api.imgur.com`, only for the paths
below, and only for GET, HEAD and OPTIONS.

## Deploy

```sh
cd worker
npm install
npx wrangler secret put IMGUR_CLIENT_ID   # your Imgur API client id
npx wrangler deploy
```

Without the secret it falls back to rimgo's public client id, which is shared
and often rate limited.

Then add the Worker's URL (e.g. `https://imgurpass.<you>.workers.dev`) as a
custom rimgo instance in the extension's options.

## Video

`ALLOW_VIDEO` in `wrangler.toml` turns video proxying on or off. Video uses far
more bandwidth than images; set it to `"false"` and redeploy to serve images
and albums only. Video requests then get a 403.

## Endpoints

| Path | Answer |
| --- | --- |
| `/{id}.{ext}` | Media from `i.imgur.com` (jpg, jpeg, png, gif, webp, avif, mp4, webm; gifv is served as mp4). Thumbnail suffixes work. Range requests work for video. |
| `/a/{id}` | Album page in rimgo's layout |
| `/gallery/{slug-}{id}` | Gallery post page |
| `/{id}` | Single post page |
| `/api/album/{id}` | Album as JSON: `{ "title", "media": [{ "id", "ext", "kind", "title?", "description?" }] }` |
| `/api/gallery/{id}` | Gallery post as the same JSON |

Errors are JSON (`{"error": "not-found"}`, `"rate-limited"`, `"upstream"`,
`"video-disabled"`, `"too-large"`, `"empty"`) except on the pages, which use
rimgo-style error pages (`404 - rimgo`, `Rate limited by Imgur - rimgo`).

Media is cached for 30 days, posts for a day, and not-found answers for five
minutes. Images over 25 MB and videos over 50 MB are refused. There are no CORS
headers: the extension doesn't need them, and leaving them out keeps other sites
from reading the server from their scripts.

## Where it runs

Imgur blocks UK addresses, and a Worker normally runs in the Cloudflare data centre nearest the visitor, so UK visitors would get Imgur's block page. `wrangler.toml` sets a placement hint (`aws:eu-central-1`) so the Worker runs near Frankfurt. Responses carry a `cf-placement: remote-FRA` header when that is working.
