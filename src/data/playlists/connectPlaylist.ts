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
import type { Channel } from '../channel'
import type { M3uUrlSourceRecord, PlaylistSourceRecord, XtreamSourceRecord } from '../session'

// Xtream Codes / Xtream UI panels (the most common IPTV panel software)
// hand out a "get.php" M3U export URL, but also expose a much richer JSON
// API (player_api.php: categories, live streams, VOD, series, EPG) at the
// same server/credentials. Prefer that when we recognize the URL shape;
// otherwise treat it as a plain M3U URL.
export function sourceFromUrl(url: string): XtreamSourceRecord | M3uUrlSourceRecord {
  const xtreamCreds = parseXtreamPlaylistUrl(url)
  if (xtreamCreds) return { type: 'xtream', ...xtreamCreds }
  return { type: 'm3u-url', url }
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
