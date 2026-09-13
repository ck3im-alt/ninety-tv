export type PlaybackSourceType = 'hls' | 'mpegts' | 'native'

// IPTV playlists routinely append expiring auth/query parameters to an
// otherwise ordinary stream URL. Classifying the raw string with
// `endsWith('.ts')` therefore sent `channel.ts?token=...` through the native
// <video> path, which Chromium/Tizen cannot demux, and left a black screen.
// Inspect the path independently of query/fragment data and recognize the
// extension-less /live/... shape emitted by some Xtream panels too.
export function classifyPlaybackSource(sourceUrl: string): PlaybackSourceType {
  const path = sourceUrl.split(/[?#]/, 1)[0].toLowerCase()
  if (path.endsWith('.m3u8')) return 'hls'
  if (path.endsWith('.ts')) return 'mpegts'

  try {
    const pathname = new URL(sourceUrl).pathname.toLowerCase()
    if (pathname.endsWith('.m3u8')) return 'hls'
    if (pathname.endsWith('.ts')) return 'mpegts'
    if (/\/live\/[^/]+\/[^/]+\/\d+\/?$/.test(pathname)) return 'mpegts'
  } catch {
    // A malformed/relative URL is left to the native element, which will
    // report the real load error through the normal player path.
  }

  return 'native'
}
