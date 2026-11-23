// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseRimgoPost } from '../lib/rimgo-parse';
import album from './fixtures/rimgo-album.html?raw';

describe('parseRimgoPost', () => {
  it('reads the title and every media item in order', () => {
    expect(parseRimgoPost(album)).toEqual({
      ok: true,
      album: {
        title: 'Retro PC build',
        media: [
          { id: 'AbCdE12', ext: 'jpg', kind: 'image', title: 'The case', description: 'Found at a flea market.\nNeeds cleaning.' },
          { id: 'FgHiJ34', ext: 'png', kind: 'image' },
          { id: 'KlMnO56', ext: 'mp4', kind: 'video', title: 'First boot', description: 'It works.' },
          { id: 'PqRsT78', ext: 'gif', kind: 'image' },
        ],
      },
    });
  });

  it('does not mistake a post titled like an error for an error page', () => {
    const html = album.replace('Retro PC build -', '404 memes -').replace('>Retro PC build<', '>404 memes<');
    expect(parseRimgoPost(html).ok).toBe(true);
  });

  it('keeps description text only, never markup', () => {
    const html = album.replace('Needs cleaning.', '<img src=x onerror="alert(1)"><script>alert(2)</script>');
    const result = parseRimgoPost(html);
    expect(result.ok && result.album.media[0]!.description).not.toMatch(/[<>]/);
  });

  it.each([
    ['a bot check', '<html><head><title>Making sure you&#39;re not a bot!</title></head><body><main></main></body></html>', 'not-rimgo'],
    ['a decoy page', '<!doctype html><title>The lectures, the creaking camaraderie.</title><main><h1>x</h1><p>y</p></main>', 'not-rimgo'],
    ['a rate limit', '<html><head><title>Rate limited by Imgur - rimgo</title></head><body><main><p>Try later</p></main></body></html>', 'rate-limited'],
    ['a missing album', '<html><head><title>404 - rimgo</title></head><body><main><p>Not found</p></main></body></html>', 'not-found'],
    ['an empty post', '<html><head><title>Empty - rimgo</title></head><body><main><div class="break-words"></div></main></body></html>', 'empty'],
  ])('rejects %s', (_name, html, reason) => {
    expect(parseRimgoPost(html)).toEqual({ ok: false, reason });
  });
});
