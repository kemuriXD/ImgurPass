import '@/assets/ui.css';
import './style.css';
import { browser } from 'wxt/browser';
import { ALL_SITES, type StatusReply } from '@/lib/messages';
import type { Tone } from '@/lib/status-text';
import { $, ask, h, onExternalChange, toneIcon } from '@/lib/ui';

let status: StatusReply | null = null;
let skipped = false;

function firstCheck(s: StatusReply | null): { tone: Tone; text: string } {
  if (!s || s.detection.checkedAt === 0) return { tone: 'warn', text: 'Checking whether Imgur is blocked here…' };
  switch (s.detection.status) {
    case 'blocked':
      return { tone: 'active', text: 'First check done: Imgur is blocked here, so unblocking is on.' };
    case 'unblocked':
      return {
        tone: 'good',
        text: "First check done: Imgur works here, so ImgurPass stays idle. If Imgur gets blocked, it turns on by itself.",
      };
    default:
      return { tone: 'warn', text: "The first check couldn't tell whether Imgur is blocked. It tries again in 15 minutes." };
  }
}

async function render() {
  status = await ask({ type: 'get-status' });

  const { tone, text } = firstCheck(status);
  $('first-check').dataset.tone = tone;
  $('check-callout').replaceChildren(toneIcon(tone), h('h2', { class: 'callout-title', text }));

  $('access-warning').hidden = !status || status.missingHosts.length === 0;

  const granted = !!status?.allSites;
  $('choice').hidden = granted || skipped;
  $('choice-result').hidden = !granted && !skipped;
  $('choice-result').textContent = granted
    ? 'Done. Imgur images on other sites get fixed too.'
    : 'OK. Direct Imgur links get fixed, and you can allow other sites from the toolbar button whenever you like.';
}

async function init() {
  // permissions.request has to run straight from the click for the prompt to show.
  $('grant-all').addEventListener('click', () => {
    void browser.permissions.request(ALL_SITES).then(render);
  });
  $('skip').addEventListener('click', () => {
    skipped = true;
    void render().then(() => $('choice-result').focus());
  });
  $('allow-required').addEventListener('click', () => {
    void browser.permissions.request({ origins: status?.missingHosts ?? [] }).then(render);
  });
  $('open-settings').addEventListener('click', () => void browser.runtime.openOptionsPage());

  onExternalChange(() => void render());
  await render();
}

void init();
