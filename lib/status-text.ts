import type { Detection } from './state';

export type Tone = 'active' | 'good' | 'warn' | 'error' | 'off';

export interface StatusText {
  tone: Tone;
  title: string;
  body: string;
}

interface StatusInput {
  detection: Detection;
  enabled: boolean;
  alwaysProxy: boolean;
  missingHosts: readonly string[];
}

const REASONS: Record<string, string> = {
  'Imgur served its region placeholder': 'Imgur served its "not available in your region" image instead of the test image.',
  'Imgur API reports a region block': "Imgur's API says it isn't available in your region.",
  'Imgur is unreachable but the proxy works': "Imgur can't be reached, but the proxy can.",
  'Imgur returned something that is not an image': 'Imgur sent back something other than the test image.',
};

/** A plain-language version of a detection reason, for the settings page. */
export function explainReason(reason: string): string {
  if (REASONS[reason]) return REASONS[reason];
  if (reason.startsWith('probe image is')) return 'Imgur sent a different image instead of the test image.';
  if (reason.startsWith('probe failed')) return "The test image didn't load, so the check couldn't decide.";
  return '';
}

/** Headline and explanation for the current state, shared by the popup and settings. */
export function describeStatus({ detection, enabled, alwaysProxy, missingHosts }: StatusInput): StatusText {
  if (missingHosts.length > 0) {
    return {
      tone: 'error',
      title: "ImgurPass can't reach Imgur or the proxies",
      body: 'Your browser has switched off site access ImgurPass needs. Nothing gets unblocked until it is allowed again.',
    };
  }
  if (!enabled) {
    return { tone: 'off', title: 'ImgurPass is off', body: 'Nothing is changed on any site. Turn it back on with the switch.' };
  }
  if (detection.status === 'blocked') {
    return {
      tone: 'active',
      title: 'Unblocking Imgur',
      body: 'Imgur is blocked on this connection, so images load through a proxy.',
    };
  }
  if (alwaysProxy) {
    return {
      tone: 'active',
      title: 'Unblocking Imgur',
      body: "Proxy anyway is on, so Imgur loads through a proxy even though it doesn't look blocked.",
    };
  }
  if (detection.status === 'unblocked') {
    return {
      tone: 'good',
      title: 'Imgur works here',
      body: 'Nothing is blocked, so ImgurPass is idle. No images go through a proxy.',
    };
  }
  if (detection.checkedAt === 0) {
    return { tone: 'warn', title: 'Checking whether Imgur is blocked', body: 'This takes a few seconds.' };
  }
  return {
    tone: 'warn',
    title: "Couldn't tell whether Imgur is blocked",
    body: "The check didn't get a clear answer. It tries again in 15 minutes, or check now.",
  };
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "today at 11:56", "yesterday at 09:12", "on 21 Nov at 11:56", or "not yet". */
export function formatWhen(at: number, now = Date.now(), locale?: string): string {
  if (!at) return 'not yet';
  const d = new Date(at);
  const today = new Date(now);
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (sameDay(d, today)) return `today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, yesterday)) return `yesterday at ${time}`;
  return `on ${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} at ${time}`;
}
