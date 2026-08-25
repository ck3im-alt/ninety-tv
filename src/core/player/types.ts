// Platform-neutral playback contract. Feature code (the Player screen,
// Watch Now button, etc.) talks only to this interface — never to
// HTMLVideoElement, hls.js, or Tizen's AVPlay directly. That keeps the door
// open to swap in Tizen's native AVPlay (better codec/DRM support on Samsung
// TVs) behind the same shape later, without touching feature code.

// 'stalled' is raised by the generic currentTime-progress watchdog (see
// playbackStallWatchdog.ts) — playback stopped advancing without the
// underlying engine (hls.js/mpegts.js/native) ever reporting video.error or
// its own ERROR event. Found via a real failure: mpegts.js's remuxer hit an
// internal exception compensating for a bogus timestamp gap and never
// surfaced it any other way — the watchdog is the safety net for exactly
// that class of otherwise-invisible failure.
export type PlayerErrorCode = 'source-unavailable' | 'network' | 'decode' | 'stalled' | 'unknown'

// Extra context attached only to a 'stalled' PlayerError — cheap to include
// always (it's a plain object assembled from data already read every tick),
// and diagnostic-only: nothing in the app depends on its shape for
// correctness, only for logging (see playerSessionController.ts).
export interface PlaybackDiagnostics {
  sourceType: 'hls' | 'mpegts' | 'native'
  currentTime: number
  previousProgressingCurrentTime: number
  stalledDurationMs: number
  readyState: number
  networkState: number
  bufferedRanges: Array<{ start: number; end: number }>
}

export interface PlayerError {
  code: PlayerErrorCode
  message: string
  diagnostics?: PlaybackDiagnostics
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'

// A subtitle/closed-caption track discovered on the current source. Only
// ever populated from tracks the stream itself declares (an HLS subtitle
// rendition, or a native <video> text track) — never fabricated, so an empty
// list is the honest signal that this channel has no subtitles to offer.
export interface SubtitleTrack {
  id: string
  label: string
}

export interface PlayerState {
  status: PlayerStatus
  currentTime: number
  duration: number
  error: PlayerError | null
  subtitleTracks: SubtitleTrack[]
  activeSubtitleTrack: string | null
  muted: boolean
}

export interface Player {
  attach(element: HTMLVideoElement): void
  load(sourceUrl: string): Promise<void>
  play(): Promise<void>
  pause(): void
  seekBy(seconds: number): void
  // Jumps to the live edge of the current buffered range. Generic across
  // both hls.js and mpegts.js since both feed the same <video> via MSE.
  seekToLive(): void
  setMuted(muted: boolean): void
  // Pass null to turn subtitles off. No-op if the id isn't in the current
  // subtitleTracks list (e.g. stale selection from a previous channel).
  setSubtitleTrack(id: string | null): void
  getState(): PlayerState
  subscribe(listener: (state: PlayerState) => void): () => void
  dispose(): void
}
