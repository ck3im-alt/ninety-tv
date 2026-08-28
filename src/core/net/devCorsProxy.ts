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

// How the dev proxy tells us a failure was ITS OWN — that it never managed
// to reach the upstream host at all. Without this the proxy's 502 is
// indistinguishable from a 502 the provider genuinely sent, which is how a
// domain that does not resolve was being reported to the user as a provider
// server error. See vite.config.ts's /dev-proxy/m3u handler.
export const DEV_PROXY_UPSTREAM_ERROR_HEADER = 'x-dev-proxy-upstream-error'

// A failing response body is not trusted to be small, and no caller needs
// more than the opening of it to classify the failure.
const ERROR_BODY_SAMPLE_LIMIT = 2048

// Carries the HTTP status through the CORS-fallback dance so callers that
// care about the exact code (e.g. xtreamClient distinguishing 401 from 500)
// don't have to parse it back out of an error string.
export class HttpStatusError extends Error {
  readonly status: number
  // A bounded sample of the failing response's body. Panels put their real
  // reason here — `auth: 0`, "Invalid credentials" — and throwing it away
  // was what forced everything that isn't 401/403 to be guessed at from the
  // status alone (see core/net/authEvidence.ts).
  readonly body: string
  constructor(status: number, body = '') {
    super(`Server returned ${status}`)
    this.name = 'HttpStatusError'
    this.status = status
    this.body = body
  }
}

// Nothing answered: DNS failure, host down, connection refused, or (in a
// browser tab) CORS. Distinct from HttpStatusError on purpose — "the
// provider said no" and "there was nobody to ask" need different messages
// and different retry behaviour, and collapsing them is precisely the bug
// this class exists to prevent.
export class NetworkUnreachableError extends Error {
  // What the underlying attempt(s) actually failed with. For diagnostics
  // only — callers map this class to a plain user-facing message and never
  // render `detail`.
  readonly detail: string
  // Whether the dev proxy was tried as well and also failed. Lets a
  // developer tell "the provider is unreachable" from "the dev proxy is
  // broken" without reading the network tab.
  readonly triedDevProxy: boolean
  constructor(detail: string, triedDevProxy: boolean) {
    super('Could not reach the server')
    this.name = 'NetworkUnreachableError'
    this.detail = detail
    this.triedDevProxy = triedDevProxy
  }
}

export async function fetchWithDevCorsFallback(url: string, signal?: AbortSignal): Promise<Response> {
  let directFailure: unknown
  try {
    const response = await fetch(url, { signal })
    // A response of ANY status means we reached the server and CORS let us
    // read the result — so this IS the provider's answer, and re-issuing it
    // through the dev proxy could only replace a real status with the
    // proxy's own. The proxy is for requests that never produced a response
    // at all.
    if (!response.ok) throw new HttpStatusError(response.status, await readErrorBody(response))
    return response
  } catch (err) {
    if (err instanceof HttpStatusError) throw err
    if (isAbortError(err)) throw err
    directFailure = err
  }

  if (!import.meta.env.DEV) throw new NetworkUnreachableError(describe(directFailure), false)

  let proxied: Response
  try {
    proxied = await fetch(`/dev-proxy/m3u?url=${encodeURIComponent(url)}`, { signal })
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new NetworkUnreachableError(`direct: ${describe(directFailure)}; dev proxy: ${describe(err)}`, true)
  }

  // The proxy reaches the host from Node, with no CORS and no browser DNS
  // cache in the way, so it is the more trustworthy of the two attempts —
  // but only when it actually got somewhere. When it flags its own upstream
  // failure, the original direct failure is the real story and its
  // classification is what survives.
  const upstreamError = proxied.headers?.get?.(DEV_PROXY_UPSTREAM_ERROR_HEADER)
  if (upstreamError) {
    throw new NetworkUnreachableError(`direct: ${describe(directFailure)}; dev proxy upstream: ${upstreamError}`, true)
  }
  if (!proxied.ok) throw new HttpStatusError(proxied.status, await readErrorBody(proxied))
  return proxied
}

// Tolerant of both real Responses and the minimal fakes tests construct —
// a body we cannot read is simply no evidence, never a failure of its own.
async function readErrorBody(response: Response): Promise<string> {
  try {
    if (typeof response.text !== 'function') return ''
    return (await response.text()).slice(0, ERROR_BODY_SAMPLE_LIMIT)
  } catch {
    return ''
  }
}

// Both DOMException and plain Error carry the name; which one a runtime
// produces for an aborted fetch varies (Tizen's WebKit, jsdom and Node all
// differ), and a caller's deliberate cancellation must never be rewritten
// into a network verdict.
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}
