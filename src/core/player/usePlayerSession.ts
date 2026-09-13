// Thin React glue over createPlayerSessionController — creates the
// underlying Player + controller once per mount, attaches the <video> ref,
// subscribes for re-renders, and disposes both on unmount. All the actual
// failover/state-machine logic lives in playerSessionController.ts (pure,
// unit-tested without React); this hook does nothing but wire it to the DOM
// and React's render cycle, so both ChannelPlayerScreen and every Multiview
// pane can reuse the identical, independently-instantiated lifecycle.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createHtmlVideoPlayer } from './htmlVideoPlayer'
import { createTizenAvPlayer } from './tizenAvPlayer'
import { createPlayerSessionController } from './playerSessionController'
import type { PlayerSessionController, PlayerSessionOptions, PlayerSessionState } from './playerSessionController'
import { playbackScreenSaver } from '../platform/screenSaver'

// Only compares the fields any current consumer actually reads — status,
// error, muted, subtitles, audio tracks, sourceIndex, allSourcesFailed.
// Deliberately excludes currentTime/duration (see ChannelPlayerScreen's
// original playerUiStateEqual, which this mirrors) so a re-render doesn't
// fire on every ~4x/sec `timeupdate` tick.
//
// Audio has to be in here for the feature to work at all, not merely to
// stay fresh: discovery and switching both happen inside the Player, driven
// by engine events, so a comparison blind to them would leave the OSD
// showing no Audio button on a multi-audio stream and a checkmark that
// never moves. Every field the popup renders is compared — id (identity),
// label (row text) and language (the chip) — since any of them changing is
// something the viewer can see.
function sessionStateEqual(a: PlayerSessionState, b: PlayerSessionState): boolean {
  if (a === b) return true
  if (a.sourceIndex !== b.sourceIndex) return false
  if (a.allSourcesFailed !== b.allSourcesFailed) return false
  const pa = a.playerState
  const pb = b.playerState
  if (pa.status !== pb.status) return false
  if (pa.muted !== pb.muted) return false
  if (pa.activeSubtitleTrack !== pb.activeSubtitleTrack) return false
  if (pa.activeAudioTrack !== pb.activeAudioTrack) return false
  if ((pa.error?.code ?? null) !== (pb.error?.code ?? null)) return false
  if ((pa.error?.message ?? null) !== (pb.error?.message ?? null)) return false
  if (pa.subtitleTracks.length !== pb.subtitleTracks.length) return false
  for (let i = 0; i < pa.subtitleTracks.length; i++) {
    if (pa.subtitleTracks[i].id !== pb.subtitleTracks[i].id) return false
    if (pa.subtitleTracks[i].label !== pb.subtitleTracks[i].label) return false
  }
  if (pa.audioTracks.length !== pb.audioTracks.length) return false
  for (let i = 0; i < pa.audioTracks.length; i++) {
    if (pa.audioTracks[i].id !== pb.audioTracks[i].id) return false
    if (pa.audioTracks[i].label !== pb.audioTracks[i].label) return false
    if (pa.audioTracks[i].language !== pb.audioTracks[i].language) return false
  }
  return true
}

export interface PlayerSession {
  videoRef: React.RefObject<HTMLVideoElement | null>
  state: PlayerSessionState
  controller: PlayerSessionController
}

export interface UsePlayerSessionOptions extends PlayerSessionOptions {
  // AVPlay is a process-global native surface, so only the ordinary
  // full-screen player opts in. Multiview deliberately leaves this false
  // and keeps one independent HTML/MSE engine per pane.
  preferTizenNative?: boolean
}

// sourceUrls/initialIndex/options are only read once, at mount — a session
// that needs an entirely different source LIST (a real event/channel
// reassignment, not just a quality-tier change) is expected to get a fresh
// mount (new React key) rather than this hook reacting to prop changes; see
// multiviewSession.ts's per-assignment id and ChannelPlayerScreen's
// `selected` (still set once, unchanged from before this refactor).
// `options.getActivePaneCount`, if provided, should be a STABLE callback
// that reads current data via a ref internally (same pattern used
// throughout the Multiview feature) — passing a fresh closure each render
// is harmless but pointless, since only the one captured at mount is ever
// called.
export function usePlayerSession(sourceUrls: readonly string[], initialIndex = 0, options?: UsePlayerSessionOptions): PlayerSession {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [player] = useState(() => (options?.preferTizenNative ? createTizenAvPlayer() : createHtmlVideoPlayer()))
  const controller = useMemo(
    () => createPlayerSessionController(player, sourceUrls, initialIndex, options),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [player],
  )
  const [state, setState] = useState<PlayerSessionState>(controller.getState())

  useEffect(() => {
    if (videoRef.current) controller.attach(videoRef.current)
    const unsubscribe = controller.subscribe((next) => {
      setState((prev) => (sessionStateEqual(prev, next) ? prev : next))
    })
    return () => {
      unsubscribe()
      controller.dispose()
    }
  }, [controller])

  // SAMSUNG SCREENSAVER LEASE. This hook is the right seam for it because
  // it is the ONE place both playback surfaces meet: ChannelPlayerScreen
  // instantiates it once, and every Multiview pane instantiates its own
  // (see MultiviewPane.tsx) — verified against both call sites, not
  // assumed. Putting the lease here therefore covers four concurrent panes
  // and the full-screen player with one implementation, and the
  // coordinator (not this hook) is what turns N leases into the single
  // correct system-wide state.
  //
  // Driven off the ENGINE-reported status rather than "the screen is
  // mounted": a paused or errored session is not playing, and Samsung's
  // requirement is that the screensaver comes back when playback
  // stops/pauses. 'loading' deliberately does not hold a lease either —
  // a channel that never manages to start must not suppress the
  // screensaver indefinitely.
  //
  // The cleanup runs on every status change away from 'playing' AND on
  // unmount, and the release function is idempotent, so pause -> dispose
  // -> unmount releases exactly one lease.
  const playing = state.playerState.status === 'playing'
  useEffect(() => {
    if (!playing) return
    return playbackScreenSaver.acquire()
  }, [playing])

  return { videoRef, state, controller }
}
