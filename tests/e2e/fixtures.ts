import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const BUILD = resolve('.output/chrome-mv3');
const FIXTURES = resolve('tests/fixtures');

/** A tiny solid PNG, so routed image requests decode to a known size. */
export function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

interface Fixtures {
  context: BrowserContext;
  background: Worker;
  extensionId: string;
  /** Base URL of a local server for tests/fixtures. */
  site: string;
  /** Write to the extension's storage.local from its background. */
  setStorage: (items: Record<string, unknown>) => Promise<void>;
  openExtensionPage: (path: string) => Promise<Page>;
}

export const test = base.extend<Fixtures & { allSites: boolean }>({
  // Stands in for the user granting "Fix embeds everywhere", which needs a
  // permission prompt a test can't click.
  allSites: [true, { option: true }],

  context: async ({ allSites }, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'imgurpass-e2e-'));
    const ext = join(dir, 'ext');
    cpSync(BUILD, ext, { recursive: true });
    if (allSites) {
      const manifestPath = join(ext, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.host_permissions.push('*://*/*');
      writeFileSync(manifestPath, JSON.stringify(manifest));
    }
    const context = await chromium.launchPersistentContext(join(dir, 'profile'), {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    // Tests run offline: anything not routed by a test fails like a blocked host.
    await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort('blockedbyclient'));
    await use(context);
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  },

  background: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ background }, use) => {
    await use(new URL(background.url()).host);
  },

  site: async ({}, use) => {
    const server: Server = createServer((req, res) => {
      const name = (req.url ?? '/').split('?')[0]!.replace(/^\/+/, '');
      try {
        if (!/^[\w.-]+\.html$/.test(name)) throw new Error('not found');
        res.writeHead(200, { 'content-type': 'text/html' }).end(readFileSync(join(FIXTURES, name)));
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    await use(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  },

  setStorage: async ({ background }, use) => {
    await use(async (items) => {
      await background.evaluate((i) => chrome.storage.local.set(i), items);
    });
  },

  openExtensionPage: async ({ context, extensionId }, use) => {
    await use(async (path) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/${path}`);
      return page;
    });
  },
});

export const expect = test.expect;

export const SETTINGS = {
  enabled: true,
  alwaysProxy: true,
  onlyNoDataInstances: false,
  customInstance: '',
  imageSource: 'duckduckgo',
  pausedSites: [] as string[],
};

/** Ids of the redirect rules the extension has installed right now. */
export const ruleIds = (background: Worker) =>
  background.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.id).sort((a, b) => a - b));
