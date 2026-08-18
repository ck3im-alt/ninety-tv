import { fetchWithDevCorsFallback, HttpStatusError } from '../../core/net/devCorsProxy'
import type { XtreamAccountInfo, XtreamCredentials, XtreamEpgListing, XtreamLiveCategory, XtreamLiveStream } from './types'

// Real-world Xtream panels are wildly inconsistent about failure modes —
// some 500 on bad auth, some 200 with an `auth: 0` body, some hang forever,
// some return HTML error pages where JSON is expected. Every panel call
// funnels through fetchXtreamJson()/getJson() below so all of that gets
// normalized into one small set of typed, credential-free errors the UI can
// map to a message.
export type XtreamErrorCode = 'AUTH_FAILED' | 'NETWORK' | 'TIMEOUT' | 'MALFORMED_RESPONSE' | 'HTTP_ERROR' | 'EMPTY_PLAYLIST'

export class XtreamError extends Error {
  code: XtreamErrorCode
  constructor(code: XtreamErrorCode, message: string) {
    super(message)
    this.name = 'XtreamError'
    this.code = code
  }
}

// A panel call shouldn't be able to hang the setup/reconnect flow forever —
// pick something generous enough for slow panels but well short of "the
// user gives up and assumes the app is frozen".
const REQUEST_TIMEOUT_MS = 12_000

function baseUrl(creds: XtreamCredentials): string {
  return creds.server.replace(/\/+$/, '')
}

function apiUrl(creds: XtreamCredentials, action: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ username: creds.username, password: creds.password, action, ...extra })
  return `${baseUrl(creds)}/player_api.php?${params.toString()}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function malformed(detail: string): never {
  throw new XtreamError('MALFORMED_RESPONSE', `Provider returned an unsupported response (${detail})`)
}

// Panels disagree on how they signal "bad credentials" / "server-side
// error" — some send HTTP 401/403, others send HTTP 200 with an `auth: 0`
// flag buried in the body, or a `message`/`error` field instead of the
// payload we actually asked for. Catch those shapes before trying to
// validate the body as whatever type the caller expects.
function checkForAuthOrErrorPayload(data: unknown): void {
  if (!isRecord(data)) return
  const userInfo = isRecord(data.user_info) ? data.user_info : undefined
  if (data.auth === 0 || userInfo?.auth === 0) {
    throw new XtreamError('AUTH_FAILED', 'Incorrect username or password')
  }
  const message = typeof data.message === 'string' ? data.message : typeof data.error === 'string' ? data.error : undefined
  if (message) malformed(message)
}

async function fetchXtreamJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetchWithDevCorsFallback(url, controller.signal)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new XtreamError('TIMEOUT', 'Provider server did not respond')
    }
    if (err instanceof HttpStatusError) {
      if (err.status === 401 || err.status === 403) {
        throw new XtreamError('AUTH_FAILED', 'Incorrect username or password')
      }
      throw new XtreamError('HTTP_ERROR', 'Provider server returned an error')
    }
    throw new XtreamError('NETWORK', 'Could not reach the provider server')
  } finally {
    clearTimeout(timer)
  }
  try {
    return await response.json()
  } catch {
    throw new XtreamError('MALFORMED_RESPONSE', 'Provider returned an unsupported response')
  }
}

async function getJson<T>(url: string, validate: (data: unknown) => T): Promise<T> {
  const data = await fetchXtreamJson(url)
  checkForAuthOrErrorPayload(data)
  return validate(data)
}

function validateAccountInfo(data: unknown): XtreamAccountInfo {
  if (!isRecord(data) || !isRecord(data.user_info)) malformed('expected account info')
  return data as unknown as XtreamAccountInfo
}

function validateCategories(data: unknown): XtreamLiveCategory[] {
  if (!Array.isArray(data)) malformed('expected an array of categories')
  return data.filter(
    (c): c is XtreamLiveCategory => isRecord(c) && typeof c.category_id === 'string' && typeof c.category_name === 'string',
  )
}

function validateStreams(data: unknown, categoryId?: string): XtreamLiveStream[] {
  if (!Array.isArray(data)) malformed('expected an array of live streams')
  const streams = data
    .filter((s): s is Record<string, unknown> => isRecord(s) && typeof s.name === 'string' && (typeof s.stream_id === 'number' || typeof s.stream_id === 'string'))
    .map((s) => ({ ...s, stream_id: typeof s.stream_id === 'string' ? Number(s.stream_id) : s.stream_id }) as XtreamLiveStream)
  // Only treated as a hard failure for the unfiltered "whole playlist" call
  // — an empty category filter can legitimately have zero streams.
  if (streams.length === 0 && !categoryId) {
    throw new XtreamError('EMPTY_PLAYLIST', 'This provider account has no channels')
  }
  return streams
}

function validateShortEpg(data: unknown): { epg_listings?: XtreamEpgListing[] } {
  if (!isRecord(data)) malformed('expected an EPG response object')
  if (data.epg_listings !== undefined && !Array.isArray(data.epg_listings)) {
    malformed('expected epg_listings to be an array')
  }
  return data as { epg_listings?: XtreamEpgListing[] }
}

// Matches the classic Xtream Codes / Xtream UI "get.php" M3U export URL and
// pulls the server + credentials back out of it, so pasting that single URL
// (the form most panels hand out to users) is enough to use the richer JSON
// API instead of parsing the M3U text.
export function parseXtreamPlaylistUrl(url: string): XtreamCredentials | null {
  try {
    const parsed = new URL(url)
    if (!/get\.php$/.test(parsed.pathname)) return null
    const username = parsed.searchParams.get('username')
    const password = parsed.searchParams.get('password')
    if (!username || !password) return null
    return { server: `${parsed.protocol}//${parsed.host}`, username, password }
  } catch {
    return null
  }
}

export function verifyAccount(creds: XtreamCredentials): Promise<XtreamAccountInfo> {
  return getJson(apiUrl(creds, 'get_account_info'), validateAccountInfo)
}

export function getLiveCategories(creds: XtreamCredentials): Promise<XtreamLiveCategory[]> {
  return getJson(apiUrl(creds, 'get_live_categories'), validateCategories)
}

export function getLiveStreams(creds: XtreamCredentials, categoryId?: string): Promise<XtreamLiveStream[]> {
  const extra: Record<string, string> = categoryId ? { category_id: categoryId } : {}
  return getJson(apiUrl(creds, 'get_live_streams', extra), (data) => validateStreams(data, categoryId))
}

// Panels disagree on whether get_short_epg's title/description are
// base64-encoded — decode only if it actually looks like valid base64 that
// decodes to readable text, otherwise assume it's already plain text.
//
// atob() decodes to a "binary string" (one JS char per raw byte) — the
// underlying text is UTF-8, so Norwegian/etc. characters are multi-byte and
// reading atob()'s output directly as characters mangles them (e.g.
// "Tegnspråknytt" → "TegnsprÅ¥knytt"). Re-interpret those bytes as UTF-8
// via TextDecoder instead of treating them as already-decoded text.
function decodeMaybeBase64(value: string): string {
  if (!value || !/^[A-Za-z0-9+/]+=*$/.test(value) || value.length % 4 !== 0) return value
  try {
    const binary = atob(value)
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    // eslint-disable-next-line no-control-regex
    return /[\x00-\x08]/.test(decoded) ? value : decoded
  } catch {
    return value
  }
}

// Next few EPG entries for a live stream (current programme first, when the
// panel actually populates `now_playing`). Extracted from the stream's
// playback URL — see extractStreamId in parseCategory.ts's sibling module —
// since our merged Channel model doesn't carry the raw Xtream stream_id.
export async function getShortEpg(creds: XtreamCredentials, streamId: number, limit = 4): Promise<XtreamEpgListing[]> {
  const data = await getJson(
    apiUrl(creds, 'get_short_epg', { stream_id: String(streamId), limit: String(limit) }),
    validateShortEpg,
  )
  const listings = data.epg_listings ?? []
  return listings.map((entry) => ({
    ...entry,
    title: decodeMaybeBase64(entry.title),
    description: decodeMaybeBase64(entry.description),
  }))
}

// Live stream playback URL. `.ts` (raw MPEG-TS) is the default virtually
// every Xtream panel serves unconditionally; `.m3u8` (HLS) only exists on
// panels that explicitly transcode to it, which many don't — defaulting to
// `.ts` is what actually plays across the widest range of panels.
export function buildLiveStreamUrl(creds: XtreamCredentials, streamId: number, ext: 'm3u8' | 'ts' = 'ts'): string {
  return `${baseUrl(creds)}/live/${creds.username}/${creds.password}/${streamId}.${ext}`
}
