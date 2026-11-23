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
      // Lets the popup see which site the current tab is on.
      'activeTab',
      ...(browser === 'firefox' ? [] : ['offscreen']),
    ],
    host_permissions: [
      '*://imgur.com/*',
      '*://*.imgur.com/*',
      'https://external-content.duckduckgo.com/*',
      'https://rimgo.codeberg.page/*',
    ],
    optional_host_permissions: ['*://*/*'],
    action: { default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png' } },
    // Album, post and video links are redirected to the viewer, and Imgur's
    // album embeds load it in an iframe, so any page may open it.
    web_accessible_resources: [{ resources: ['viewer.html'], matches: ['*://*/*'] }],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'imgurpass@kemurixd',
              strict_min_version: '140.0',
              // Imgur media addresses go to DuckDuckGo or a rimgo mirror, which fetch them.
              data_collection_permissions: { required: ['websiteContent'] },
            },
          },
        }
      : {}),
  }),
});
