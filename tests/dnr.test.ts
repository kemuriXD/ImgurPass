import { describe, expect, it } from 'vitest';
import { buildRules, RULE_IDS, type RuleOptions } from '../lib/dnr';
import { duckDuckGoUrl } from '../lib/imgur-url';

const VIEWER = 'chrome-extension://abc/viewer.html';
const OPTIONS: RuleOptions = { viewerUrl: VIEWER, videoInstance: 'https://ri.example' };

/**
 * Apply rules the way DNR does: highest priority wins, an allow rule stops
 * redirects, regexSubstitution expands \0..\9.
 */
function apply(url: string, type: string, options = OPTIONS): string | null {
  const re = (rule: ReturnType<typeof buildRules>[number]) =>
    new RegExp(rule.condition.regexFilter!, rule.condition.isUrlFilterCaseSensitive === false ? 'i' : '');
  const matching = buildRules(options)
    .filter((rule) => rule.condition.resourceTypes?.includes(type as never))
    .filter((rule) => re(rule).test(url))
    .sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1));
  const rule = matching[0];
  if (!rule || rule.action.type === 'allow') return null;
  const m = re(rule).exec(url)!;
  return rule.action.redirect!.regexSubstitution!.replace(/\\(\d)/g, (_, n) => m[Number(n)] ?? '');
}

describe('buildRules', () => {
  it('uses only ids it owns, each once', () => {
    const ids = buildRules(OPTIONS).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(RULE_IDS).toContain(id);
  });

  it.each([
    ['https://i.imgur.com/OB0y6MR.jpg', duckDuckGoUrl('OB0y6MR', 'jpg')],
    ['http://i.imgur.com/OB0y6MR.png?1', duckDuckGoUrl('OB0y6MR', 'png')],
    ['https://i.imgur.com/OB0y6MR.jpeg?maxwidth=640&shape=thumb', duckDuckGoUrl('OB0y6MR', 'jpeg')],
    ['https://i.imgur.com/OB0y6MRh.webp', duckDuckGoUrl('OB0y6MRh', 'webp')],
    ['https://i.imgur.com/OB0y6MR', duckDuckGoUrl('OB0y6MR', 'jpg')],
    ['https://imgur.com/OB0y6MR.gif', duckDuckGoUrl('OB0y6MR', 'gif')],
    ['https://i.imgur.com/OB0y6MR.jpg:large', duckDuckGoUrl('OB0y6MR', 'jpg')],
  ])('sends image %s to DuckDuckGo', (input, expected) => {
    expect(apply(input, 'image')).toBe(expected);
    expect(apply(input, 'main_frame')).toBe(expected);
  });

  it.each([
    ['https://imgur.com/a/AbCd1', `${VIEWER}#a/AbCd1`],
    ['https://imgur.com/a/AbCd123/embed?pub=true', `${VIEWER}#a/AbCd123`],
    ['http://www.imgur.com/a/AbCd123?foo=bar', `${VIEWER}#a/AbCd123`],
    ['https://imgur.com/gallery/funny-cat-AbCd123', `${VIEWER}#gallery/AbCd123`],
    ['https://imgur.com/gallery/AbCd123', `${VIEWER}#gallery/AbCd123`],
    ['https://m.imgur.com/abcde12', `${VIEWER}#post/abcde12`],
    ['https://imgur.com/abcde12/', `${VIEWER}#post/abcde12`],
    ['https://imgur.com/t/cats/abcde12', `${VIEWER}#post/abcde12`],
    ['https://imgur.com/r/aww/abcde12', `${VIEWER}#post/abcde12`],
    ['https://i.imgur.com/abcde12.gifv', `${VIEWER}#media/abcde12.gifv`],
    ['https://i.imgur.com/abcde12.mp4?x=1', `${VIEWER}#media/abcde12.mp4`],
    ['https://imgur.com/abcde12.gifv', `${VIEWER}#media/abcde12.gifv`],
  ])('opens %s in the viewer', (input, expected) => {
    expect(apply(input, 'main_frame')).toBe(expected);
    expect(apply(input, 'sub_frame')).toBe(expected);
  });

  it.each([
    'https://imgur.com/upload',
    'https://imgur.com/signin',
    'https://imgur.com/search?q=cats',
    'https://imgur.com/',
    'https://imgur.com/user/someone',
    'https://imgur.com/gallery',
    'https://imgur.com/settings',
    'https://imgur.com/somepage',
    'https://imgur.com/a',
  ])(
    'leaves site page %s alone',
    (input) => {
      expect(apply(input, 'main_frame')).toBeNull();
    },
  );

  it('sends embedded videos to the video instance', () => {
    expect(apply('https://i.imgur.com/abcde12.mp4', 'media')).toBe('https://ri.example/abcde12.mp4');
    expect(apply('https://i.imgur.com/abcde12.gifv', 'media')).toBe('https://ri.example/abcde12.mp4');
    expect(apply('https://i.imgur.com/abcde12.mp4', 'media', { ...OPTIONS, videoInstance: null })).toBeNull();
  });

  it.each([
    'https://i.imgur.com/abcde12.jpg.png/x',
    'https://example.com/i.imgur.com/abcde12.jpg',
    'https://imgur.com.evil.example/a/AbCd1',
  ])('leaves %s alone', (input) => {
    for (const type of ['image', 'main_frame', 'media']) expect(apply(input, type)).toBeNull();
  });

  it('does not send videos to the image proxy', () => {
    expect(apply('https://i.imgur.com/abcde12.mp4', 'image')).toBeNull();
  });
});
