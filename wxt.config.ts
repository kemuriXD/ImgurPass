import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'ImgurPass (unofficial)',
    description:
      'View Imgur images, videos and albums where Imgur is blocked, through DuckDuckGo and rimgo. Not affiliated with Imgur.',
    permissions: [
      'declarativeNetRequest',
      'storage',
      'alarms',
      'scripting',
      ...(browser === 'firefox' ? [] : ['offscreen']),
    ],
    host_permissions: [
      '*://imgur.com/*',
      '*://*.imgur.com/*',
      'https://external-content.duckduckgo.com/*',
      'https://rimgo.codeberg.page/*',
    ],
    optional_host_permissions: ['*://*/*'],
    // Album, post and video links are redirected to the viewer, and Imgur's
    // album embeds load it in an iframe, so any page may open it.
    web_accessible_resources: [{ resources: ['viewer.html'], matches: ['*://*/*'] }],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'imgurpass@kemurixd',
              strict_min_version: '140.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
});
