import { describe, expect, it } from 'vitest';
import { IMGURPASS_SERVER, isServerUrl, openOnLabel } from '../lib/server';

describe('server labels', () => {
  it('names the ImgurPass server and calls everything else rimgo', () => {
    expect(isServerUrl(`${IMGURPASS_SERVER}/a/tUlsG`)).toBe(true);
    expect(isServerUrl(IMGURPASS_SERVER)).toBe(true);
    expect(isServerUrl(`${IMGURPASS_SERVER}.evil.example/a/x`)).toBe(false);
    expect(isServerUrl(null)).toBe(false);
    expect(openOnLabel(`${IMGURPASS_SERVER}/a/tUlsG`)).toBe('Open on the ImgurPass server');
    expect(openOnLabel('https://ri.bcow.xyz/a/tUlsG')).toBe('Open on rimgo');
  });
});
