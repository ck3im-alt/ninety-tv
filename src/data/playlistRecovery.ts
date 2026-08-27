// Rebuilds a channel list from a persisted playlist *source* alone — used
// when the (large, quota-risky) channel cache is missing or stale but the
// (small, essentially-never-fails) source record survived. See session.ts
// for why those two are split, and data/playlists/usePlaylistLibrary.ts for
// where this gets called (on startup, for each playlist
// hydratePlaylistLibrary() reports in `needsRecovery`).
//
// Talks directly to the user's own Xtream panel or M3U host — same as
// PlaylistSetupScreen's initial connect flow — never to ninety-api. No
// credentials or channel data leave the device.
//
// File-upload sources are intentionally NOT handled here: this module only
// takes XtreamSourceRecord | M3uUrlSourceRecord, so a caller passing a
// FileSourceRecord is a type error, not a silent no-op. There is nothing
// to refetch — the original file's contents were never kept around after
// the initial parse — so that case must surface as a reconnect-required
// prompt instead (see hydratePlaylistLibrary()'s `unrecoverableFiles`).

import { fetchWithDevCorsFallback } from '../core/net/devCorsProxy'
import { DEFAULT_REQUEST_TIMEOUT_MS, RequestTimeoutError } from '../core/net/fetchWithTimeout'
import { parseM3u } from './m3u/parseM3u'
import { getLiveCategories, getLiveStreams } from './xtream/xtreamClient'
import { liveStreamsToChannels } from './xtream/toChannels'
import { mergeChannelSources } from '../features/channels/mergeChannels'
import type { Channel } from './channel'
import type { M3uUrlSourceRecord, XtreamSourceRecord } from './session'

export async function recoverChannelsFromSource(
  source: XtreamSourceRecord | M3uUrlSourceRecord,
): Promise<Channel[]> {
  if (source.type === 'xtream') {
    const creds = { server: source.server, username: source.username, password: source.password }
    const [categories, streams] = await Promise.all([getLiveCategories(creds), getLiveStreams(creds)])
    return mergeChannelSources(liveStreamsToChannels(streams, categories, creds))
  }
  // Bounded like every other metadata fetch. This runs on STARTUP, for each
  // playlist whose channel cache needs rebuilding, and a plain M3U host that
  // accepts the connection then stalls would otherwise hold the app on its
  // loading state indefinitely with no way for the viewer to intervene. The
  // Xtream branch above needs nothing here — xtreamClient already applies
  // its own 12s AbortController bound to every panel call.
  //
  // Deliberately a THROW rather than an empty channel list: the caller
  // (usePlaylistLibrary's hydrate path) treats a failed recovery as "this
  // playlist still needs recovering" and leaves whatever is already cached
  // alone. Returning [] would present as a successful recovery of a
  // playlist with no channels — which is exactly how good data gets
  // overwritten by a transient network failure.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetchWithDevCorsFallback(source.url, controller.signal)
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new RequestTimeoutError(DEFAULT_REQUEST_TIMEOUT_MS)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
  return mergeChannelSources(parseM3u(await response.text()))
}
