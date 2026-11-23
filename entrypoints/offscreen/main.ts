// Chrome only: the background service worker has no DOM, so rimgo health
// checks load their probe image here, the same way a page would embed it.
import { browser } from 'wxt/browser';
import type { OffscreenProbeMessage } from '@/lib/messages';
import { loadImageSize } from '@/lib/probe';

browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as OffscreenProbeMessage;
  if (msg?.target !== 'offscreen' || msg.type !== 'probe-image') return;
  loadImageSize(msg.url, 8_000).then(sendResponse);
  return true;
});
