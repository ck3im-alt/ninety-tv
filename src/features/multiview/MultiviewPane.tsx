// One live Multiview pane — video + lightweight overlay + its own pane
// menu. Two-part on purpose: the outer MultiviewPane is always focusable
// (so a still-loading/errored pane can still be opened/removed) but only
// mounts usePlayerSession (a real Player instance) once real candidates
// exist — the loading/not-found branches render no <video> at all. This is
// also what makes maximize's "suspend the other panes" (MultiviewScreen) a
// plain mount/unmount: a pane simply isn't rendered here at all while
// another pane is maximized, so its player is never created — no separate
// suspend/resume API needed.
import { useEffect, useRef, useState } from 'react'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { usePlayerSession } from '../../core/player'
import { PaneMenu } from './PaneMenu'
import type { MultiviewPane as MultiviewPaneModel } from './multiviewSession'
import type { SportEvent } from '../../data/sports/types'
import './MultiviewPane.css'

function paneTitle(pane: MultiviewPaneModel): string {
  if (pane.assignment.kind === 'channel') return pane.assignment.channel.name
  const { event } = pane.assignment
  return event.homeTeam && event.awayTeam ? `${event.homeTeam} - ${event.awayTeam}` : event.title
}

function paneStatusLine(event: SportEvent): string {
  if (event.isLive) return `LIVE${!event.isLiveHeuristic && event.liveClock ? ` · ${event.liveClock}` : ''}`
  return event.timeLabel
}

export interface MultiviewPaneProps {
  pane: MultiviewPaneModel
  isMaximized: boolean
  isAudioPane: boolean
  sessionMuted: boolean
  forceFocus: boolean
  // How many panes are actually decoding right now (1 while maximized —
  // siblings are unmounted, see MultiviewScreen — otherwise the full grid
  // count). Diagnostic-only: fed into usePlayerSession so a stall/recovery
  // log line can report how many panes were active when it happened,
  // without the player layer itself knowing anything about Multiview.
  activePaneCount: number
  // Keeps MultiviewSession.focusedPaneId in sync with real spatial-nav
  // focus — pure bookkeeping (nothing currently branches its OWN visual
  // state on this; each pane's real-time `focused` boolean below already
  // drives that), kept accurate because the session model is spec'd to
  // track it and a future feature may want it.
  onFocusPane: () => void
  onMakeFullscreen: () => void
  onRestoreGrid: () => void
  onSelectSource: (sourceIndex: number) => void
  onUseAudio: () => void
  onToggleSessionMute: () => void
  onReplaceEvent: () => void
  onRemove: () => void
}

const EMPTY_MENU_HANDLERS = {
  onMakeFullscreen: () => {},
  onRestoreGrid: () => {},
  onSelectSource: () => {},
  onUseAudio: () => {},
  onToggleSessionMute: () => {},
  onRestart: () => {},
  onGoLive: () => {},
}

// A still-resolving pane — focusable (so it can still be removed) but no
// player/menu of substance yet.
function MultiviewPaneLoading({ pane, forceFocus, onFocusPane }: Pick<MultiviewPaneProps, 'pane' | 'forceFocus' | 'onFocusPane'>) {
  const { ref, focused } = useFocusable({ focusKey: pane.id, forceFocus, onFocus: onFocusPane })
  return (
    <div ref={ref} className={`multiview-pane multiview-pane-pending ${focused ? 'focused' : ''}`}>
      <span className="multiview-pane-title">{paneTitle(pane)}</span>
      <p className="multiview-pane-status">Finding a stream…</p>
    </div>
  )
}

// A resolved-but-unwatchable pane (no trusted stream found) — still
// removable/replaceable via its own menu, and never affects sibling panes
// (see the feature's independent-error-handling requirement).
function MultiviewPaneNotFound({ pane, forceFocus, onFocusPane, onReplaceEvent, onRemove }: MultiviewPaneProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { ref, focused } = useFocusable({ focusKey: pane.id, forceFocus, onFocus: onFocusPane, onEnterPress: () => setMenuOpen(true) })
  return (
    <div ref={ref} className={`multiview-pane multiview-pane-pending ${focused ? 'focused' : ''}`}>
      <span className="multiview-pane-title">{paneTitle(pane)}</span>
      <p className="multiview-pane-status">No stream found for this event</p>
      {menuOpen && (
        <PaneMenu
          paneId={pane.id}
          isMaximized={false}
          isAudioPane={false}
          sessionMuted={false}
          candidates={[]}
          activeSourceIndex={-1}
          canGoLive={false}
          {...EMPTY_MENU_HANDLERS}
          onReplaceEvent={() => {
            setMenuOpen(false)
            onReplaceEvent()
          }}
          onRemove={() => {
            setMenuOpen(false)
            onRemove()
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  )
}

// The real player-bearing pane. Keyed by the parent on pane.assignmentId,
// so a real reassignment (Add/Replace) always gets a fresh mount (new
// Player, guaranteed clean disposal of the old one via usePlayerSession's
// unmount cleanup) while a pure "Change source"/rerank pick stays on this
// same instance via the sync effect below.
function MultiviewPaneVideo({
  pane,
  isMaximized,
  isAudioPane,
  sessionMuted,
  forceFocus,
  activePaneCount,
  onFocusPane,
  onMakeFullscreen,
  onRestoreGrid,
  onSelectSource,
  onUseAudio,
  onToggleSessionMute,
  onReplaceEvent,
  onRemove,
}: MultiviewPaneProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const sourceUrls = pane.candidates.map((candidate) => candidate.source.url)
  // usePlayerSession only reads its options once, at mount — this ref lets
  // the stall-diagnostics callback it captures always read the CURRENT
  // active pane count anyway, without needing the controller itself to be
  // recreated whenever a sibling pane is added/removed.
  const activePaneCountRef = useRef(activePaneCount)
  activePaneCountRef.current = activePaneCount
  const { videoRef, state, controller } = usePlayerSession(sourceUrls, pane.sourceIndex, {
    getActivePaneCount: () => activePaneCountRef.current,
  })

  // Applies a session-level source change (rerank on maximize, or a manual
  // pick from PaneMenu) to the already-mounted controller — usePlayerSession
  // only reads its initial index once, at mount, so an external
  // pane.sourceIndex change needs this explicit sync. Never fires from the
  // controller's OWN internal failover drift (that never touches
  // pane.sourceIndex), only from a genuine external change.
  const appliedSourceIndexRef = useRef(pane.sourceIndex)
  useEffect(() => {
    if (pane.sourceIndex !== appliedSourceIndexRef.current) {
      appliedSourceIndexRef.current = pane.sourceIndex
      controller.selectSource(pane.sourceIndex)
    }
  }, [pane.sourceIndex, controller])

  // Audio is fully decoupled from focus (see multiviewSession.ts) — the
  // only two inputs that decide whether THIS pane is audible are which pane
  // currently holds audioPaneId and the session-wide mute flag. Plain
  // setMuted() calls only — never a reload, matching the existing
  // single-player Mute button's behavior.
  const shouldBeMuted = !isAudioPane || sessionMuted
  useEffect(() => {
    controller.setMuted(shouldBeMuted)
  }, [shouldBeMuted, controller])

  const { ref, focused } = useFocusable({ focusKey: pane.id, forceFocus, onFocus: onFocusPane, onEnterPress: () => setMenuOpen(true) })

  const title = paneTitle(pane)
  const statusLine = pane.assignment.kind === 'event' ? paneStatusLine(pane.assignment.event) : undefined
  const hasError = Boolean(state.playerState.error)

  return (
    <div ref={ref} className={`multiview-pane ${focused ? 'focused' : ''}`}>
      <video ref={videoRef} className="multiview-video" autoPlay muted />
      <div className="multiview-pane-overlay">
        <div className="multiview-pane-info">
          <span className="multiview-pane-title">{title}</span>
          {statusLine && <span className="multiview-pane-status-line">{statusLine}</span>}
        </div>
        {isAudioPane && !sessionMuted && (
          <span className="multiview-audio-indicator" aria-label="Audio source">
            🔊
          </span>
        )}
      </div>
      {hasError && (
        <div className="multiview-pane-error">
          <p>
            {state.allSourcesFailed
              ? 'Stream unavailable.'
              : `${state.playerState.error?.message ?? 'Playback error'} — trying another source…`}
          </p>
        </div>
      )}
      {menuOpen && (
        <PaneMenu
          paneId={pane.id}
          isMaximized={isMaximized}
          isAudioPane={isAudioPane}
          sessionMuted={sessionMuted}
          candidates={pane.candidates}
          activeSourceIndex={state.sourceIndex}
          canGoLive
          onMakeFullscreen={() => {
            setMenuOpen(false)
            onMakeFullscreen()
          }}
          onRestoreGrid={() => {
            setMenuOpen(false)
            onRestoreGrid()
          }}
          onSelectSource={(index) => {
            // Marked as applied BEFORE the load, because this pick reaches
            // the controller twice otherwise: once here (immediately, so the
            // stream changes on the keypress rather than a render later) and
            // once from the sync effect above, when the session's own
            // pane.sourceIndex catches up. selectSource always reloads —
            // there is no same-index bail — so the pane tore down and rebuilt
            // the identical stream twice in a row, which on TV silicon is a
            // visible double stall in one of up to four live panes.
            appliedSourceIndexRef.current = index
            controller.selectSource(index)
            onSelectSource(index)
          }}
          onUseAudio={onUseAudio}
          onToggleSessionMute={onToggleSessionMute}
          onReplaceEvent={() => {
            setMenuOpen(false)
            onReplaceEvent()
          }}
          onRemove={() => {
            setMenuOpen(false)
            onRemove()
          }}
          onRestart={() => controller.selectSource(state.sourceIndex)}
          onGoLive={() => controller.seekToLive()}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  )
}

export function MultiviewPane(props: MultiviewPaneProps) {
  if (props.pane.resolution === 'loading')
    return <MultiviewPaneLoading pane={props.pane} forceFocus={props.forceFocus} onFocusPane={props.onFocusPane} />
  if (props.pane.resolution === 'not-found' || props.pane.candidates.length === 0) return <MultiviewPaneNotFound {...props} />
  return <MultiviewPaneVideo {...props} />
}
