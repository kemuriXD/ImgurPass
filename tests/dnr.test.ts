import { describe, expect, it } from 'vitest';
import { buildImageRules, IMAGE_RULE_IDS } from '../lib/dnr';
import { duckDuckGoUrl } from '../lib/imgur-url';

/** Apply a rule the way DNR does: regexFilter + regexSubstitution (\0..\9). */
function apply(url: string): string | null {
  for (const rule of buildImageRules()) {
    const flags = rule.condition.isUrlFilterCaseSensitive === false ? 'i' : '';
    const m = new RegExp(rule.condition.regexFilter!, flags).exec(url);
    if (m) return rule.action.redirect!.regexSubstitution!.replace(/\\(\d)/g, (_, n) => m[Number(n)] ?? '');
  }
  return null;
}

describe('buildImageRules', () => {
  it('uses only the ids it owns', () => {
    expect(buildImageRules().map((r) => r.id)).toEqual([...IMAGE_RULE_IDS]);
  });

  it.each([
    ['https://i.imgur.com/OB0y6MR.jpg', duckDuckGoUrl('OB0y6MR', 'jpg')],
    ['http://i.imgur.com/OB0y6MR.png?1', duckDuckGoUrl('OB0y6MR', 'png')],
    ['https://i.imgur.com/OB0y6MR.jpeg?maxwidth=640&shape=thumb', duckDuckGoUrl('OB0y6MR', 'jpeg')],
    ['https://i.imgur.com/OB0y6MRh.webp', duckDuckGoUrl('OB0y6MRh', 'webp')],
    ['https://i.imgur.com/OB0y6MR', duckDuckGoUrl('OB0y6MR', 'jpg')],
    ['https://imgur.com/OB0y6MR.gif', duckDuckGoUrl('OB0y6MR', 'gif')],
    ['https://i.imgur.com/OB0y6MR.jpg:large', duckDuckGoUrl('OB0y6MR', 'jpg')],
  ])('redirects %s', (input, expected) => {
    expect(apply(input)).toBe(expected);
  });

  it('keeps the original case of the extension', () => {
    expect(apply('https://i.imgur.com/OB0y6MR.JPG')).toBe(duckDuckGoUrl('OB0y6MR', 'JPG'));
  });

  it.each([
    'https://i.imgur.com/abcde12.gifv',
    'https://i.imgur.com/abcde12.mp4',
    'https://imgur.com/a/AbCd1',
    'https://imgur.com/gallery/cat-AbCd123',
    'https://imgur.com/abcde12',
    'https://i.imgur.com/',
    'https://i.imgur.com/abcde12.jpg.png/x',
    'https://example.com/i.imgur.com/abcde12.jpg',
  ])('leaves %s alone', (input) => {
    expect(apply(input)).toBeNull();
  });
});
