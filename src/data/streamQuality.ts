// Measures real per-candidate stream quality (resolution/fps/bitrate) by
// briefly loading a stream into a hidden, throwaway player — the same
// engines the real player uses (mpegts.js for Xtream's default raw-TS
// streams, hls.js for .m3u8, see core/player/htmlVideoPlayer.ts) — so
// duplicate channel matches for the same event (see sports/channelMatch.ts)
// can be ranked by what's actually being delivered, not just by name. A
// stream that times out or fails to probe is reported as unknown (null)
// rather than excluded — a probe failure here doesn't mean the stream
// itself is broken (dev CORS proxy quirks, transient panel hiccups, a
// channel that's just slow to start), so it's still shown, just unranked.
import { toDevHlsProxyUrl } from '../core/net/devCorsProxy'

export interface StreamQuality {
  width: number
  height: number
  fps: number | null
  bitrateKbps: number | null
}

const PROBE_TIMEOUT_MS = 6000

function isHlsSource(url: string): boolean {
  return url.includes('.m3u8')
}

function isMpegTsSource(url: string): boolean {
  return url.endsWith('.ts')
}

function createHiddenVideo(): HTMLVideoElement {
  const video = document.createElement('video')
  video.muted = true
  // Off-screen rather than display:none — some engines pause/deprioritize
  // decoding for display:none media, which would stall the very metadata
  // this is trying to read.
  video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;'
  document.body.appendChild(video)
  return video
}

async function probeMpegTs(url: string): Promise<StreamQuality | null> {
  const { default: mpegts } = await import('mpegts.js')
  if (!mpegts.isSupported()) return null

  return new Promise((resolve) => {
    const video = createHiddenVideo()
    const player = mpegts.createPlayer({
      type: 'mpegts',
      isLive: true,
      url: import.meta.env.DEV ? toDevHlsProxyUrl(url) : url,
    })
    let settled = false
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS)

    function finish(result: StreamQuality | null) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        player.destroy()
      } catch {
        // Already torn down (e.g. destroyed by its own fatal-error path).
      }
      video.remove()
      resolve(result)
    }

    // mpegts.js ships loose `any` types (see node_modules/mpegts.js/d.ts) —
    // typing this event payload further than the library itself does would
    // be fake precision.
    player.on(mpegts.Events.MEDIA_INFO, (info: { width?: number; height?: number; fps?: number; videoDataRate?: number }) => {
      if (!info.width || !info.height) return
      finish({ width: info.width, height: info.height, fps: info.fps ?? null, bitrateKbps: info.videoDataRate ?? null })
    })
    player.on(mpegts.Events.ERROR, () => finish(null))

    try {
      player.attachMediaElement(video)
      player.load()
      void video.play().catch(() => {
        // Autoplay can be blocked even when muted on some platforms —
        // MEDIA_INFO still arrives from demuxing without playback starting.
      })
    } catch {
      finish(null)
    }
  })
}

async function probeHls(url: string): Promise<StreamQuality | null> {
  const { default: Hls } = await import('hls.js')
  if (!Hls.isSupported()) return null

  return new Promise((resolve) => {
    const video = createHiddenVideo()
    const hls = new Hls()
    let settled = false
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS)

    function finish(result: StreamQuality | null) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      hls.destroy()
      video.remove()
      resolve(result)
    }

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      // Manifest-declared levels, not measured playback — a variant
      // playlist advertises resolution/bitrate per rendition without
      // needing to actually download and decode video.
      const best = hls.levels.reduce((a, b) => (b.height > a.height ? b : a), hls.levels[0])
      if (!best) {
        finish(null)
        return
      }
      finish({
        width: best.width,
        height: best.height,
        fps: best.frameRate || null,
        bitrateKbps: best.bitrate ? Math.round(best.bitrate / 1000) : null,
      })
    })
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) finish(null)
    })

    hls.loadSource(import.meta.env.DEV ? toDevHlsProxyUrl(url) : url)
    hls.attachMedia(video)
  })
}

// Cached per URL for the lifetime of the tab — a stream's encode profile
// doesn't change mid-session, and re-probing on every render/navigation
// would repeatedly open real connections to the user's IPTV panel for no
// new information.
const cache = new Map<string, Promise<StreamQuality | null>>()

export function probeStreamQuality(url: string): Promise<StreamQuality | null> {
  const cached = cache.get(url)
  if (cached) return cached
  const promise = (isMpegTsSource(url) ? probeMpegTs(url) : isHlsSource(url) ? probeHls(url) : Promise.resolve(null)).catch(
    () => null,
  )
  cache.set(url, promise)
  return promise
}
