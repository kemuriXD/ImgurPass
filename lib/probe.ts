import type { ProbeResult, Size } from './detect';

const TIMEOUT_MS = 15_000;

/**
 * Fetch an image and decode it to read its real size. Needs host access to the
 * URL (CORS is skipped for extension contexts with host permission).
 */
export async function fetchImageSize(url: string): Promise<ProbeResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: 'network-error' };
  }
  if (!res.ok) return { kind: 'http-error', status: res.status };
  try {
    const bitmap = await createImageBitmap(await res.blob());
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return { kind: 'size', size };
  } catch {
    return { kind: 'not-image' };
  }
}

/**
 * Load a URL into an <img> and read its natural size. Works without host
 * access, like a cross-site embed. Needs a DOM (Firefox event page, Chrome
 * offscreen document, or a normal page).
 */
export function loadImageSize(url: string, timeoutMs = TIMEOUT_MS): Promise<Size | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    const done = (size: Size | null) => {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      img.src = '';
      resolve(size);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => done(null);
    img.src = url;
  });
}
