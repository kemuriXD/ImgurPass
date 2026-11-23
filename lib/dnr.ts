import { browser, type Browser } from 'wxt/browser';
import { RESERVED_PATHS } from './imgur-url';

type Rule = Browser.declarativeNetRequest.Rule;
type ResourceType = `${Browser.declarativeNetRequest.ResourceType}`;

/** Dynamic rule ids owned by this module. Anything else is left alone. */
export const RULE_IDS = [1, 2, 3, 4, 10, 11, 12, 13, 14, 15, 16] as const;

const EXT = '(jpe?g|png|gif|webp|avif|bmp|tiff?)';
const VIDEO_EXT = '(gifv|mp4|webm)';
const ID = '([A-Za-z0-9]{5,10})';
const TAIL = '(?:[?#:].*)?$';
const PAGE_HOST = '^https?://(?:www\\.|m\\.)?imgur\\.com';
const DDG = 'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fi.imgur.com%2F';

/**
 * Images: <img> loads and direct visits. The extension's own probe uses fetch
 * (xmlhttprequest), so it is never redirected.
 */
const IMAGE_TYPES: ResourceType[] = ['image', 'main_frame', 'sub_frame'];
/** Pages that open in the viewer: direct visits and embedded iframes. */
const PAGE_TYPES: ResourceType[] = ['main_frame', 'sub_frame'];

export interface RuleOptions {
  /** Full URL of the extension's viewer page, e.g. chrome-extension://<id>/viewer.html */
  viewerUrl: string;
  /** rimgo origin for embedded <video>s, or null to leave them alone. */
  videoInstance: string | null;
}

function redirect(id: number, regexFilter: string, regexSubstitution: string, types: ResourceType[]): Rule {
  return {
    id,
    priority: 1,
    action: { type: 'redirect' as Rule['action']['type'], redirect: { regexSubstitution } },
    condition: {
      regexFilter,
      isUrlFilterCaseSensitive: false,
      resourceTypes: types as Rule['condition']['resourceTypes'],
    },
  };
}

/**
 * regexSubstitution can't percent-encode, so the rules only capture ids and
 * extensions (all [A-Za-z0-9]) and write any encoded prefix out literally.
 * Query strings are dropped; Imgur doesn't need them.
 */
export function buildRules({ viewerUrl, videoInstance }: RuleOptions): Rule[] {
  const viewer = `${viewerUrl}#`;
  const rules: Rule[] = [
    // Images go to the DuckDuckGo proxy.
    redirect(1, `^https?://i\\.imgur\\.com/${ID}\\.${EXT}${TAIL}`, `${DDG}\\1.\\2`, IMAGE_TYPES),
    redirect(2, `^https?://i\\.imgur\\.com/${ID}/?(?:[?#].*)?$`, `${DDG}\\1.jpg`, IMAGE_TYPES),
    redirect(3, `${PAGE_HOST}/${ID}\\.${EXT}${TAIL}`, `${DDG}\\1.\\2`, IMAGE_TYPES),

    // Albums, galleries, posts and videos open in the viewer.
    redirect(10, `${PAGE_HOST}/a/${ID}(?:/embed)?/?(?:[?#].*)?$`, `${viewer}a/\\1`, PAGE_TYPES),
    redirect(11, `${PAGE_HOST}/gallery/(?:[^/?#]*-)?${ID}(?:/embed)?/?(?:[?#].*)?$`, `${viewer}gallery/\\1`, PAGE_TYPES),
    redirect(12, `${PAGE_HOST}/(?:t|r)/[^/?#]+/${ID}/?(?:[?#].*)?$`, `${viewer}post/\\1`, PAGE_TYPES),
    redirect(13, `${PAGE_HOST}/${ID}(?:/embed)?/?(?:[?#].*)?$`, `${viewer}post/\\1`, PAGE_TYPES),
    redirect(14, `^https?://i\\.imgur\\.com/${ID}\\.${VIDEO_EXT}${TAIL}`, `${viewer}media/\\1.\\2`, PAGE_TYPES),
    redirect(15, `${PAGE_HOST}/${ID}\\.${VIDEO_EXT}${TAIL}`, `${viewer}media/\\1.\\2`, PAGE_TYPES),
    // Site pages like imgur.com/upload look like post ids: leave them alone.
    {
      id: 16,
      priority: 2,
      action: { type: 'allow' as Rule['action']['type'] },
      condition: {
        regexFilter: `${PAGE_HOST}/(?:${RESERVED_PATHS.join('|')})(?:[/?#].*)?$`,
        isUrlFilterCaseSensitive: false,
        resourceTypes: PAGE_TYPES as Rule['condition']['resourceTypes'],
      },
    },
  ];

  if (videoInstance) {
    // Embedded <video> elements: rimgo serves every Imgur video as mp4.
    rules.push(redirect(4, `^https?://i\\.imgur\\.com/${ID}\\.${VIDEO_EXT}${TAIL}`, `${videoInstance}/\\1.mp4`, ['media']));
  }
  return rules;
}

/** Install or remove the redirect rules. Idempotent. */
export async function setRules(options: RuleOptions | null): Promise<void> {
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [...RULE_IDS],
    addRules: options ? buildRules(options) : [],
  });
}
