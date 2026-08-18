import { useEffect, useState } from 'react'
import { getShortEpg } from '../../data/xtream/xtreamClient'
import { extractStreamId } from '../../data/xtream/extractStreamId'
import type { Channel } from '../../data/channel'
import type { XtreamCredentials } from '../../data/xtream/types'

export interface FavoriteChannelNowPlaying {
  channel: Channel
  // null covers every reason there's nothing to show: plain M3U playlist
  // (no EPG API to ask), the panel not providing EPG for this channel, or
  // the request failing — all rendered the same honest way (channel with
  // no programme subtitle), never a guess.
  title: string | null
}

// Powers Home's "Live on your favorite channels" section — the answer to
// dropping per-sport broadcast-matching for anything beyond football/F1
// (see types.ts's note on SportKey): rather than us guessing which channel
// airs a sport we don't track, the user favorites the channel themselves
// and sees what's actually playing on it right now.
export function useFavoriteChannelsNowPlaying(
  favoriteChannels: Channel[],
  xtreamCreds: XtreamCredentials | null,
): FavoriteChannelNowPlaying[] {
  const [result, setResult] = useState<FavoriteChannelNowPlaying[]>([])
  // Stable key so the effect only refires when the actual favorite set
  // changes, not on every render of a fresh array reference.
  const channelsKey = favoriteChannels.map((c) => c.id).join(',')

  useEffect(() => {
    if (favoriteChannels.length === 0) {
      setResult([])
      return
    }
    if (!xtreamCreds) {
      setResult(favoriteChannels.map((channel) => ({ channel, title: null })))
      return
    }
    let cancelled = false
    Promise.all(
      favoriteChannels.map(async (channel): Promise<FavoriteChannelNowPlaying> => {
        const source = channel.sources[0]
        const streamId = source ? extractStreamId(source.url) : null
        if (streamId === null) return { channel, title: null }
        try {
          // Limit 2, not 1 — get_short_epg's now_playing flag isn't always
          // populated on the very first entry across every panel (same
          // caveat documented in getShortEpg's own comments), so a couple
          // of candidates gives the now_playing check something to find.
          const listings = await getShortEpg(xtreamCreds, streamId, 2)
          const current = listings.find((l) => l.now_playing === 1) ?? listings[0]
          return { channel, title: current?.title ?? null }
        } catch {
          return { channel, title: null }
        }
      }),
    ).then((results) => {
      if (!cancelled) setResult(results)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelsKey, xtreamCreds])

  return result
}
