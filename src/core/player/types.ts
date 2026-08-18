// Platform-neutral playback contract. Feature code (the Player screen,
// Watch Now button, etc.) talks only to this interface — never to
// HTMLVideoElement, hls.js, or Tizen's AVPlay directly. That keeps the door
// open to swap in Tizen's native AVPlay (better codec/DRM support on Samsung
// TVs) behind the same shape later, without touching feature code.

export type PlayerErrorCode = 'source-unavailable' | 'network' | 'decode' | 'unknown'

export interface PlayerError {
  code: PlayerErrorCode
  message: string
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
