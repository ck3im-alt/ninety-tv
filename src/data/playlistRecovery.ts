// Rebuilds a channel list from a persisted playlist *source* alone — used
// when the (large, quota-risky) channel cache is missing or stale but the
// (small, essentially-never-fails) source record survived. See session.ts
// for why those two are split, and App.tsx for where this gets called (on
// startup, when loadPlaylistState() reports 'source-available-cache-missing'
// or 'source-available-cache-invalid').
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
// prompt instead (see loadPlaylistState()'s 'unrecoverable-file-source').

import { fetchWithDevCorsFallback } from '../core/net/devCorsProxy'
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
  const response = await fetchWithDevCorsFallback(source.url)
  return mergeChannelSources(parseM3u(await response.text()))
}
