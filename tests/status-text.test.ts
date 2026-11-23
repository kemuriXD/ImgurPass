import { describe, expect, it } from 'vitest';
import { describeStatus, explainReason, formatWhen } from '../lib/status-text';
import type { Detection } from '../lib/state';

const det = (status: Detection['status'], checkedAt = 1): Detection => ({ status, reason: '', checkedAt });
const base = { enabled: true, alwaysProxy: false, missingHosts: [] as string[] };

describe('describeStatus', () => {
  it('puts missing site access first', () => {
    expect(describeStatus({ ...base, detection: det('blocked'), missingHosts: ['*://imgur.com/*'] }).tone).toBe('error');
  });
  it('shows off before anything about blocking', () => {
    expect(describeStatus({ ...base, enabled: false, detection: det('blocked') }).tone).toBe('off');
  });
  it.each([
    ['blocked', false, 'active'],
    ['unblocked', true, 'active'],
    ['unblocked', false, 'good'],
    ['unknown', false, 'warn'],
  ] as const)('%s with always proxy %s is %s', (status, alwaysProxy, tone) => {
    expect(describeStatus({ ...base, alwaysProxy, detection: det(status) }).tone).toBe(tone);
  });
  it('says a first check is running', () => {
    expect(describeStatus({ ...base, detection: det('unknown', 0) }).title).toMatch(/^Checking/);
  });
});

describe('explainReason', () => {
  it('rewrites known reasons and drops unknown ones', () => {
    expect(explainReason('Imgur served its region placeholder')).toMatch(/region/);
    expect(explainReason('probe image is 1x1, expected 1800x1200')).toMatch(/different image/);
    expect(explainReason('something new')).toBe('');
  });
});

describe('formatWhen', () => {
  const now = new Date(2026, 10, 23, 12, 0).getTime();
  it('says today, yesterday or the date', () => {
    expect(formatWhen(0, now)).toBe('not yet');
    expect(formatWhen(new Date(2026, 10, 23, 11, 56).getTime(), now, 'en-GB')).toBe('today at 11:56');
    expect(formatWhen(new Date(2026, 10, 22, 9, 12).getTime(), now, 'en-GB')).toBe('yesterday at 09:12');
    expect(formatWhen(new Date(2026, 10, 21, 9, 12).getTime(), now, 'en-GB')).toBe('on 21 Nov at 09:12');
  });
});
