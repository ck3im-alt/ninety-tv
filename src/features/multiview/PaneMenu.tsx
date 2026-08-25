// One pane's lightweight popup menu — built on useModalFocusScope, the same
// primitive behind ChannelPlayerScreen's Source/Subtitles popups and
// FilterPopup/AdminPanel, so it gets focus-trap/Back-to-close/restore for
// free. Deliberately a single small popup (not a duplicate of the full
// single-stream player's OSD) reused for BOTH grid and maximized
// presentation of a pane — see MultiviewScreen's view-mode toggle.
import { useState } from 'react'
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useModalFocusScope, useFocusScrollIntoView } from '../../core/platform'
import type { MultiviewSourceCandidate } from './multiviewCandidates'

interface MenuRowProps {
  focusKey?: string
  label: string
  onSelect: () => void
}

function MenuRow({ focusKey, label, onSelect }: MenuRowProps) {
  const { ref, focused } = useFocusable({ focusKey, onEnterPress: onSelect })
  useFocusScrollIntoView(ref, focused)
  return (
    <div ref={ref} className={`pane-menu-row ${focused ? 'focused' : ''}`} onClick={onSelect}>
      {label}
    </div>
  )
}

function SourceOptionRow({
  focusKey,
  candidate,
  active,
  onSelect,
}: {
  focusKey?: string
  candidate: MultiviewSourceCandidate
  active: boolean
  onSelect: () => void
}) {
  const { ref, focused } = useFocusable({ focusKey, onEnterPress: onSelect })
  useFocusScrollIntoView(ref, focused)
  return (
    <div ref={ref} className={`pane-menu-row ${focused ? 'focused' : ''}`} onClick={onSelect}>
      <span className="pane-menu-source-label">{candidate.displayName}</span>
      <span className="pane-menu-source-quality">{candidate.qualityLabel ?? ''}</span>
      {active && <span className="pane-menu-check">✓</span>}
    </div>
  )
}

export interface PaneMenuProps {
  paneId: string
  isMaximized: boolean
  isAudioPane: boolean
  sessionMuted: boolean
  candidates: MultiviewSourceCandidate[]
  activeSourceIndex: number
  canGoLive: boolean
  onMakeFullscreen: () => void
  onRestoreGrid: () => void
  onSelectSource: (index: number) => void
  onUseAudio: () => void
  onToggleSessionMute: () => void
  onReplaceEvent: () => void
  onRemove: () => void
  onRestart: () => void
  onGoLive: () => void
  onClose: () => void
}

export function PaneMenu({
  paneId,
  isMaximized,
  isAudioPane,
  sessionMuted,
  candidates,
  activeSourceIndex,
  canGoLive,
  onMakeFullscreen,
  onRestoreGrid,
  onSelectSource,
  onUseAudio,
  onToggleSessionMute,
  onReplaceEvent,
  onRemove,
  onRestart,
  onGoLive,
  onClose,
}: PaneMenuProps) {
  const [view, setView] = useState<'menu' | 'sources'>('menu')
  const menuFocusKey = `${paneId}-menu`
  const sourcesFocusKey = `${paneId}-menu-sources`

  // Back in the sources sub-view returns to the main menu instead of
  // closing outright; Back in the main menu closes it. useBackHandler (via
  // useModalFocusScope) always reads the LATEST closure on keypress (see its
  // own header comment), so this correctly reflects whichever `view` is
  // current at the moment Back is actually pressed, even though the
  // handler itself is only pushed once per mount.
  function handleClose() {
    if (view === 'sources') {
      setView('menu')
      return
    }
    onClose()
  }

  const preferredChildFocusKey =
    view === 'sources' ? `${sourcesFocusKey}-${activeSourceIndex}` : isMaximized ? `${paneId}-restore-grid` : `${paneId}-fullscreen`

  const { ref, focusKey } = useModalFocusScope({
    focusKey: view === 'sources' ? sourcesFocusKey : menuFocusKey,
    onClose: handleClose,
    preferredChildFocusKey,
  })

  if (view === 'sources') {
    return (
      <FocusContext.Provider value={focusKey}>
        <div ref={ref} className="pane-menu">
          {candidates.length === 0 ? (
            <p className="pane-menu-empty">No sources available.</p>
          ) : (
            candidates.map((candidate, index) => (
              <SourceOptionRow
                key={`${candidate.channel.id}-${index}`}
                focusKey={`${sourcesFocusKey}-${index}`}
                candidate={candidate}
                active={index === activeSourceIndex}
                onSelect={() => {
                  onSelectSource(index)
                  setView('menu')
                }}
              />
            ))
          )}
        </div>
      </FocusContext.Provider>
    )
  }

  const audioLabel = !isAudioPane ? 'Use audio' : sessionMuted ? 'Unmute' : 'Mute'

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="pane-menu">
        {isMaximized ? (
          <MenuRow focusKey={`${paneId}-restore-grid`} label="Restore to grid" onSelect={onRestoreGrid} />
        ) : (
          <MenuRow focusKey={`${paneId}-fullscreen`} label="Make fullscreen" onSelect={onMakeFullscreen} />
        )}
        <MenuRow
          focusKey={`${paneId}-change-source`}
          label="Change source"
          onSelect={() => setView('sources')}
        />
        <MenuRow
          focusKey={`${paneId}-audio`}
          label={audioLabel}
          onSelect={isAudioPane ? onToggleSessionMute : onUseAudio}
        />
        {canGoLive && <MenuRow focusKey={`${paneId}-golive`} label="Go Live" onSelect={onGoLive} />}
        <MenuRow focusKey={`${paneId}-restart`} label="Restart" onSelect={onRestart} />
        <MenuRow focusKey={`${paneId}-replace`} label="Replace event" onSelect={onReplaceEvent} />
        <MenuRow focusKey={`${paneId}-remove`} label="Remove from Multiview" onSelect={onRemove} />
      </div>
    </FocusContext.Provider>
  )
}
