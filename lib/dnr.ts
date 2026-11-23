import { browser, type Browser } from 'wxt/browser';

type Rule = Browser.declarativeNetRequest.Rule;
type ResourceType = `${Browser.declarativeNetRequest.ResourceType}`;

/** Dynamic rule ids owned by this module. Anything else is left alone. */
export const IMAGE_RULE_IDS = [1, 2, 3] as const;

const EXT = '(jpe?g|png|gif|webp|avif|bmp|tiff?)';
const ID = '([A-Za-z0-9]{5,10})';
const TAIL = '(?:[?#:].*)?$';
const DDG = 'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fi.imgur.com%2F';

/**
 * Only image loads and top-level/frame navigations. The extension's own probe
 * uses fetch (xmlhttprequest), so it is never redirected.
 */
const RESOURCE_TYPES: ResourceType[] = ['image', 'main_frame', 'sub_frame'];

/**
 * Redirect Imgur image URLs to the DuckDuckGo proxy. regexSubstitution can't
 * percent-encode, so the rules only capture the id and extension (both
 * [A-Za-z0-9]) and the encoded prefix is written out literally. The query
 * string is dropped; Imgur doesn't need it.
 */
export function buildImageRules(): Rule[] {
  const redirect = (id: number, regexFilter: string, regexSubstitution: string): Rule => ({
    id,
    priority: 1,
    action: { type: 'redirect' as Rule['action']['type'], redirect: { regexSubstitution } },
    condition: {
      regexFilter,
      isUrlFilterCaseSensitive: false,
      resourceTypes: RESOURCE_TYPES as Rule['condition']['resourceTypes'],
    },
  });

  return [
    // i.imgur.com/<id>.<ext>
    redirect(1, `^https?://i\\.imgur\\.com/${ID}\\.${EXT}${TAIL}`, `${DDG}\\1.\\2`),
    // i.imgur.com/<id> with no extension serves the image too.
    redirect(2, `^https?://i\\.imgur\\.com/${ID}/?(?:[?#].*)?$`, `${DDG}\\1.jpg`),
    // imgur.com/<id>.<ext> serves the same file as i.imgur.com.
    redirect(3, `^https?://(?:www\\.|m\\.)?imgur\\.com/${ID}\\.${EXT}${TAIL}`, `${DDG}\\1.\\2`),
  ];
}

/** Install or remove the image redirect rules. Idempotent. */
export async function setImageRules(active: boolean): Promise<void> {
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [...IMAGE_RULE_IDS],
    addRules: active ? buildImageRules() : [],
  });
}
