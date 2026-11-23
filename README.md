<p align="center"><img src="public/logo.svg" width="96" height="96" alt=""></p>

# ImgurPass

A browser extension that shows Imgur images, videos and albums where Imgur is blocked: in the UK, in other countries, and on school or work networks. It works in Chrome, Edge, Brave and other Chromium browsers, and in Firefox.

ImgurPass is unofficial. It isn't made by, affiliated with or endorsed by Imgur.

## What it does

ImgurPass checks whether Imgur is blocked for you. If it isn't, ImgurPass stays idle and changes nothing. If it is:

- **Images** load through the DuckDuckGo image proxy. If that fails, they're retried through public [rimgo](https://codeberg.org/rimgo/rimgo) mirrors.
- **Videos** load through a rimgo mirror.
- **Albums, galleries and posts** open in ImgurPass's own viewer, which reads them from a rimgo mirror. Click an image to see it full size. If no mirror answers, you're sent to the album on rimgo instead.

The check runs when the browser starts and every few hours. You can also run it from the toolbar button.

## Install

Store listings are on the way. Until then, download the zip for your browser from the [latest release](https://github.com/kemuriXD/ImgurPass/releases), or build it yourself (see below).

**Chrome, Edge, Brave:** unzip `imgurpass-<version>-chrome.zip`. Open `chrome://extensions`, turn on Developer mode, click "Load unpacked", and pick the unzipped folder.

**Firefox:** open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on…", and pick `imgurpass-<version>-firefox.zip`. Firefox removes temporary add-ons when it restarts.

## Using it

After installing, a welcome page explains what ImgurPass sends where and asks about other sites (see below).

The toolbar button shows whether Imgur is blocked and how many images on the current page were fixed. From there you can turn ImgurPass off, pause it on a site, or allow it on the site you're on.

The settings page has the rest:

- Always proxy, for networks that block Imgur in a way the check misses
- Sites you've paused, and sites you've allowed one at a time
- Whether images try DuckDuckGo or rimgo first
- Only using rimgo mirrors that say they don't collect data
- Your own rimgo mirror, with a button to test it

### Images on other sites

Out of the box, ImgurPass fixes direct Imgur links: `i.imgur.com` images, album links, and so on. Forums, blogs and other sites that embed Imgur images need more access. Your browser only lets an extension change what a site loads if you allow it on that site.

You can allow ImgurPass on every site ("Fix embeds everywhere"), or only on the sites you pick from the toolbar button. Your browser will warn that this lets ImgurPass read and change data on those sites. ImgurPass only looks for Imgur addresses in images and videos.

## Permissions

| Permission | Why |
| --- | --- |
| `declarativeNetRequest` | Redirects Imgur image, video and album requests to the proxy or the viewer. |
| `storage` | Keeps your settings, the last check's result and the mirror list. |
| `alarms` | Runs the block check and the mirror check every few hours. |
| `scripting` | Adds the script that retries failed images, on the sites you allow. |
| `activeTab` | Lets the toolbar button see which site you're on. |
| `offscreen` (Chrome only) | Loads a test image from each mirror to check it still works. |
| `imgur.com`, `*.imgur.com` | Checks whether Imgur is blocked, and redirects its requests. |
| `external-content.duckduckgo.com` | Checks the image proxy works. |
| `rimgo.codeberg.page` | Downloads the public rimgo mirror list. |
| All sites (optional) | Fixes Imgur images embedded on other sites, and reads album pages from mirrors in the viewer. Only asked for when you choose it. |

## Privacy

There are no analytics, crash reports or accounts.

While Imgur is blocked (or Always proxy is on), the address of each Imgur image, video or album you open goes to DuckDuckGo or to a rimgo mirror, which fetches it for you. They also see your IP address, as with any website. Nothing about the pages you visit is sent anywhere.

When Imgur isn't blocked, nothing goes to the proxies. The one exception: if Imgur doesn't answer the check at all, ImgurPass loads one test image through DuckDuckGo to tell a block from an outage. While unblocking is on, it also loads a test image from each rimgo mirror every few hours to see which ones work. Once a day ImgurPass downloads the public mirror list from `rimgo.codeberg.page`.

DuckDuckGo and each rimgo mirror have their own privacy policies.

## Known limits

- Public rimgo mirrors come and go. Many sit behind bot checks or are rate-limited by Imgur, so some days only one or two work. ImgurPass checks them regularly and tries the working ones first. If you can, run your own mirror and add it in settings.
- A mirror's bot check has to be passed in a normal tab before the viewer can read albums from it. If an album opens on rimgo instead of the viewer, that's usually why. After you've passed the check once, it opens in the viewer again.
- DuckDuckGo only proxies images, so videos and albums depend on rimgo.

## Development

You need Node.js 20 or newer and pnpm. Corepack provides pnpm: run `corepack enable`, or prefix commands with `corepack`.

```sh
pnpm install
pnpm dev             # Chrome dev build with live reload
pnpm dev:firefox     # Firefox dev build
pnpm build           # Chrome  -> .output/chrome-mv3
pnpm build:firefox   # Firefox -> .output/firefox-mv3
pnpm typecheck
pnpm test            # unit tests (Vitest)
pnpm test:e2e        # builds, then loads the extension in Chromium (Playwright)
```

The end-to-end tests run offline: every request outside `127.0.0.1` is answered by the test or fails. The first time, install the browser with `pnpm exec playwright install chromium`.

### Releases

1. Bump `version` in `package.json` and commit.
2. Tag the commit `v<version>` and push the tag.
3. GitHub Actions runs the tests, builds the Chrome and Firefox zips (plus the sources zip that addons.mozilla.org asks for), and attaches them to a draft release.

To build the zips locally, run `pnpm zip` and `pnpm zip:firefox`. They land in `.output/`.

## License

[MIT](LICENSE). Imgur is a trademark of its owner, used here only to say what the extension works with.
