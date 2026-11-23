import { describe, expect, it } from 'vitest';
import { imgurRouteUrl, parseViewerRoute, rimgoRouteUrl } from '../lib/viewer-route';

describe('parseViewerRoute', () => {
  it.each([
    ['#a/AbCd1', { kind: 'a', id: 'AbCd1' }],
    ['#gallery/AbCd123', { kind: 'gallery', id: 'AbCd123' }],
    ['post/abcde12', { kind: 'post', id: 'abcde12' }],
    ['#media/abcde12.gifv', { kind: 'media', id: 'abcde12', ext: 'gifv' }],
    ['#media/abcde12.MP4', { kind: 'media', id: 'abcde12', ext: 'mp4' }],
  ])('%s', (hash, expected) => {
    expect(parseViewerRoute(hash)).toEqual(expected);
  });

  it.each(['', '#', '#a/', '#a/x', '#a/AbCd1/extra', '#media/abcde12.jpg', '#user/someone', '#a/<script>'])(
    'rejects %j',
    (hash) => {
      expect(parseViewerRoute(hash)).toBeNull();
    },
  );
});

describe('route URLs', () => {
  const inst = 'https://ri.example/';
  it.each([
    [{ kind: 'a', id: 'AbCd1' } as const, 'https://ri.example/a/AbCd1', 'https://imgur.com/a/AbCd1'],
    [{ kind: 'gallery', id: 'AbCd123' } as const, 'https://ri.example/gallery/AbCd123', 'https://imgur.com/gallery/AbCd123'],
    [{ kind: 'post', id: 'abcde12' } as const, 'https://ri.example/abcde12', 'https://imgur.com/abcde12'],
    [{ kind: 'media', id: 'abcde12', ext: 'gifv' } as const, 'https://ri.example/abcde12.mp4', 'https://i.imgur.com/abcde12.gifv'],
  ])('%j', (route, rimgo, imgur) => {
    expect(rimgoRouteUrl(inst, route)).toBe(rimgo);
    expect(imgurRouteUrl(route)).toBe(imgur);
  });
});
