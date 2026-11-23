export interface PageReply {
  status: number;
  text: string;
}

/** Fetch a mirror's HTML page. Null on a network error, timeout, or anything that isn't HTML. */
export async function fetchHtml(url: string, timeoutMs: number): Promise<PageReply | null> {
  try {
    const res = await fetch(url, {
      // Send the mirror's own cookies: once the browser has passed a mirror's
      // bot check, that cookie is what lets this request through too.
      credentials: 'include',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!(res.headers.get('content-type') ?? '').includes('text/html')) return null;
    return { status: res.status, text: await res.text() };
  } catch {
    return null;
  }
}
