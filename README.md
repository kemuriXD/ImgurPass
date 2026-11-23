# ImgurPass

Unofficial browser extension that loads Imgur images where Imgur is blocked: the UK, other countries, and school or work networks. It isn't affiliated with Imgur.

It checks whether Imgur is blocked for you. If it is, Imgur images load through the DuckDuckGo image proxy, and if that fails, through public [rimgo](https://codeberg.org/rimgo/rimgo) instances. If Imgur isn't blocked, it does nothing.

Status: early development. Images work. Videos and albums aren't supported yet.

## Build

You need Node.js 20 or newer and pnpm. Corepack can provide pnpm: run `corepack enable`, or prefix commands with `corepack`.

```sh
pnpm install
pnpm test            # unit tests
pnpm build           # Chrome/Chromium -> .output/chrome-mv3
pnpm build:firefox   # Firefox         -> .output/firefox-mv3
```

`pnpm dev` and `pnpm dev:firefox` start a dev build with live reload.

## Load unpacked

**Chrome, Edge, Brave:** open `chrome://extensions`, turn on Developer mode, click "Load unpacked", and pick `.output/chrome-mv3`.

**Firefox:** open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on…", and pick `.output/firefox-mv3/manifest.json`.

Imgur images embedded on other sites only load if you allow access to all sites. Open the extension's options page and click "Fix embeds everywhere". Without that access, the extension can only fix direct `i.imgur.com` links.

## Privacy

There are no analytics and no accounts. While unblocking is on, Imgur image URLs go to DuckDuckGo or to a rimgo instance, which fetches the image. Nothing else leaves your browser. Once a day, the extension downloads the public rimgo instance list from `rimgo.codeberg.page`.

## License

MIT
