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
import { getLiveCategories, getLiveStreams } from './xtream/xtreamClient'
import { liveStreamsToChannels } from './xtream/toChannels'
import { buildPlaylistChannels } from './playlists/playlistBuildWorkerClient'
import { markPerf, measurePerf } from '../core/perf/devPerf'
import type { Channel } from './channel'
import type { M3uUrlSourceRecord, XtreamSourceRecord } from './session'

export async function recoverChannelsFromSource(
  source: XtreamSourceRecord | M3uUrlSourceRecord,
): Promise<Channel[]> {
  if (source.type === 'xtream') {
    const creds = { server: source.server, username: source.username, password: source.password }
    markPerf('playlist:download-start')
    const [categories, streams] = await Promise.all([getLiveCategories(creds), getLiveStreams(creds)])
    markPerf('playlist:download-end')
    measurePerf('playlist:download', 'playlist:download-start', 'playlist:download-end')
    // liveStreamsToChannels stays on the main thread: it is one linear map
    // over the panel's JSON (no regex, no folding) and it is where the
    // Xtream credentials are turned into stream URLs, so keeping it here
    // means the Worker request carries no separate credential object of its
    // own. The expensive half — mergeChannelSources — is what crosses.
    return buildChannels({ kind: 'raw-channels', raw: liveStreamsToChannels(streams, categories, creds) })
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
  markPerf('playlist:download-start')
  const text = await response.text()
  markPerf('playlist:download-end')
  measurePerf('playlist:download', 'playlist:download-start', 'playlist:download-end')
  // The raw playlist TEXT is what crosses into the Worker, not a parsed
  // RawChannel[] — one string is by far the cheapest thing to structured-
  // clone (measured: 2.3 ms for 5.35 MB, versus 23.6 ms for the equivalent
  // 30,925 parsed objects), and it moves parseM3u off the main thread too.
  return buildChannels({ kind: 'm3u-text', text })
}

// Parse + merge, off the main thread when the platform allows it. Bracketed
// with its own perf marks so a physical-TV run can separate download from
// build without any new instrumentation (see playlistBuildWorkerClient.ts
// for the Worker/synchronous decision itself).
async function buildChannels(input: Parameters<typeof buildPlaylistChannels>[0]): Promise<Channel[]> {
  markPerf('playlist:parse-start')
  const { channels, ranInWorker } = await buildPlaylistChannels(input)
  markPerf('playlist:parse-end')
  measurePerf(ranInWorker ? 'playlist:parse' : 'playlist:parse-main-thread', 'playlist:parse-start', 'playlist:parse-end')
  return channels
}
