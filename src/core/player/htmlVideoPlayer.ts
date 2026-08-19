import type Hls from 'hls.js'
import { toDevHlsProxyUrl } from '../net/devCorsProxy'
import type { Player, PlayerError, PlayerState, SubtitleTrack } from './types'

const INITIAL_STATE: PlayerState = {
  status: 'idle',
  currentTime: 0,
  duration: 0,
  error: null,
  subtitleTracks: [],
  activeSubtitleTrack: null,
  // The <video> element is rendered with the `muted` attribute so autoplay
  // is allowed before any user gesture (browser/Tizen autoplay policy) —
  // this default mirrors that until attach() reads the element's real value.
  muted: true,
}

function isHlsSource(url: string): boolean {
  return url.includes('.m3u8')
}

// Xtream Codes panels serve live channels as raw MPEG-TS by default
// (.../live/user/pass/id.ts) — .m3u8 (HLS) is only available on panels that
// explicitly transcode to it, which many don't. Chrome/Tizen's native
// <video> can't demux a raw TS container, so this needs its own MSE-based
// player (mpegts.js) rather than falling through to hls.js or plain src.
function isMpegTsSource(url: string): boolean {
  return url.endsWith('.ts')
}

// Fire-and-forget warm-up for whichever engine chunk a sample URL implies —
// called once, speculatively, well before any real load() (see
// BrowseCascadeScreen's mount effect) so the first channel someone actually
// previews doesn't also pay for fetching/parsing/evaluating mpegts.js or
// hls.js on top of the real stream startup latency. Never opens a stream or
// touches a <video> element — only primes the browser's module cache so
// load()'s own `await import(...)` below resolves instantly instead.
export function preloadPlayerEngine(sampleSourceUrl: string): void {
  if (isMpegTsSource(sampleSourceUrl)) {
    void import('mpegts.js').catch(() => {})
  } else {
    void import('hls.js').catch(() => {})
  }
}

// HTML5 <video> + MSE implementation:
//  - .m3u8 sources go through hls.js (or native HLS where supported)
//  - .ts sources (the Xtream live default) go through mpegts.js
// Used as the default/fallback player; Tizen AVPlay can be added later as an
// alternate `Player` implementation behind the same interface for better
// codec/DRM support on-device.
export function createHtmlVideoPlayer(): Player {
  let video: HTMLVideoElement | null = null
  let hls: Hls | null = null
  // mpegts.js ships loose `any` types (see node_modules/mpegts.js/d.ts) —
  // typing this any further than the library itself does would be fake precision.
  let mpegtsPlayer: { destroy: () => void } | null = null
  let state: PlayerState = { ...INITIAL_STATE }
  const listeners = new Set<(state: PlayerState) => void>()
  // Bumped on every load() call. loadHls/loadMpegTs each `await import(...)`
  // before touching `hls`/`mpegtsPlayer`/`video` — on a fast-scrolling
  // Preview pane, a LATER load() (a newer focused channel) can start and
  // even finish before an EARLIER one's dynamic import resolves. Without
  // this, that stale resolution would still go on to create a player and
  // attach it, silently overwriting the current/correct one with an old
  // channel's stream. Each load captures the generation current at its own
  // call and checks it's still current after the only await point, so a
  // superseded load is a no-op instead of a race.
  let loadGeneration = 0

  function setState(patch: Partial<PlayerState>): void {
    state = { ...state, ...patch }
    for (const listener of listeners) listener(state)
  }

  function setError(error: PlayerError): void {
    setState({ status: 'error', error })
  }

  // hls.js exposes each declared HLS subtitle rendition as a native
  // TextTrack on the <video> element (and native Safari HLS/plain <track>
  // elements work the same way), so reading video.textTracks covers every
  // engine uniformly — no per-engine subtitle-listing code needed. A
  // channel with no subtitle renditions just yields an empty list, which is
  // the honest "not available" signal rather than something to fake.
  function refreshSubtitleTracks(el: HTMLVideoElement): void {
    const tracks: SubtitleTrack[] = []
    let active: string | null = null
    for (let i = 0; i < el.textTracks.length; i++) {
      const track = el.textTracks[i]
      if (track.kind !== 'subtitles' && track.kind !== 'captions') continue
      const id = String(i)
      tracks.push({ id, label: track.label || track.language || `Track ${tracks.length + 1}` })
      if (track.mode === 'showing') active = id
    }
    setState({ subtitleTracks: tracks, activeSubtitleTrack: active })
  }

  function bindVideoEvents(el: HTMLVideoElement): void {
    el.addEventListener('playing', () => setState({ status: 'playing', error: null }))
    el.addEventListener('pause', () => setState({ status: 'paused' }))
    el.addEventListener('ended', () => setState({ status: 'ended' }))
    el.addEventListener('waiting', () => setState({ status: 'loading' }))
    el.addEventListener('timeupdate', () => setState({ currentTime: el.currentTime }))
    el.addEventListener('durationchange', () => setState({ duration: el.duration || 0 }))
    el.addEventListener('error', () => {
      setError({ code: 'unknown', message: el.error?.message ?? 'Video playback error' })
    })
    el.textTracks.addEventListener('addtrack', () => refreshSubtitleTracks(el))
    el.textTracks.addEventListener('removetrack', () => refreshSubtitleTracks(el))
    // Setting el.muted fires 'volumechange' (spec-guaranteed), so this is
    // the single source of truth for keeping state.muted in sync, whether
    // the change came from setMuted() or (in principle) elsewhere.
    el.addEventListener('volumechange', () => setState({ muted: el.muted }))
  }

  function teardownActiveEngine(): void {
    hls?.destroy()
    hls = null
    mpegtsPlayer?.destroy()
    mpegtsPlayer = null
  }

  async function loadHls(sourceUrl: string, generation: number): Promise<void> {
    if (!video) return
    const { default: HlsCtor } = await import('hls.js')
    if (generation !== loadGeneration || !video) return
    if (!HlsCtor.isSupported()) {
      setError({ code: 'source-unavailable', message: 'HLS is not supported on this device' })
      return
    }
    hls = new HlsCtor()
    hls.on(HlsCtor.Events.ERROR, (_event, data) => {
      if (!data.fatal) return
      setError({ code: 'network', message: data.details })
    })
    // hls.js fetches the manifest and every segment via JS, so it hits the
    // CORS wall a plain <video src> wouldn't — dev-only, routed through the
    // manifest-rewriting proxy (see vite.config.ts). Not needed in the
    // built Tizen app (config.xml WARP access policy).
    hls.loadSource(import.meta.env.DEV ? toDevHlsProxyUrl(sourceUrl) : sourceUrl)
    hls.attachMedia(video)
  }

  async function loadMpegTs(sourceUrl: string, generation: number): Promise<void> {
    if (!video) return
    const { default: mpegts } = await import('mpegts.js')
    if (generation !== loadGeneration || !video) return
    if (!mpegts.isSupported()) {
      setError({ code: 'source-unavailable', message: 'MPEG-TS playback is not supported on this device' })
      return
    }
    // Same CORS situation as hls.js: mpegts.js fetches the stream via JS.
    const url = import.meta.env.DEV ? toDevHlsProxyUrl(sourceUrl) : sourceUrl
    const instance = mpegts.createPlayer({ type: 'mpegts', isLive: true, url })
    instance.on(mpegts.Events.ERROR, (_type: unknown, detail: unknown) => {
      setError({ code: 'network', message: typeof detail === 'string' ? detail : 'MPEG-TS playback error' })
    })
    instance.attachMediaElement(video)
    instance.load()
    mpegtsPlayer = instance
  }

  return {
    attach(element) {
      video = element
      bindVideoEvents(video)
      setState({ muted: video.muted })
    },

    async load(sourceUrl) {
      if (!video) throw new Error('Player not attached to a <video> element')
      const generation = ++loadGeneration
      teardownActiveEngine()
      setState({
        status: 'loading',
        error: null,
        currentTime: 0,
        duration: 0,
        subtitleTracks: [],
        activeSubtitleTrack: null,
      })

      if (isMpegTsSource(sourceUrl)) {
        await loadMpegTs(sourceUrl, generation)
        return
      }

      if (isHlsSource(sourceUrl) && !video.canPlayType('application/vnd.apple.mpegurl')) {
        await loadHls(sourceUrl, generation)
        return
      }

      video.src = sourceUrl
    },

    play() {
      if (!video) return Promise.reject(new Error('Player not attached to a <video> element'))
      return video.play().catch((err: unknown) => {
        setError({ code: 'unknown', message: err instanceof Error ? err.message : 'Play failed' })
      })
    },

    pause() {
      video?.pause()
    },

    seekBy(seconds) {
      if (!video) return
      video.currentTime = Math.max(0, video.currentTime + seconds)
    },

    seekToLive() {
      if (!video || video.buffered.length === 0) return
      video.currentTime = video.buffered.end(video.buffered.length - 1)
    },

    setMuted(muted) {
      if (video) video.muted = muted
    },

    setSubtitleTrack(id) {
      if (!video) return
      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i]
        if (track.kind !== 'subtitles' && track.kind !== 'captions') continue
        track.mode = id !== null && String(i) === id ? 'showing' : 'disabled'
      }
      // hls.js only fetches subtitle segments for the track selected here —
      // flipping textTrack.mode alone isn't enough to make it start pulling
      // cues over the network.
      if (hls) {
        hls.subtitleTrack = id !== null ? Number(id) : -1
        hls.subtitleDisplay = id !== null
      }
      refreshSubtitleTracks(video)
    },

    getState() {
      return state
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    dispose() {
      teardownActiveEngine()
      listeners.clear()
      video = null
      state = { ...INITIAL_STATE }
    },
  }
}
