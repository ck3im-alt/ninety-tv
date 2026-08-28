// The one place that turns "what the user typed/picked" into a
// PlaylistSourceRecord plus a merged Channel[].
//
// Extracted from PlaylistSetupScreen so Settings' Add/Edit-playlist flows
// reuse the exact same connection architecture rather than growing a second
// parser, a second Xtream URL shape, or a second idea of what counts as a
// valid playlist. The actual fetching/parsing still lives where it always
// did (playlistRecovery.ts -> xtreamClient/parseM3u/mergeChannelSources);
// this module only owns the small amount of glue that used to be private to
// the setup screen.
import { parseXtreamPlaylistUrl } from '../xtream/xtreamClient'
import { recoverChannelsFromSource } from '../playlistRecovery'
import { buildPlaylistChannels } from './playlistBuildWorkerClient'
import { allowsM3uFallback, combineConnectFailures, toConnectionError } from './connectionError'
import type { ConnectionError } from './connectionError'
import type { Channel } from '../channel'
import type { M3uUrlSourceRecord, PlaylistSourceRecord, XtreamSourceRecord } from '../session'

// Xtream Codes / Xtream UI panels (the most common IPTV panel software)
// hand out a "get.php" M3U export URL, but also expose a much richer JSON
// API (player_api.php: categories, live streams, VOD, series, EPG) at the
// same server/credentials. Prefer that when we recognize the URL shape;
// otherwise treat it as a plain M3U URL.
//
// This is the PREFERENCE, not the decision — see connectPlaylistFromUrl,
// which is what callers should use. Recognizing a get.php URL and then only
// ever talking to player_api.php means a provider whose panel does not
// serve that endpoint fails here while the very same URL works in every
// other IPTV player, because those just download the M3U.
export function sourceFromUrl(url: string): XtreamSourceRecord | M3uUrlSourceRecord {
  const xtreamCreds = parseXtreamPlaylistUrl(url)
  if (xtreamCreds) return { type: 'xtream', ...xtreamCreds }
  return { type: 'm3u-url', url }
}

// The result of a successful connect: the channels, plus the source record
// that ACTUALLY worked. The second half matters — when a get.php URL only
// loads as a plain M3U, persisting it as an m3u-url source is what keeps
// every later resync on the path already known to work instead of
// re-running the whole fallback on every launch.
export interface PlaylistConnection {
  source: XtreamSourceRecord | M3uUrlSourceRecord
  channels: Channel[]
}

// Connect from a URL the user typed, pasted, or sent from their phone.
//
// For a get.php URL that really is an Xtream panel this behaves exactly as
// before: one player_api.php conversation, an xtream source, no extra
// request. The fallback only runs when that conversation failed in a way
// that says nothing about whether the M3U export would have worked — see
// allowsM3uFallback for which categories those are, and why the rest are
// excluded.
// Every rejection is a ConnectionError, including on the single-attempt
// paths. One connect surface reporting a dead host as NetworkUnreachableError
// for a plain .m3u link and as ConnectionError('UNREACHABLE') for a get.php
// one would make correct handling in the UI impossible to write. (The
// separate RESYNC path, loadChannelsForSource, keeps throwing exactly what it
// always did — usePlaylistLibrary reads EmptyPlaylistError by instanceof.)
export async function connectPlaylistFromUrl(url: string): Promise<PlaylistConnection> {
  const trimmed = url.trim()
  const source = sourceFromUrl(trimmed)
  if (source.type !== 'xtream') {
    try {
      return { source, channels: await loadChannelsForSource(source) }
    } catch (err) {
      throw toConnectionError(err)
    }
  }

  let apiFailure: ConnectionError
  try {
    return { source, channels: await loadChannelsForSource(source) }
  } catch (err) {
    apiFailure = toConnectionError(err)
    if (!allowsM3uFallback(apiFailure)) throw apiFailure
  }

  // The user's URL verbatim, never rebuilt from the parsed credentials.
  // parseXtreamPlaylistUrl keeps only server/username/password, so
  // reconstructing would silently drop everything else the provider put
  // there — `type=m3u_plus`, `output=ts`, a path prefix, extra query
  // parameters some panels require — and hand the host a URL the user never
  // tested. This is the exact string that works in their other player.
  const m3uSource: M3uUrlSourceRecord = { type: 'm3u-url', url: trimmed }
  try {
    return { source: m3uSource, channels: await loadChannelsForSource(m3uSource) }
  } catch (err) {
    throw combineConnectFailures(apiFailure, toConnectionError(err))
  }
}

// Same shape parseXtreamPlaylistUrl recognizes — building it from the
// provider-login fields lets every connect path stay one code path
// regardless of which form the user filled in.
export function buildXtreamUrl(server: string, username: string, password: string): string {
  const base = server.trim().replace(/\/+$/, '')
  return `${base}/get.php?username=${encodeURIComponent(username.trim())}&password=${encodeURIComponent(password.trim())}&type=m3u_plus&output=ts`
}

export class EmptyPlaylistError extends Error {
  constructor() {
    super('No channels found in playlist')
    this.name = 'EmptyPlaylistError'
  }
}

// Fetches and merges a playlist from a refetchable source. Throws on
// network/parse failure and on an empty result — callers treat "connected
// but zero channels" as a failed connection, since silently accepting it
// would replace a working playlist with nothing.
export async function loadChannelsForSource(source: XtreamSourceRecord | M3uUrlSourceRecord): Promise<Channel[]> {
  const channels = await recoverChannelsFromSource(source)
  if (channels.length === 0) throw new EmptyPlaylistError()
  return channels
}

// File playlists are read once, here, and never again — the bytes are not
// retained (see session.ts's FileSourceRecord), which is exactly why a file
// playlist offers "Replace file" instead of "Resync" in Settings.
export async function loadChannelsFromFile(file: File): Promise<{ channels: Channel[]; source: PlaylistSourceRecord }> {
  // Same off-main-thread parse+merge every other connect path uses (see
  // playlistBuildWorkerClient.ts) — a file playlist is exactly as large as
  // a downloaded one, and this runs while the import loading screen is up,
  // which can only animate if the main thread is free.
  const { channels } = await buildPlaylistChannels({ kind: 'm3u-text', text: await file.text() })
  if (channels.length === 0) throw new EmptyPlaylistError()
  return { channels, source: { type: 'file', fileName: file.name } }
}
