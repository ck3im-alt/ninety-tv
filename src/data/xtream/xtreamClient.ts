import { fetchWithDevCorsFallback } from '../../core/net/devCorsProxy'
import type { XtreamAccountInfo, XtreamCredentials, XtreamEpgListing, XtreamLiveCategory, XtreamLiveStream } from './types'

function baseUrl(creds: XtreamCredentials): string {
  return creds.server.replace(/\/+$/, '')
}

function apiUrl(creds: XtreamCredentials, action: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ username: creds.username, password: creds.password, action, ...extra })
  return `${baseUrl(creds)}/player_api.php?${params.toString()}`
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetchWithDevCorsFallback(url)
  return response.json() as Promise<T>
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
  return getJson<XtreamAccountInfo>(apiUrl(creds, 'get_account_info'))
}

export function getLiveCategories(creds: XtreamCredentials): Promise<XtreamLiveCategory[]> {
  return getJson<XtreamLiveCategory[]>(apiUrl(creds, 'get_live_categories'))
}

export function getLiveStreams(creds: XtreamCredentials, categoryId?: string): Promise<XtreamLiveStream[]> {
  const extra: Record<string, string> = categoryId ? { category_id: categoryId } : {}
  return getJson<XtreamLiveStream[]>(apiUrl(creds, 'get_live_streams', extra))
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
  const data = await getJson<{ epg_listings?: XtreamEpgListing[] }>(
    apiUrl(creds, 'get_short_epg', { stream_id: String(streamId), limit: String(limit) }),
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
