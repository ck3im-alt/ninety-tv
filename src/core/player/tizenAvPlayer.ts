import { getSamsungAvPlayApi } from '../platform/samsungProductApi'
import type {
  SamsungAvPlayApi,
  SamsungAvPlayPlaybackCallback,
  SamsungAvPlayTrackInfo,
} from '../platform/samsungProductApi'
import { buildAudioTrackLabel } from './audioLanguage'
import { createHtmlVideoPlayer } from './htmlVideoPlayer'
import type { AudioTrack, Player, PlayerState, SubtitleTrack } from './types'

const DESIGN_WIDTH = 1920
const DESIGN_HEIGHT = 1080
const STARTUP_DEADLINE_MS = 12_000

const INITIAL_STATE: PlayerState = {
  status: 'idle',
  currentTime: 0,
  duration: 0,
  error: null,
  subtitleTracks: [],
  activeSubtitleTrack: null,
  audioTracks: [],
  activeAudioTrack: null,
  muted: true,
}

interface TrackMetadata {
  language?: string
  name?: string
}

function trackMetadata(track: SamsungAvPlayTrackInfo): TrackMetadata {
  if (!track.extra_info) return {}
  try {
    const raw = JSON.parse(track.extra_info) as Record<string, unknown>
    const language = [raw.language, raw.track_lang, raw.lang].find((value) => typeof value === 'string')
    const name = [raw.title, raw.track_name, raw.name].find((value) => typeof value === 'string')
    return {
      language: typeof language === 'string' ? language : undefined,
      name: typeof name === 'string' ? name : undefined,
    }
  } catch {
    return {}
  }
}

function liveEdgeMilliseconds(api: SamsungAvPlayApi): number | null {
  try {
    const value = api.getStreamingProperty('GET_LIVE_DURATION')
    const parts = value.split('|')
    const end = Number(parts[parts.length - 1])
    return Number.isFinite(end) && end >= 0 ? end : null
  } catch {
    return null
  }
}

// Samsung AVPlay owns one native decoder/display surface for the process.
// This adapter is therefore used only by the full-screen player. It keeps
// an already-attached HTML player beside it and can hand the SAME source to
// that engine if AVPlay is absent, rejects prepare/play, or dies before the
// stream starts. The session controller only sees an error if both paths
// fail, so native incompatibility cannot accidentally look like a dead
// channel and rotate to a different provider.
export function createTizenAvPlayer(): Player {
  const fallback = createHtmlVideoPlayer()
  let video: HTMLVideoElement | null = null
  let nativeObject: HTMLObjectElement | null = null
  let api: SamsungAvPlayApi | null = null
  let engine: 'avplay' | 'html' = 'html'
  let state: PlayerState = { ...INITIAL_STATE }
  let sourceUrl = ''
  let generation = 0
  let disposed = false
  let startupTimer: ReturnType<typeof setTimeout> | null = null
  let progressTimer: ReturnType<typeof setInterval> | null = null
  let lastNativeProgressAt = 0
  let lastNativeTime = -1
  let nativeHasPlayed = false
  let subtitlesEnabled = false
  let fallbackAttempted = false
  // Once this session has needed HTML, keep using it for later failover
  // URLs too. The HTML engine can retain an MSE decoder between loads;
  // trying to bring the process-global AVPlay decoder back alongside it is
  // precisely the resource contention this adapter is meant to avoid.
  let nativeDisabledForSession = false
  const listeners = new Set<(state: PlayerState) => void>()
  const audioIndexById = new Map<string, number>()
  const subtitleIndexById = new Map<string, number>()

  function emit(): void {
    if (disposed) return
    for (const listener of listeners) listener(state)
  }

  function setState(patch: Partial<PlayerState>): void {
    state = { ...state, ...patch }
    emit()
  }

  function clearStartupTimer(): void {
    if (startupTimer) clearTimeout(startupTimer)
    startupTimer = null
  }

  function stopProgressWatchdog(): void {
    if (progressTimer) clearInterval(progressTimer)
    progressTimer = null
  }

  function startProgressWatchdog(loadGeneration: number): void {
    stopProgressWatchdog()
    lastNativeProgressAt = Date.now()
    progressTimer = setInterval(() => {
      if (disposed || loadGeneration !== generation || engine !== 'avplay') return
      if (!nativeHasPlayed || (state.status !== 'playing' && state.status !== 'loading')) return
      if (Date.now() - lastNativeProgressAt < STARTUP_DEADLINE_MS) return
      // A native decoder that has stopped delivering time callbacks is the
      // AVPlay equivalent of HTML's stalled watchdog. Try the same URL in
      // the independent HTML pipeline before involving source failover.
      void activateFallback(loadGeneration, true)
    }, 1_000)
  }

  function releaseNative(): void {
    clearStartupTimer()
    stopProgressWatchdog()
    if (!api) return
    try {
      const nativeState = api.getState?.()
      if (nativeState && nativeState !== 'NONE' && nativeState !== 'IDLE') api.stop?.()
    } catch {
      // A partially-open or already-failed AVPlay instance commonly throws
      // during cleanup. close() still gets its own attempt below.
    }
    try {
      api.close()
    } catch {
      // The instance was already closed; cleanup remains idempotent.
    }
  }

  function ensureNativeObject(): void {
    if (!video || nativeObject) return
    const object = document.createElement('object')
    object.type = 'application/avplayer'
    object.className = video.className
    object.setAttribute('aria-hidden', 'true')
    video.parentElement?.insertBefore(object, video)
    nativeObject = object
  }

  function showEngine(next: 'avplay' | 'html'): void {
    engine = next
    if (video) video.style.visibility = next === 'html' ? 'visible' : 'hidden'
    if (nativeObject) nativeObject.style.display = next === 'avplay' ? 'block' : 'none'
  }

  function positionNative(): void {
    if (!video || !api) return
    const rect = video.getBoundingClientRect()
    const viewportWidth = window.innerWidth || DESIGN_WIDTH
    const viewportHeight = window.innerHeight || DESIGN_HEIGHT
    const x = Math.round((rect.left / viewportWidth) * DESIGN_WIDTH)
    const y = Math.round((rect.top / viewportHeight) * DESIGN_HEIGHT)
    const width = Math.max(1, Math.round((rect.width / viewportWidth) * DESIGN_WIDTH))
    const height = Math.max(1, Math.round((rect.height / viewportHeight) * DESIGN_HEIGHT))
    try {
      api.setDisplayRect?.(x, y, width, height)
    } catch {
      // Playback can still work with AVPlay's previous/default rectangle.
    }
  }

  function refreshTracks(): void {
    if (!api || engine !== 'avplay') return
    let all: SamsungAvPlayTrackInfo[] = []
    let current: SamsungAvPlayTrackInfo[] = []
    try {
      all = api.getTotalTrackInfo?.() ?? []
      current = api.getCurrentStreamInfo?.() ?? []
    } catch {
      return
    }

    audioIndexById.clear()
    subtitleIndexById.clear()
    const activeAudioIndices = new Set(current.filter((track) => track.type === 'AUDIO').map((track) => track.index))
    const activeTextIndices = new Set(current.filter((track) => track.type === 'TEXT').map((track) => track.index))

    const audioTracks: AudioTrack[] = all
      .filter((track) => track.type === 'AUDIO')
      .map((track, position) => {
        const metadata = trackMetadata(track)
        const id = `avplay:AUDIO:${track.index}`
        audioIndexById.set(id, track.index)
        return {
          id,
          label: buildAudioTrackLabel(metadata.name, metadata.language, position),
          language: metadata.language,
        }
      })
    const subtitleTracks: SubtitleTrack[] = all
      .filter((track) => track.type === 'TEXT')
      .map((track, position) => {
        const metadata = trackMetadata(track)
        const id = `avplay:TEXT:${track.index}`
        subtitleIndexById.set(id, track.index)
        return { id, label: metadata.name || metadata.language || `Subtitle ${position + 1}` }
      })

    setState({
      audioTracks,
      activeAudioTrack: audioTracks.find((track) => activeAudioIndices.has(audioIndexById.get(track.id) ?? -1))?.id ?? null,
      subtitleTracks,
      activeSubtitleTrack: subtitlesEnabled
        ? (subtitleTracks.find((track) => activeTextIndices.has(subtitleIndexById.get(track.id) ?? -1))?.id ?? null)
        : null,
    })
  }

  async function activateFallback(loadGeneration: number, shouldPlay: boolean): Promise<void> {
    if (disposed || loadGeneration !== generation || fallbackAttempted) return
    fallbackAttempted = true
    nativeDisabledForSession = true
    showEngine('html')
    releaseNative()
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
    try {
      await fallback.load(sourceUrl)
      if (shouldPlay && !disposed && loadGeneration === generation) await fallback.play()
    } catch (error) {
      if (disposed || loadGeneration !== generation) return
      setState({
        status: 'error',
        error: {
          code: 'unknown',
          message: error instanceof Error ? error.message : 'Both native and HTML playback failed',
        },
      })
    }
  }

  function nativeFailure(loadGeneration: number): void {
    if (disposed || loadGeneration !== generation || engine !== 'avplay') return
    // The error text is intentionally not surfaced yet: AVPlay rejecting a
    // codec/resource is not evidence that the URL itself is dead. The HTML
    // fallback becomes authoritative and will classify any real source
    // failure for the session controller if it also cannot play the URL.
    void activateFallback(loadGeneration, true)
  }

  function listenerFor(loadGeneration: number): SamsungAvPlayPlaybackCallback {
    return {
      onbufferingstart() {
        if (loadGeneration === generation && engine === 'avplay') setState({ status: 'loading' })
      },
      onbufferingcomplete() {
        if (loadGeneration === generation && engine === 'avplay') refreshTracks()
      },
      oncurrentplaytime(milliseconds) {
        if (loadGeneration !== generation || engine !== 'avplay') return
        clearStartupTimer()
        nativeHasPlayed = true
        if (milliseconds !== lastNativeTime) {
          lastNativeTime = milliseconds
          lastNativeProgressAt = Date.now()
        }
        let duration = state.duration
        try {
          duration = (api?.getDuration?.() ?? 0) / 1000
        } catch {
          // Keep the last known duration.
        }
        setState({ status: 'playing', error: null, currentTime: milliseconds / 1000, duration })
      },
      onstreamcompleted() {
        if (loadGeneration === generation && engine === 'avplay') setState({ status: 'ended' })
      },
      onerror() {
        nativeFailure(loadGeneration)
      },
      onerrormsg() {
        nativeFailure(loadGeneration)
      },
      onresourceconflicted() {
        nativeFailure(loadGeneration)
      },
    }
  }

  const unsubscribeFallback = fallback.subscribe((fallbackState) => {
    if (engine !== 'html' || disposed) return
    state = fallbackState
    emit()
  })

  return {
    attach(element) {
      video = element
      fallback.attach(element)
      state = { ...state, muted: element.muted }
      api = nativeDisabledForSession ? null : getSamsungAvPlayApi()
      if (api) {
        ensureNativeObject()
        showEngine('avplay')
      } else {
        showEngine('html')
      }
    },

    async load(nextSourceUrl) {
      if (!video) throw new Error('Player not attached to a <video> element')
      const loadGeneration = ++generation
      sourceUrl = nextSourceUrl
      fallbackAttempted = false
      nativeHasPlayed = false
      subtitlesEnabled = false
      lastNativeTime = -1
      clearStartupTimer()
      releaseNative()
      api = nativeDisabledForSession ? null : getSamsungAvPlayApi()

      if (!api) {
        showEngine('html')
        fallbackAttempted = true
        await fallback.load(nextSourceUrl)
        return
      }

      ensureNativeObject()
      showEngine('avplay')
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

      try {
        api.open(nextSourceUrl)
        api.setListener(listenerFor(loadGeneration))
        positionNative()
        api.setDisplayMethod?.('PLAYER_DISPLAY_MODE_LETTER_BOX')
        if (state.muted) api.disableAudioStream?.()
        api.setSilentSubtitle?.(true)
        await new Promise<void>((resolve, reject) => {
          let settled = false
          const finish = (callback: () => void) => {
            if (settled) return
            settled = true
            clearTimeout(deadline)
            callback()
          }
          const deadline = setTimeout(() => {
            finish(() => reject(new Error('AVPlay did not prepare within 12 seconds')))
          }, STARTUP_DEADLINE_MS)
          api!.prepareAsync(
            () => finish(resolve),
            (error) => finish(() => reject(error)),
          )
        })
        if (loadGeneration !== generation || disposed) return
        refreshTracks()
      } catch {
        if (loadGeneration !== generation || disposed) return
        await activateFallback(loadGeneration, false)
      }
    },

    async play() {
      if (engine === 'html') return fallback.play()
      if (!api) return
      const playGeneration = generation
      try {
        api.play()
        startProgressWatchdog(playGeneration)
        clearStartupTimer()
        startupTimer = setTimeout(() => {
          if (playGeneration !== generation || engine !== 'avplay' || state.status === 'playing') return
          void activateFallback(playGeneration, true)
        }, STARTUP_DEADLINE_MS)
      } catch {
        await activateFallback(playGeneration, true)
      }
    },

    pause() {
      if (engine === 'html') {
        fallback.pause()
        return
      }
      try {
        api?.pause?.()
        setState({ status: 'paused' })
      } catch {
        // Invalid-state pauses are harmless (e.g. while still buffering).
      }
    },

    seekBy(seconds) {
      if (engine === 'html') {
        fallback.seekBy(seconds)
        return
      }
      try {
        if (seconds >= 0) api?.jumpForward?.(seconds * 1000)
        else api?.jumpBackward?.(-seconds * 1000)
      } catch {
        // Live streams may not expose a seekable window.
      }
    },

    seekToLive() {
      if (engine === 'html') {
        fallback.seekToLive()
        return
      }
      if (!api) return
      const end = liveEdgeMilliseconds(api)
      if (end === null) return
      try {
        api.seekTo?.(end)
      } catch {
        // The current broadcast is not seekable.
      }
    },

    setMuted(muted) {
      state = { ...state, muted }
      // Keep the dormant HTML path synchronized so a mid-stream native
      // failure cannot unexpectedly re-mute (or unmute) the viewer.
      fallback.setMuted(muted)
      if (engine === 'html') {
        // fallback.setMuted above emits the authoritative HTML state.
      } else {
        try {
          if (muted) api?.disableAudioStream?.()
          else api?.enableAudioStream?.()
        } catch {
          // Older firmware may expose AVPlay without audio-stream toggles.
        }
        emit()
      }
    },

    setSubtitleTrack(id) {
      if (engine === 'html') {
        fallback.setSubtitleTrack(id)
        return
      }
      if (!api) return
      try {
        if (id === null) {
          subtitlesEnabled = false
          api.setSilentSubtitle?.(true)
          setState({ activeSubtitleTrack: null })
          return
        }
        const index = subtitleIndexById.get(id)
        if (index === undefined) return
        subtitlesEnabled = true
        api.setSilentSubtitle?.(false)
        api.setSelectTrack?.('TEXT', index)
        refreshTracks()
      } catch {
        // Stale or unsupported subtitle selections are safe no-ops.
      }
    },

    setAudioTrack(id) {
      if (engine === 'html') {
        fallback.setAudioTrack(id)
        return
      }
      const index = audioIndexById.get(id)
      if (index === undefined || !api) return
      try {
        api.setSelectTrack?.('AUDIO', index)
        refreshTracks()
      } catch {
        // Stale or unsupported audio selections are safe no-ops.
      }
    },

    getState() {
      return state
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    dispose() {
      disposed = true
      generation += 1
      clearStartupTimer()
      releaseNative()
      unsubscribeFallback()
      fallback.dispose()
      nativeObject?.remove()
      nativeObject = null
      if (video) video.style.visibility = ''
      video = null
      listeners.clear()
      state = { ...INITIAL_STATE }
    },
  }
}
