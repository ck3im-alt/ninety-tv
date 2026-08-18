// Our merged Channel model (see mergeChannels.ts) only keeps each source's
// playback URL, not the raw Xtream stream_id — but buildLiveStreamUrl()
// always shapes that URL as `.../live/{user}/{pass}/{streamId}.{ext}`, so
// it's recoverable from the URL alone. Returns null for non-Xtream sources
// (plain M3U URLs won't match this shape), which is the signal EPG isn't
// available for that source.
export function extractStreamId(url: string): number | null {
  const match = url.match(/\/live\/[^/]+\/[^/]+\/(\d+)\.\w+$/)
  return match ? Number(match[1]) : null
}
