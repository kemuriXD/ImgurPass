import { describe, expect, it } from 'vitest';
import {
  duckDuckGoUrl,
  normalizeInstance,
  parseImgurUrl,
  rimgoAlbumUrl,
  rimgoGalleryUrl,
  rimgoMediaUrl,
  unwrapDuckDuckGo,
} from '../lib/imgur-url';

describe('parseImgurUrl', () => {
  it.each([
    ['https://i.imgur.com/OB0y6MR.jpg', { kind: 'image', id: 'OB0y6MR', ext: 'jpg' }],
    ['http://i.imgur.com/OB0y6MR.png', { kind: 'image', id: 'OB0y6MR', ext: 'png' }],
    ['//i.imgur.com/OB0y6MR.jpeg', { kind: 'image', id: 'OB0y6MR', ext: 'jpeg' }],
    ['https://i.imgur.com/OB0y6MR.JPG', { kind: 'image', id: 'OB0y6MR', ext: 'jpg' }],
    ['https://i.imgur.com/OB0y6MR.jpg?1', { kind: 'image', id: 'OB0y6MR', ext: 'jpg' }],
    ['https://i.imgur.com/OB0y6MR.jpg?maxwidth=640&shape=thumb#x', { kind: 'image', id: 'OB0y6MR', ext: 'jpg' }],
    ['https://i.imgur.com/OB0y6MR.jpg:large', { kind: 'image', id: 'OB0y6MR', ext: 'jpg' }],
    ['https://i.imgur.com/OB0y6MRh.webp', { kind: 'image', id: 'OB0y6MRh', ext: 'webp' }],
    ['https://i.imgur.com/OB0y6MR', { kind: 'image', id: 'OB0y6MR', ext: 'jpg' }],
    ['https://i.imgur.com/OB0y6MR.weird', { kind: 'image', id: 'OB0y6MR', ext: 'jpg' }],
    ['https://i.imgur.com/abcde12.gif', { kind: 'image', id: 'abcde12', ext: 'gif' }],
    ['https://i.imgur.com/abcde12.gifv', { kind: 'video', id: 'abcde12', ext: 'gifv' }],
    ['https://i.imgur.com/abcde12.mp4', { kind: 'video', id: 'abcde12', ext: 'mp4' }],
    ['https://i.imgur.com/abcde12.webm', { kind: 'video', id: 'abcde12', ext: 'webm' }],
    ['https://imgur.com/abcde12.png', { kind: 'image', id: 'abcde12', ext: 'png' }],
    ['https://imgur.com/abcde12.gifv', { kind: 'video', id: 'abcde12', ext: 'gifv' }],
    ['https://imgur.com/a/AbCd1', { kind: 'album', id: 'AbCd1' }],
    ['http://www.imgur.com/a/AbCd123?foo=bar', { kind: 'album', id: 'AbCd123' }],
    ['https://imgur.com/gallery/funny-cat-AbCd123', { kind: 'gallery', id: 'AbCd123', slug: 'funny-cat' }],
    ['https://imgur.com/gallery/AbCd123', { kind: 'gallery', id: 'AbCd123' }],
    ['https://m.imgur.com/abcde12', { kind: 'post', id: 'abcde12' }],
    ['https://imgur.com/t/cats/abcde12', { kind: 'post', id: 'abcde12' }],
    ['https://imgur.com/r/aww/abcde12', { kind: 'post', id: 'abcde12' }],
    ['https://imgur.com/', { kind: 'other' }],
    ['https://imgur.com/upload', { kind: 'other' }],
    ['https://imgur.com/user/someone', { kind: 'other' }],
    ['https://i.imgur.com/', { kind: 'other' }],
    ['https://i.imgur.com/a/b.jpg', { kind: 'other' }],
    ['https://i.imgur.com/x.jpg', { kind: 'other' }],
  ])('%s', (input, expected) => {
    expect(parseImgurUrl(input)).toEqual(expected);
  });

  it.each([
    'https://example.com/OB0y6MR.jpg',
    'https://notimgur.com/OB0y6MR',
    'https://imgur.com.evil.example/OB0y6MR.jpg',
    'ftp://i.imgur.com/OB0y6MR.jpg',
    'not a url',
  ])('rejects %s', (input) => {
    expect(parseImgurUrl(input)).toBeNull();
  });
});

describe('duckDuckGoUrl', () => {
  it('encodes the canonical https URL with no fake suffix', () => {
    expect(duckDuckGoUrl('OB0y6MR', 'jpg')).toBe(
      'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fi.imgur.com%2FOB0y6MR.jpg',
    );
  });

  it('round-trips through unwrapDuckDuckGo', () => {
    expect(unwrapDuckDuckGo(duckDuckGoUrl('OB0y6MR', 'png'))).toBe('https://i.imgur.com/OB0y6MR.png');
    expect(unwrapDuckDuckGo('https://example.com/?u=x')).toBeNull();
  });
});

describe('rimgo URLs', () => {
  it('builds media, album and gallery URLs', () => {
    expect(rimgoMediaUrl('https://ri.bcow.xyz/', 'abcde12', 'mp4')).toBe('https://ri.bcow.xyz/abcde12.mp4');
    expect(rimgoAlbumUrl('https://ri.bcow.xyz', 'AbCd1')).toBe('https://ri.bcow.xyz/a/AbCd1');
    expect(rimgoGalleryUrl('https://ri.bcow.xyz', 'AbCd123', 'funny-cat')).toBe(
      'https://ri.bcow.xyz/gallery/funny-cat-AbCd123',
    );
    expect(rimgoGalleryUrl('https://ri.bcow.xyz', 'AbCd123')).toBe('https://ri.bcow.xyz/gallery/AbCd123');
  });

  it('normalises instance URLs', () => {
    expect(normalizeInstance('ri.bcow.xyz')).toBe('https://ri.bcow.xyz');
    expect(normalizeInstance('https://ri.bcow.xyz/some/path/')).toBe('https://ri.bcow.xyz');
    expect(normalizeInstance('http://ri.bcow.xyz')).toBeNull();
    expect(normalizeInstance('https://user:pw@ri.bcow.xyz')).toBeNull();
    expect(normalizeInstance('localhost')).toBeNull();
  });
});
