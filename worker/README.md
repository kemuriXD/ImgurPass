# ImgurPass backup server

A small Cloudflare Worker that fetches Imgur media and posts from Cloudflare's
servers, where Imgur isn't blocked. It answers like a rimgo mirror, so the
extension can use it as a custom rimgo instance.

It only ever fetches `i.imgur.com` and `api.imgur.com`, only for the paths
below, and only answers GET and HEAD.

## Deploy

```sh
cd worker
npm install
npx wrangler deploy
```

Album, gallery and post pages need an Imgur API client id. Imgur no longer takes
new app registrations, so by default the Worker uses rimgo's public client id.
That id is shared by many rimgo mirrors and often rate limited, which is why
pages are cached for a day. If you already have a client id of your own, set it
as a secret before deploying:

```sh
npx wrangler secret put IMGUR_CLIENT_ID
```

Images and videos come straight from `i.imgur.com` and don't use the API.

To use your own deployment, add its URL (e.g. `https://imgurpass.<you>.workers.dev`)
under "Your own rimgo mirror" in the extension's settings, and press Test.

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
