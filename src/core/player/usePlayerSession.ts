// Thin React glue over createPlayerSessionController — creates the
// underlying Player + controller once per mount, attaches the <video> ref,
// subscribes for re-renders, and disposes both on unmount. All the actual
// failover/state-machine logic lives in playerSessionController.ts (pure,
// unit-tested without React); this hook does nothing but wire it to the DOM
// and React's render cycle, so both ChannelPlayerScreen and every Multiview
// pane can reuse the identical, independently-instantiated lifecycle.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createHtmlVideoPlayer } from './htmlVideoPlayer'
import { createPlayerSessionController } from './playerSessionController'
import type { PlayerSessionController, PlayerSessionOptions, PlayerSessionState } from './playerSessionController'

// Only compares the fields any current consumer actually reads — status,
// error, muted, subtitles, sourceIndex, allSourcesFailed. Deliberately
// excludes currentTime/duration (see ChannelPlayerScreen's original
// playerUiStateEqual, which this mirrors) so a re-render doesn't fire on
// every ~4x/sec `timeupdate` tick.
function sessionStateEqual(a: PlayerSessionState, b: PlayerSessionState): boolean {
  if (a === b) return true
  if (a.sourceIndex !== b.sourceIndex) return false
  if (a.allSourcesFailed !== b.allSourcesFailed) return false
  const pa = a.playerState
  const pb = b.playerState
  if (pa.status !== pb.status) return false
  if (pa.muted !== pb.muted) return false
  if (pa.activeSubtitleTrack !== pb.activeSubtitleTrack) return false
  if ((pa.error?.code ?? null) !== (pb.error?.code ?? null)) return false
  if ((pa.error?.message ?? null) !== (pb.error?.message ?? null)) return false
  if (pa.subtitleTracks.length !== pb.subtitleTracks.length) return false
  for (let i = 0; i < pa.subtitleTracks.length; i++) {
    if (pa.subtitleTracks[i].id !== pb.subtitleTracks[i].id) return false
    if (pa.subtitleTracks[i].label !== pb.subtitleTracks[i].label) return false
  }
  return true
}

export interface PlayerSession {
  videoRef: React.RefObject<HTMLVideoElement | null>
  state: PlayerSessionState
  controller: PlayerSessionController
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
export function usePlayerSession(sourceUrls: readonly string[], initialIndex = 0, options?: PlayerSessionOptions): PlayerSession {
  const videoRef = useRef<HTMLVideoElement>(null)
  const player = useMemo(() => createHtmlVideoPlayer(), [])
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

  return { videoRef, state, controller }
}
