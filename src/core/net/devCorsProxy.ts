// Dev-only CORS workaround. Most IPTV/Xtream panels don't send CORS headers,
// so a direct browser fetch fails when we're testing inside a normal browser
// tab via `vite dev`. That's a testing artifact, not a production concern:
// the built Tizen widget grants itself cross-origin network access via the
// WARP <access> policy declared in config.xml (see Fase A notes in
// TIZEN-PLAN.md) — packaged widget content isn't subject to the same-origin
// policy a browser tab enforces, so none of this fallback exists or runs
// there. Kept isolated here so it's obvious it's dev-only and easy to delete
// once we're testing against real Tizen builds instead of the browser.
// HLS playback needs its own proxy path: hls.js fetches the manifest AND
// every segment it references via JS, so a plain single-request passthrough
// isn't enough — the dev server rewrites segment URIs inside the manifest to
// also route back through it (see vite.config.ts, /dev-proxy/hls).
export function toDevHlsProxyUrl(url: string): string {
  return `/dev-proxy/hls?url=${encodeURIComponent(url)}`
}

// Carries the HTTP status through the CORS-fallback dance so callers that
// care about the exact code (e.g. xtreamClient distinguishing 401 from 500)
// don't have to parse it back out of an error string.
export class HttpStatusError extends Error {
  status: number
  constructor(status: number) {
    super(`Server returned ${status}`)
    this.name = 'HttpStatusError'
    this.status = status
  }
}

export async function fetchWithDevCorsFallback(url: string, signal?: AbortSignal): Promise<Response> {
  try {
    const response = await fetch(url, { signal })
    if (!response.ok) throw new HttpStatusError(response.status)
    return response
  } catch (err) {
    if (!import.meta.env.DEV) throw err
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    const proxied = await fetch(`/dev-proxy/m3u?url=${encodeURIComponent(url)}`, { signal })
    if (!proxied.ok) throw new HttpStatusError(proxied.status)
    return proxied
  }
}
