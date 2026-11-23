import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'ImgurPass (unofficial)',
    description:
      'View Imgur images where Imgur is blocked, through DuckDuckGo and rimgo. Not affiliated with Imgur.',
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
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: { id: 'imgurpass@kemurixd', strict_min_version: '128.0' },
          },
        }
      : {}),
  }),
});
