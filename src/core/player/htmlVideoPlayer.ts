import type Hls from 'hls.js'
import type { AudioTrackSwitchedData, MediaPlaylist } from 'hls.js'
import { toDevHlsProxyUrl } from '../net/devCorsProxy'
import { buildAudioTrackLabel } from './audioLanguage'
import { createStallWatchdog } from './playbackStallWatchdog'
import type { StallWatchdog } from './playbackStallWatchdog'
import { resolvePlayerEngineConfig } from './playerEngineConfig'
import type { HlsEngineConfig, MpegTsEngineConfig, PlayerEngineConfig } from './playerEngineConfig'
import type { AudioTrack, Player, PlayerError, PlayerState, SubtitleTrack } from './types'

const INITIAL_STATE: PlayerState = {
  status: 'idle',
  currentTime: 0,
  duration: 0,
  error: null,
  subtitleTracks: [],
  activeSubtitleTrack: null,
  audioTracks: [],
  activeAudioTrack: null,
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

// The HTML5 AudioTrackList the spec defines on HTMLMediaElement.
//
// Feature-detected, never assumed: Chromium ships AudioTrackList behind a
// disabled-by-default flag, so on desktop Chrome AND on the Tizen 6.5
// (Chromium 76) firmware this app targets, `video.audioTracks` is simply
// absent — the TypeScript DOM lib declaring it does not make it exist. The
// `enabled` check matters just as much as the list's existence: a runtime
// that exposes entries with no writable `enabled` flag can list tracks but
// cannot SWITCH them, which is not support.
interface NativeAudioTrackLike {
  id?: string
  kind?: string
  label?: string
  language?: string
  enabled: boolean
}
interface NativeAudioTrackListLike {
  length: number
  [index: number]: NativeAudioTrackLike | undefined
  addEventListener?: (type: string, listener: () => void) => void
}

function nativeAudioTrackList(el: HTMLVideoElement): NativeAudioTrackListLike | null {
  const list = (el as unknown as { audioTracks?: unknown }).audioTracks
  if (!list || typeof list !== 'object') return null
  const candidate = list as NativeAudioTrackListLike
  if (typeof candidate.length !== 'number') return null
  if (candidate.length > 0 && typeof candidate[0]?.enabled !== 'boolean') return null
  return candidate
}

function bufferedRangesOf(el: HTMLVideoElement): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  for (let i = 0; i < el.buffered.length; i++) {
    ranges.push({ start: el.buffered.start(i), end: el.buffered.end(i) })
  }
  return ranges
}

// mpegts.js's LoggingControl is a module-global singleton (not per-player
// instance), so the listener is attached at most once regardless of how
// many createHtmlVideoPlayer() instances end up loading mpegts sources
// (e.g. several Multiview panes). Diagnostics-only, per the task spec: this
// must never be what application correctness depends on — see the generic
// stall watchdog below for the actual safety net. Kept because a real
// failure (a "Large audio timestamp gap"/remuxer stack overflow) was only
// ever visible through this channel, never through mpegts.Events.ERROR.
let mpegtsLogListenerAttached = false
function attachMpegtsDiagnostics(mpegtsModule: { LoggingControl: { addLogListener: (listener: (...args: unknown[]) => void) => void } }): void {
  if (mpegtsLogListenerAttached) return
  mpegtsLogListenerAttached = true
  try {
    mpegtsModule.LoggingControl.addLogListener((...args: unknown[]) => {
      console.warn('[mpegts.js]', ...args)
    })
  } catch {
    // Never let a LoggingControl API surprise (e.g. a future mpegts.js
    // version removing/renaming it) break playback over a diagnostics hook.
  }
}

// DEV-only escape hatch so engine config (enableWorker, fixAudioTimestampGap,
// etc.) can be overridden for a whole session without a rebuild — used for
// the controlled A/B comparisons in the stall-recovery investigation (see
// the task's experiment matrix). Never read outside import.meta.env.DEV, so
// it's fully tree-shaken out of production/Tizen builds; same precedent as
// DEBUG_FORCE_SCREEN_KEY.
interface DevEngineConfigOverride {
  hls?: Partial<HlsEngineConfig>
  mpegts?: Partial<MpegTsEngineConfig>
}
function devEngineConfigOverride(): DevEngineConfigOverride | undefined {
  if (!import.meta.env.DEV) return undefined
  return (window as unknown as { __ninetyPlayerEngineConfigOverride?: DevEngineConfigOverride }).__ninetyPlayerEngineConfigOverride
}

// HTML5 <video> + MSE implementation:
//  - .m3u8 sources go through hls.js (or native HLS where supported)
//  - .ts sources (the Xtream live default) go through mpegts.js
// Used as the default/fallback player; Tizen AVPlay can be added later as an
// alternate `Player` implementation behind the same interface for better
// codec/DRM support on-device.
export function createHtmlVideoPlayer(engineConfigOverrides?: DevEngineConfigOverride): Player {
  const devOverride = devEngineConfigOverride()
  const engineConfig: PlayerEngineConfig = resolvePlayerEngineConfig({
    hls: { ...engineConfigOverrides?.hls, ...devOverride?.hls },
    mpegts: { ...engineConfigOverrides?.mpegts, ...devOverride?.mpegts },
  })

  let video: HTMLVideoElement | null = null
  let hls: Hls | null = null
  // mpegts.js ships loose `any` types (see node_modules/mpegts.js/d.ts) —
  // typing this any further than the library itself does would be fake precision.
  let mpegtsPlayer: { destroy: () => void } | null = null
  let activeEngine: 'hls' | 'mpegts' | 'native' = 'native'
  let state: PlayerState = { ...INITIAL_STATE }
  const listeners = new Set<(state: PlayerState) => void>()
  let stallWatchdog: StallWatchdog | null = null
  // True ONLY while pause() below was the reason playback isn't advancing —
  // deliberately NOT the same thing as the native video.paused property.
  // Real failure found: mpegts.js's own internal buffering/recovery logic
  // (or the browser's stall handling) can call the underlying element's
  // pause() itself once a stream stops delivering data — that's exactly the
  // silent-stall case the watchdog exists to catch, so treating raw
  // video.paused as "intentionally paused, ignore" would exempt the one
  // failure mode this was built for. This flag only reflects OUR OWN
  // pause()/play() calls.
  let userPaused = false
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
  // Our stable AudioTrack.id -> the index the CURRENT engine wants for a
  // switch (hls.js's `audioTrack` setter and the native AudioTrackList are
  // both positional). Rebuilt from scratch every time the track list is
  // read, and cleared on every load/teardown, so an engine index can never
  // outlive the source it was derived from — that mapping is exactly what
  // must not leak between two different streams.
  const audioTrackIndexById = new Map<string, number>()

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

  // Identity for one hls.js audio rendition, derived from the manifest
  // rather than from its position in the array.
  //
  // MediaPlaylist.id is a counter assigned while PARSING the master
  // playlist, so it is unique and stable for the whole life of one loaded
  // source — but it is NOT the index into `hls.audioTracks`, which is the
  // subset of renditions in the currently selected AUDIO group (see
  // AudioTrackController.tracksInGroup). Pairing it with groupId is what
  // makes this unambiguous. Using the array index as the id instead would
  // "work" right up until a stale id from the previous channel selected a
  // completely different language on the new one.
  function hlsAudioTrackId(track: MediaPlaylist): string {
    return `hls:${track.groupId}:${track.id}`
  }

  // Reads whatever hls.js currently considers selectable and republishes it
  // as platform-neutral AudioTracks. Called on every event that can change
  // either the list or the selection, so the OSD always reflects the
  // engine's own view rather than what we last asked for.
  //
  // `switchedTo` is the MediaPlaylist carried by AUDIO_TRACK_SWITCHED. It is
  // preferred over reading `hls.audioTrack` back because that getter returns
  // the controller's internal trackId, and relying on it being assigned
  // before the event is dispatched would be an ordering bet on library
  // internals. The payload IS the track that was switched to.
  function refreshHlsAudioTracks(switchedTo?: MediaPlaylist): void {
    if (!hls) return
    audioTrackIndexById.clear()
    const tracks: AudioTrack[] = hls.audioTracks.map((track, index) => {
      const id = hlsAudioTrackId(track)
      audioTrackIndexById.set(id, index)
      return { id, label: buildAudioTrackLabel(track.name, track.lang, index), language: track.lang }
    })
    // Before hls.js has settled on a rendition, `audioTrack` is -1 — which
    // indexes to undefined here, i.e. an honest "nothing selected yet"
    // rather than a fabricated default.
    const switchedId = switchedTo ? hlsAudioTrackId(switchedTo) : null
    const activeAudioTrack = (switchedId !== null && audioTrackIndexById.has(switchedId) ? switchedId : tracks[hls.audioTrack]?.id) ?? null
    setState({ audioTracks: tracks, activeAudioTrack })
  }

  function refreshNativeAudioTracks(el: HTMLVideoElement): void {
    audioTrackIndexById.clear()
    const list = nativeAudioTrackList(el)
    if (!list) {
      setState({ audioTracks: [], activeAudioTrack: null })
      return
    }
    const tracks: AudioTrack[] = []
    let activeAudioTrack: string | null = null
    for (let index = 0; index < list.length; index++) {
      const track = list[index]
      if (!track) continue
      // A runtime-supplied id is preferred (it survives reordering); the
      // positional fallback is still scoped to one loaded source, since the
      // whole map is cleared on load.
      const id = track.id ? `native:${track.id}` : `native:${index}`
      audioTrackIndexById.set(id, index)
      tracks.push({ id, label: buildAudioTrackLabel(track.label, track.language, tracks.length), language: track.language })
      if (track.enabled) activeAudioTrack = id
    }
    setState({ audioTracks: tracks, activeAudioTrack })
  }

  // The one entry point every caller uses — which engine is answering is
  // this module's business, not the session controller's or the screen's.
  //
  // mpegts.js has NO branch here on purpose, and that is a finding rather
  // than an omission: its TS demuxer keeps a single `already_has_audio`
  // guard while walking the PMT (node_modules/mpegts.js/src/demux/
  // ts-demuxer.ts), so the FIRST audio elementary stream wins and every
  // further audio PID — the second and third commentary language on a
  // channel like V Sport Ultra — is dropped before it ever reaches MSE. It
  // also parses the ISO 639 language descriptor only for PGS subtitle
  // streams, never for audio, and its Player interface exposes no track
  // enumeration or selection at all. So an mpegts source falls through to
  // the native probe, which on Chromium/Tizen finds no AudioTrackList and
  // yields an empty list: the honest answer that this playback path cannot
  // offer the choice. MULTI-AUDIO-NOTES.md records the verification and the
  // platform route (Samsung AVPlay) that can, plus why swapping to it is not
  // a change this ticket could make blind.
  function refreshAudioTracks(switchedTo?: MediaPlaylist): void {
    if (hls) {
      refreshHlsAudioTracks(switchedTo)
      return
    }
    if (video) {
      refreshNativeAudioTracks(video)
      return
    }
    audioTrackIndexById.clear()
    setState({ audioTracks: [], activeAudioTrack: null })
  }

  // Generic "currentTime stopped advancing" safety net — see
  // playbackStallWatchdog.ts's header for the real failure this covers
  // (mpegts.js's remuxer crashing internally without ever reporting
  // video.error or Events.ERROR). Deliberately keyed on `state.status`
  // rather than the raw `video.paused`/etc alone, so it naturally stays
  // quiet through idle/loading/paused/ended/error and only actively
  // watches while this Player itself believes it's playing.
  function startStallWatchdog(el: HTMLVideoElement): void {
    stallWatchdog?.dispose()
    stallWatchdog = createStallWatchdog({
      // 'paused' status is only exempted while WE asked for it — see
      // userPaused's own comment above.
      isActive: () => !userPaused && (state.status === 'playing' || state.status === 'paused'),
      sample: () => ({
        currentTime: el.currentTime,
        paused: userPaused,
        seeking: el.seeking,
        readyState: el.readyState,
        networkState: el.networkState,
        bufferedRanges: bufferedRangesOf(el),
      }),
      onStall: (diagnostics) => {
        setError({
          code: 'stalled',
          message: 'Playback stalled — no progress detected',
          diagnostics: { ...diagnostics, sourceType: activeEngine },
        })
      },
    })
  }

  function bindVideoEvents(el: HTMLVideoElement): void {
    el.addEventListener('playing', () => setState({ status: 'playing', error: null }))
    el.addEventListener('pause', () => setState({ status: 'paused' }))
    el.addEventListener('ended', () => setState({ status: 'ended' }))
    el.addEventListener('waiting', () => setState({ status: 'loading' }))
    el.addEventListener('timeupdate', () => setState({ currentTime: el.currentTime }))
    el.addEventListener('durationchange', () => setState({ duration: el.duration || 0 }))
    // The native path (plain `video.src`, incl. Safari-style native HLS)
    // has no engine event to hang discovery off — metadata arriving IS the
    // moment its track list becomes readable.
    el.addEventListener('loadedmetadata', () => refreshAudioTracks())
    el.addEventListener('error', () => {
      setError({ code: 'unknown', message: el.error?.message ?? 'Video playback error' })
    })
    el.textTracks.addEventListener('addtrack', () => refreshSubtitleTracks(el))
    el.textTracks.addEventListener('removetrack', () => refreshSubtitleTracks(el))
    // Only bound where an AudioTrackList genuinely exists — see
    // nativeAudioTrackList. 'change' is the event the spec fires when a
    // track's `enabled` flips, including when something other than us
    // flipped it, which is what keeps activeAudioTrack the ENGINE's view.
    const audioTrackList = nativeAudioTrackList(el)
    if (typeof audioTrackList?.addEventListener === 'function') {
      for (const type of ['addtrack', 'removetrack', 'change']) {
        audioTrackList.addEventListener(type, () => refreshAudioTracks())
      }
    }
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
    // The engine that owned these indexes is gone; keeping them would let a
    // switch aimed at the old stream land on the new one's track list.
    audioTrackIndexById.clear()
  }

  async function loadHls(sourceUrl: string, generation: number): Promise<void> {
    if (!video) return
    const { default: HlsCtor } = await import('hls.js')
    if (generation !== loadGeneration || !video) return
    if (!HlsCtor.isSupported()) {
      setError({ code: 'source-unavailable', message: 'HLS is not supported on this device' })
      return
    }
    hls = new HlsCtor(engineConfig.hls)
    hls.on(HlsCtor.Events.ERROR, (_event, data) => {
      if (!data.fatal) return
      setError({ code: 'network', message: data.details })
    })
    // AUDIO_TRACKS_UPDATED fires whenever the set of selectable renditions
    // changes — on manifest parse, and again if a level switch moves
    // playback to a different AUDIO group. hls.js deliberately does NOT
    // dispatch it for a stream that never had alternate audio, which is
    // precisely why an ordinary single-audio channel leaves audioTracks
    // empty and shows no Audio control.
    hls.on(HlsCtor.Events.AUDIO_TRACKS_UPDATED, () => refreshAudioTracks())
    // Covers a switch we did NOT initiate as well as one we did (hls.js
    // picks the manifest's DEFAULT rendition itself on startup), so the
    // checkmark always follows the engine.
    hls.on(HlsCtor.Events.AUDIO_TRACK_SWITCHED, (_event, data: AudioTrackSwitchedData) => refreshAudioTracks(data))
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
    attachMpegtsDiagnostics(mpegts)
    // Same CORS situation as hls.js: mpegts.js fetches the stream via JS.
    const url = import.meta.env.DEV ? toDevHlsProxyUrl(sourceUrl) : sourceUrl
    const instance = mpegts.createPlayer(
      { type: 'mpegts', isLive: true, url },
      {
        enableWorker: engineConfig.mpegts.enableWorker,
        enableWorkerForMSE: engineConfig.mpegts.enableWorkerForMSE,
        fixAudioTimestampGap: engineConfig.mpegts.fixAudioTimestampGap,
      },
    )
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
      startStallWatchdog(video)
    },

    async load(sourceUrl) {
      if (!video) throw new Error('Player not attached to a <video> element')
      const generation = ++loadGeneration
      teardownActiveEngine()
      userPaused = false
      // Audio state is cleared here, not just on dispose: a new source can
      // arrive from a quality pick, an automatic failover, or a stall
      // reload, and in every one of those cases the previous stream's
      // renditions are meaningless. teardownActiveEngine() above has
      // already dropped the id -> engine-index map that went with them.
      setState({
        status: 'loading',
        error: null,
        currentTime: 0,
        duration: 0,
        subtitleTracks: [],
        activeSubtitleTrack: null,
        audioTracks: [],
        activeAudioTrack: null,
      })

      if (isMpegTsSource(sourceUrl)) {
        activeEngine = 'mpegts'
        await loadMpegTs(sourceUrl, generation)
        return
      }

      if (isHlsSource(sourceUrl) && !video.canPlayType('application/vnd.apple.mpegurl')) {
        activeEngine = 'hls'
        await loadHls(sourceUrl, generation)
        return
      }

      activeEngine = 'native'
      video.src = sourceUrl
    },

    play() {
      if (!video) return Promise.reject(new Error('Player not attached to a <video> element'))
      userPaused = false
      return video.play().catch((err: unknown) => {
        setError({ code: 'unknown', message: err instanceof Error ? err.message : 'Play failed' })
      })
    },

    pause() {
      userPaused = true
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

    setAudioTrack(id) {
      // An id that isn't in the CURRENT list is a stale selection (a
      // previous channel's, or a track that disappeared on a group switch).
      // Dropping it here is the whole reason ids are content-derived rather
      // than positional — there is no index to misapply.
      const index = audioTrackIndexById.get(id)
      if (index === undefined) return

      if (hls) {
        // Switches the audio rendition in place: hls.js keeps the same
        // level, the same buffered position and the same media element, so
        // playback, live edge, mute state and subtitles are all untouched.
        // AUDIO_TRACK_SWITCHED then reports the result back through
        // refreshAudioTracks, which is what moves the OSD's checkmark.
        hls.audioTrack = index
        return
      }

      const list = video ? nativeAudioTrackList(video) : null
      if (!list) return
      // AudioTrackList is a radio group expressed as a set of booleans —
      // exactly one entry may be enabled, so the others must be cleared.
      for (let i = 0; i < list.length; i++) {
        const track = list[i]
        if (track) track.enabled = i === index
      }
      // Some implementations fire 'change' for this, some don't; refreshing
      // directly makes the state update unconditional rather than dependent
      // on an event that may never arrive.
      refreshAudioTracks()
    },

    getState() {
      return state
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    dispose() {
      stallWatchdog?.dispose()
      stallWatchdog = null
      teardownActiveEngine()
      // Samsung Tizen: a dormant <video> element with a loaded source still
      // holds decoder/buffer memory even after hls.js/mpegts.js are
      // destroyed (Samsung's own multi-video guidance: "release video
      // element resources when not playing") — and Tizen's MSE
      // implementation is commonly reported as tied to a single shared
      // streaming engine, so a decoder a suspended Multiview pane never lets
      // go of can starve a sibling pane that needs one. Relying on GC to
      // eventually reclaim the element (the previous behavior here) isn't
      // fast/reliable enough on resource-constrained TV hardware. Explicitly
      // clearing the source and calling load() is the standard way to force
      // the element to release its media resource immediately.
      if (video) {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
      listeners.clear()
      video = null
      state = { ...INITIAL_STATE }
    },
  }
}
