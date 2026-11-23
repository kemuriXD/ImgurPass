import { describe, expect, it } from 'vitest';
import { grantedSites, isPaused, siteHost, sitePattern } from '../lib/sites';

describe('siteHost', () => {
  it.each([
    ['https://forums.example.org/t/123', 'forums.example.org'],
    ['http://Blog.Example.com:8080/x', 'blog.example.com'],
    ['https://imgur.com/a/abc', null],
    ['https://i.imgur.com/abc.jpg', null],
    ['https://external-content.duckduckgo.com/iu/?u=x', null],
    ['chrome://extensions', null],
    ['chrome-extension://abc/viewer.html', null],
    ['about:blank', null],
    ['not a url', null],
    [undefined, null],
  ])('%s -> %s', (url, host) => {
    expect(siteHost(url)).toBe(host);
  });
});

describe('isPaused', () => {
  it('matches the site and its subdomains only', () => {
    const paused = ['example.org'];
    expect(isPaused('example.org', paused)).toBe(true);
    expect(isPaused('forums.example.org', paused)).toBe(true);
    expect(isPaused('badexample.org', paused)).toBe(false);
    expect(isPaused(null, paused)).toBe(false);
  });
});

describe('grantedSites', () => {
  it('lists single sites the user granted, not required or all-sites origins', () => {
    const required = ['*://imgur.com/*', 'https://rimgo.codeberg.page/*'];
    const origins = [...required, '*://*/*', sitePattern('forums.example.org'), 'https://blog.example.com/*', '*://*.wild.example/*'];
    expect(grantedSites(origins, required)).toEqual(['blog.example.com', 'forums.example.org']);
  });
});
