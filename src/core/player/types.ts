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

// One selectable audio rendition on the current source — the Norwegian /
// Swedish / Danish commentary variants a channel like V Sport Ultra carries
// inside one stream. Same honesty rule as SubtitleTrack: only ever
// populated from what the stream itself declares through an engine that can
// actually SWITCH between them, so an empty list means "this playback path
// cannot offer a choice here", never "we didn't look". A list of one is
// equally honest — the stream has exactly one audio rendition — and the OSD
// simply offers no control for it.
export interface AudioTrack {
  // Stable within one loaded source, and derived from the track's own
  // metadata rather than its position, so an id left over from a previous
  // channel MISSES (a safe no-op in setAudioTrack) instead of silently
  // selecting whatever now happens to sit at that array index.
  id: string
  // Already resolved for display — see buildAudioTrackLabel in
  // audioLanguage.ts for the preference order.
  label: string
  // The RAW value the stream declared ('nb', 'nor', 'sv-SE'), never
  // normalized and never inferred from the channel name. Kept on the model
  // so presentation can improve (better chips, a future "prefer Norwegian"
  // preference) without re-reading the engine.
  language?: string
}

export interface PlayerState {
  status: PlayerStatus
  currentTime: number
  duration: number
  error: PlayerError | null
  subtitleTracks: SubtitleTrack[]
  activeSubtitleTrack: string | null
  audioTracks: AudioTrack[]
  // id of the rendition the ENGINE reports as playing — not the one we last
  // asked for. A switch is only reflected here once the engine confirms it,
  // which is what lets the OSD's checkmark mean "this is what you're
  // hearing" rather than "this is what you clicked".
  activeAudioTrack: string | null
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
  // Switches which audio rendition is playing. No id means "off" here (you
  // cannot turn audio off, only pick one), so unlike setSubtitleTrack there
  // is no null. An id that isn't in the current audioTracks list is a safe
  // no-op — stale selections from a previous source must never reach the
  // engine as an index.
  //
  // Must not disturb anything else the viewer set up: no reload, no source
  // or quality change, no seek away from the live edge, no mute change, and
  // no effect on subtitles.
  setAudioTrack(id: string): void
  getState(): PlayerState
  subscribe(listener: (state: PlayerState) => void): () => void
  dispose(): void
}
