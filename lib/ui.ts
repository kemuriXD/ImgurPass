// Small DOM helpers shared by the popup, settings and welcome pages.
import { browser } from 'wxt/browser';
import type { BackgroundMessage, StatusReply } from './messages';
import { getSettings, settingsItem, type Settings } from './state';
import type { StatusText, Tone } from './status-text';

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type Child = Node | string | null | undefined | false;

/** Create an element with text content and children. Never parses HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_PATHS: Record<Tone, string[]> = {
  active: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M8 12.5l2.5 2.5L16 9.5'],
  good: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'],
  warn: ['M12 3l10 18H2z', 'M12 10v5M12 18v.5'],
  error: ['M12 3l10 18H2z', 'M12 10v5M12 18v.5'],
  off: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M8 12h8'],
};

/** A 20px stroke icon for a status tone, in the current text colour. */
export function toneIcon(tone: Tone): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'callout-icon');
  for (const d of ICON_PATHS[tone]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

/** Fill a .callout element with an icon, a title and a body. */
export function renderCallout(container: HTMLElement, { tone, title, body }: StatusText) {
  container.dataset.tone = tone;
  container.replaceChildren(
    toneIcon(tone),
    h('div', { class: 'callout-text' }, h('div', { class: 'callout-title', text: title }), body && h('div', { class: 'callout-body', text: body })),
  );
}

export const ask = <T = StatusReply>(msg: BackgroundMessage) =>
  (browser.runtime.sendMessage(msg) as Promise<T | null>).catch(() => null);

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await settingsItem.setValue(next);
  return next;
}

/** "*://*.imgur.com/*" -> "imgur.com", for showing host permissions to people. */
export function hostLabel(pattern: string): string {
  return pattern.replace(/^[^:]+:\/\//, '').replace(/^\*\./, '').replace(/\/.*$/, '');
}

/** Run fn whenever site access or the stored state might have changed. */
export function onExternalChange(fn: () => void) {
  // Health checks write to storage many times in a row: render once.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(fn, 150);
  };
  browser.permissions.onAdded.addListener(later);
  browser.permissions.onRemoved.addListener(later);
  browser.storage.onChanged.addListener(later);
  window.addEventListener('focus', later);
}
