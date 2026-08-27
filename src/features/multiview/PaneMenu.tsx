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

// The "Change source" sub-view, as its own component.
//
// It is a separate component rather than a branch inside PaneMenu because
// useModalFocusScope's focusKey identifies a spatial-navigation CONTAINER,
// and norigin registers a container in a mount-only effect (addFocusable
// runs with a `[]` dependency list). Swapping the focusKey PROP on one
// mounted component therefore left the container registered under the old
// key, updateFocusable(newKey, ...) found nothing to update, and the
// scope's own setFocus(newKey) parked spatial focus on a key with no
// component behind it: opening "Change source" showed a list with NO
// focused row where OK did nothing and only Back got you out. Two views,
// two mounts, two registrations. Same reason ChannelPlayerScreen's
// VariantPopup/SubtitlesPopup are separate components.
function PaneSourceMenu({
  sourcesFocusKey,
  candidates,
  activeSourceIndex,
  onSelectSource,
  onBackToMenu,
}: {
  sourcesFocusKey: string
  candidates: MultiviewSourceCandidate[]
  activeSourceIndex: number
  onSelectSource: (index: number) => void
  onBackToMenu: () => void
}) {
  const { ref, focusKey } = useModalFocusScope({
    focusKey: sourcesFocusKey,
    onClose: onBackToMenu,
    preferredChildFocusKey: `${sourcesFocusKey}-${activeSourceIndex}`,
  })
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
                onBackToMenu()
              }}
            />
          ))
        )}
      </div>
    </FocusContext.Provider>
  )
}

function PaneActionMenu({
  paneId,
  menuFocusKey,
  isMaximized,
  isAudioPane,
  sessionMuted,
  canGoLive,
  onMakeFullscreen,
  onRestoreGrid,
  onOpenSources,
  onUseAudio,
  onToggleSessionMute,
  onReplaceEvent,
  onRemove,
  onRestart,
  onGoLive,
  onClose,
}: {
  paneId: string
  menuFocusKey: string
  isMaximized: boolean
  isAudioPane: boolean
  sessionMuted: boolean
  canGoLive: boolean
  onMakeFullscreen: () => void
  onRestoreGrid: () => void
  onOpenSources: () => void
  onUseAudio: () => void
  onToggleSessionMute: () => void
  onReplaceEvent: () => void
  onRemove: () => void
  onRestart: () => void
  onGoLive: () => void
  onClose: () => void
}) {
  const { ref, focusKey } = useModalFocusScope({
    focusKey: menuFocusKey,
    onClose,
    preferredChildFocusKey: isMaximized ? `${paneId}-restore-grid` : `${paneId}-fullscreen`,
  })
  const audioLabel = !isAudioPane ? 'Use audio' : sessionMuted ? 'Unmute' : 'Mute'
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="pane-menu">
        {isMaximized ? (
          <MenuRow focusKey={`${paneId}-restore-grid`} label="Restore to grid" onSelect={onRestoreGrid} />
        ) : (
          <MenuRow focusKey={`${paneId}-fullscreen`} label="Make fullscreen" onSelect={onMakeFullscreen} />
        )}
        <MenuRow focusKey={`${paneId}-change-source`} label="Change source" onSelect={onOpenSources} />
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

  // Back in the sources sub-view returns to the main menu; Back in the main
  // menu closes it. Each view owns that meaning through its own
  // useModalFocusScope, and exactly one of them is mounted at a time, so the
  // Back stack never has to disambiguate between them.
  if (view === 'sources') {
    return (
      <PaneSourceMenu
        sourcesFocusKey={`${paneId}-menu-sources`}
        candidates={candidates}
        activeSourceIndex={activeSourceIndex}
        onSelectSource={onSelectSource}
        onBackToMenu={() => setView('menu')}
      />
    )
  }

  return (
    <PaneActionMenu
      paneId={paneId}
      menuFocusKey={`${paneId}-menu`}
      isMaximized={isMaximized}
      isAudioPane={isAudioPane}
      sessionMuted={sessionMuted}
      canGoLive={canGoLive}
      onMakeFullscreen={onMakeFullscreen}
      onRestoreGrid={onRestoreGrid}
      onOpenSources={() => setView('sources')}
      onUseAudio={onUseAudio}
      onToggleSessionMute={onToggleSessionMute}
      onReplaceEvent={onReplaceEvent}
      onRemove={onRemove}
      onRestart={onRestart}
      onGoLive={onGoLive}
      onClose={onClose}
    />
  )
}
