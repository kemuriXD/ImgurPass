import { expect, png, ruleIds, SETTINGS, test } from './fixtures';

const IMAGE_RULES = [1, 2, 3];

const welcomePage = async (context: import('@playwright/test').BrowserContext) =>
  context.pages().find((p) => p.url().endsWith('/welcome.html')) ?? (await context.waitForEvent('page'));

test('opens the first-run page after install', async ({ context }) => {
  const page = await welcomePage(context);
  await expect(page).toHaveURL(/\/welcome\.html$/);
  await expect(page.getByRole('heading', { name: 'ImgurPass is installed' })).toBeVisible();
  // Access to all sites is already granted in this test browser.
  await expect(page.getByText('Done. Imgur images on other sites get fixed too.')).toBeVisible();
});

test.describe('while unblocking', () => {
  test.beforeEach(async ({ setStorage, background }) => {
    await setStorage({ settings: SETTINGS });
    await expect.poll(() => ruleIds(background)).toEqual(expect.arrayContaining(IMAGE_RULES));
    // Turning unblocking on starts a mirror health check. Let it finish (offline,
    // so quickly) before a test stores its own mirror health.
    await expect
      .poll(() => background.evaluate(async () => (await chrome.storage.local.get('lastHealthCheck')).lastHealthCheck ?? 0))
      .toBeGreaterThan(0);
  });

  test('sends embedded images to DuckDuckGo', async ({ context, site }) => {
    const proxied: string[] = [];
    await context.route('https://external-content.duckduckgo.com/**', (route) => {
      proxied.push(route.request().url());
      return route.fulfill({ body: png(4, 3), contentType: 'image/png' });
    });
    const page = await context.newPage();
    await page.goto(`${site}/embeds.html`);

    await expect.poll(() => proxied.length).toBeGreaterThanOrEqual(7);
    expect(proxied).toContain('https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fi.imgur.com%2FOB0y6MR.png');
    await expect
      .poll(() => page.evaluate(() => [...document.images].every((img) => img.complete && img.naturalWidth === 4)))
      .toBe(true);
  });

  test('retries a failed image through a rimgo mirror', async ({ context, site, setStorage, background }) => {
    const mirror = 'https://rimgo.example';
    await setStorage({
      instances: { fetchedAt: Date.now(), list: [{ url: mirror, noData: true }] },
      health: { [mirror]: { ok: true, checkedAt: Date.now(), failures: 0 } },
      lastHealthCheck: Date.now(),
    });
    await context.route('https://external-content.duckduckgo.com/**', (route) => route.fulfill({ status: 502 }));
    const fromMirror: string[] = [];
    await context.route(`${mirror}/**`, (route) => {
      fromMirror.push(route.request().url());
      return route.fulfill({ body: png(4, 3), contentType: 'image/png' });
    });
    const page = await context.newPage();
    await page.goto(`${site}/embeds.html`);

    await expect.poll(() => page.evaluate(() => document.images[0]?.dataset.imgurpass)).toBe('rimgo');
    expect(fromMirror).toContain(`${mirror}/OB0y6MR.jpg`);
  });

  test("swaps Imgur's own embed code for the viewer", async ({ context, site, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${site}/imgur-embed.html`);
    const frame = page.locator('iframe[data-imgurpass-embed]');
    await expect(frame).toHaveAttribute('src', `chrome-extension://${extensionId}/viewer.html#a/tUlsG`);
    await expect(page.locator('blockquote.imgur-embed-pub')).toHaveCount(0);
  });

  test('opens album links in the viewer', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto('https://imgur.com/a/AbCd123').catch(() => {});
    await expect(page).toHaveURL(`chrome-extension://${extensionId}/viewer.html#a/AbCd123`);
  });

  test('leaves paused sites alone', async ({ context, site, setStorage, background }) => {
    await setStorage({ settings: { ...SETTINGS, pausedSites: ['127.0.0.1'] } });
    await expect
      .poll(() =>
        background.evaluate(
          async () => (await chrome.declarativeNetRequest.getDynamicRules())[0]?.condition.excludedInitiatorDomains,
        ),
      )
      .toEqual(['127.0.0.1']);
    const direct: string[] = [];
    await context.route('https://i.imgur.com/**', (route) => {
      direct.push(route.request().url());
      return route.fulfill({ body: png(4, 3), contentType: 'image/png' });
    });
    const page = await context.newPage();
    await page.goto(`${site}/embeds.html`);
    await expect.poll(() => direct.length).toBeGreaterThan(0);
  });

  test('the popup shows the state and turns everything off', async ({ openExtensionPage, background }) => {
    const popup = await openExtensionPage('popup.html');
    await expect(popup.getByText('Unblocking Imgur')).toBeVisible();

    await popup.getByRole('checkbox', { name: 'ImgurPass on' }).click();
    await expect(popup.getByText('ImgurPass is off')).toBeVisible();
    await expect.poll(() => ruleIds(background)).toEqual([]);
  });

  test('settings can put rimgo first', async ({ openExtensionPage, setStorage, background }) => {
    const mirror = 'https://rimgo.example';
    await setStorage({
      instances: { fetchedAt: Date.now(), list: [{ url: mirror, noData: true }] },
      health: { [mirror]: { ok: true, checkedAt: Date.now(), failures: 0 } },
    });
    const options = await openExtensionPage('options.html');
    await options.getByRole('button', { name: 'Move DuckDuckGo image proxy down' }).click();
    await expect(options.getByRole('button', { name: 'Move DuckDuckGo image proxy up' })).toBeVisible();

    await expect
      .poll(() =>
        background.evaluate(
          async () =>
            (await chrome.declarativeNetRequest.getDynamicRules()).find((r) => r.id === 1)?.action.redirect
              ?.regexSubstitution,
        ),
      )
      .toBe(`${mirror}/\\1.\\2`);
  });
});

test.describe('without access to all sites', () => {
  test.use({ allSites: false });

  test('the first-run page asks about other sites', async ({ context }) => {
    const page = await welcomePage(context);
    await expect(page.getByRole('button', { name: 'Fix embeds everywhere' })).toBeVisible();
    await page.getByRole('button', { name: 'Only direct links for now' }).click();
    await expect(page.getByText(/^OK\. Direct Imgur links get fixed/)).toBeVisible();
  });

  test('settings offer to fix embeds everywhere', async ({ openExtensionPage }) => {
    const options = await openExtensionPage('options.html');
    await expect(options.getByRole('checkbox', { name: /Fix embeds everywhere/ })).not.toBeChecked();
    await expect(options.getByRole('heading', { name: 'Site access' })).toBeVisible();
  });
});
