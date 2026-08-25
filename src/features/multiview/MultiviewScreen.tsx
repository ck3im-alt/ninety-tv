// Multiview's top-level screen — owns the grid<->maximized view toggle, the
// session's shared network-fallback serial queue, and the "+ Add event" /
// "Replace event" picker. Deliberately NOT where player instances live —
// those exist only inside each mounted MultiviewPane's own usePlayerSession
// call; this screen only ever touches the plain, serializable
// MultiviewSession data (see multiviewSession.ts).
import { useMemo, useState } from 'react'
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler } from '../../core/platform'
import { createSerialQueue } from '../../core/async/serialQueue'
import { loadPreferences } from '../../data/preferences'
import { useMultiviewPaneResolution } from './useMultiviewPaneResolution'
import { MultiviewPane } from './MultiviewPane'
import { AddEventSlot } from './AddEventSlot'
import { EventPicker } from './EventPicker'
import { multiviewLayoutFor } from './multiviewLayout'
import {
  MAX_MULTIVIEW_STREAMS,
  addPane,
  removePane,
  replacePaneAssignment,
  rerankPaneForActiveCount,
  selectPaneSource,
  setAudioPane,
  setFocusedPane,
  setMaximizedPane,
  setMuted,
  updatePaneCandidates,
} from './multiviewSession'
import type { MultiviewSession } from './multiviewSession'
import type { MultiviewSourceCandidate } from './multiviewCandidates'
import type { StreamRankingPreferences } from '../eventDetails/buildEventStreamOptions'
import type { HomeFeed } from '../../data/sports/useHomeFeed'
import type { Channel } from '../../data/channel'
import type { SportEvent } from '../../data/sports/types'
import type { XtreamCredentialResolver } from '../../data/playlists/xtreamResolver'
import type { ChannelIdentityIndex } from '../../data/sports/channelIdentityIndex'
import './MultiviewScreen.css'

const GRID_FOCUS_KEY = 'multiview-screen'

interface Props {
  session: MultiviewSession
  onSessionChange: (updater: (session: MultiviewSession) => MultiviewSession) => void
  channels: Channel[]
  xtream: XtreamCredentialResolver
  identityIndex: ChannelIdentityIndex | null
  favoriteChannels: ReadonlySet<string>
  favoriteChannelsList: Channel[]
  recentChannelsList: Channel[]
  homeFeed: HomeFeed
  onBack: () => void
}

type PickerState = { kind: 'add' } | { kind: 'replace'; paneId: string } | null

// Renderless — its only job is running useMultiviewPaneResolution for one
// pane, independent of whether that pane's VIDEO subtree is currently
// mounted (grid) or suspended (a sibling is maximized) — see
// MultiviewPane's own header for why resolution must not be redone just
// because of a maximize/un-maximize toggle.
function PaneResolver({
  pane,
  channels,
  xtream,
  identityIndex,
  favoriteChannels,
  rankingPreferences,
  networkFallbackQueue,
  onResolved,
}: {
  pane: MultiviewSession['panes'][number]
  channels: Channel[]
  xtream: XtreamCredentialResolver
  identityIndex: ChannelIdentityIndex | null
  favoriteChannels: ReadonlySet<string>
  rankingPreferences: StreamRankingPreferences
  networkFallbackQueue: ReturnType<typeof createSerialQueue>
  onResolved: (paneId: string, candidates: MultiviewSourceCandidate[], resolution: 'ready' | 'not-found') => void
}) {
  useMultiviewPaneResolution(pane, channels, xtream, identityIndex, favoriteChannels, rankingPreferences, networkFallbackQueue, onResolved)
  return null
}

export function MultiviewScreen({
  session,
  onSessionChange,
  channels,
  xtream,
  identityIndex,
  favoriteChannels,
  favoriteChannelsList,
  recentChannelsList,
  homeFeed,
  onBack,
}: Props) {
  const { favoriteCountries, streamType } = loadPreferences()
  const networkFallbackQueue = useMemo(() => createSerialQueue(), [])
  const [picker, setPicker] = useState<PickerState>(null)

  const orderedPanes = useMemo(() => [...session.panes].sort((a, b) => a.id.localeCompare(b.id)), [session.panes])
  const canAddMore = session.panes.length < MAX_MULTIVIEW_STREAMS
  const totalCells = canAddMore ? session.panes.length + 1 : session.panes.length
  const layout = multiviewLayoutFor(totalCells)
  const maximizedPane = session.maximizedPaneId != null ? session.panes.find((p) => p.id === session.maximizedPaneId) : undefined

  function maximizePane(paneId: string) {
    onSessionChange((prev) => rerankPaneForActiveCount(setMaximizedPane(prev, paneId), paneId, 1))
  }

  function restoreGrid() {
    onSessionChange((prev) => {
      if (!prev.maximizedPaneId) return prev
      const maximizedId = prev.maximizedPaneId
      const cleared = setMaximizedPane(prev, null)
      return rerankPaneForActiveCount(cleared, maximizedId, cleared.panes.length)
    })
  }

  useBackHandler(() => {
    if (session.maximizedPaneId) {
      restoreGrid()
      return true
    }
    onBack()
    return true
  })

  const { ref, focusKey } = useFocusable({
    focusKey: GRID_FOCUS_KEY,
    trackChildren: true,
    isFocusBoundary: true,
    preferredChildFocusKey: orderedPanes[0]?.id,
  })

  function handlePickEvent(event: SportEvent) {
    if (picker?.kind === 'replace') {
      const paneId = picker.paneId
      onSessionChange((prev) => replacePaneAssignment(prev, paneId, { kind: 'event', event }))
    } else {
      onSessionChange((prev) => addPane(prev, { kind: 'event', event }))
    }
    setPicker(null)
  }

  function handlePickChannel(channel: Channel) {
    if (picker?.kind === 'replace') {
      const paneId = picker.paneId
      onSessionChange((prev) => replacePaneAssignment(prev, paneId, { kind: 'channel', channel }))
    } else {
      onSessionChange((prev) => addPane(prev, { kind: 'channel', channel }))
    }
    setPicker(null)
  }

  const panesView = (
    <>
      {session.panes.map((pane) => (
        <PaneResolver
          key={pane.assignmentId}
          pane={pane}
          channels={channels}
          xtream={xtream}
          identityIndex={identityIndex}
          favoriteChannels={favoriteChannels}
          rankingPreferences={{ favoriteCountries, streamType }}
          networkFallbackQueue={networkFallbackQueue}
          onResolved={(paneId, candidates, resolution) =>
            onSessionChange((prev) => updatePaneCandidates(prev, paneId, candidates, resolution))
          }
        />
      ))}
    </>
  )

  if (maximizedPane) {
    return (
      <main className="multiview-screen multiview-screen-maximized">
        {panesView}
        <FocusContext.Provider value={focusKey}>
          <div ref={ref} className="multiview-maximized">
            <MultiviewPane
              key={maximizedPane.assignmentId}
              pane={maximizedPane}
              isMaximized
              isAudioPane={maximizedPane.id === session.audioPaneId}
              sessionMuted={session.muted}
              forceFocus
              activePaneCount={1}
              onFocusPane={() => onSessionChange((prev) => setFocusedPane(prev, maximizedPane.id))}
              onMakeFullscreen={() => {}}
              onRestoreGrid={restoreGrid}
              onSelectSource={(index) => onSessionChange((prev) => selectPaneSource(prev, maximizedPane.id, index))}
              onUseAudio={() => onSessionChange((prev) => setAudioPane(prev, maximizedPane.id))}
              onToggleSessionMute={() => onSessionChange((prev) => setMuted(prev, !prev.muted))}
              onReplaceEvent={() => setPicker({ kind: 'replace', paneId: maximizedPane.id })}
              onRemove={() =>
                // Clears maximize and removes the pane in one step — no
                // need to rerank a pane that's about to be deleted (unlike
                // restoreGrid's normal un-maximize path).
                onSessionChange((prev) => removePane(setMaximizedPane(prev, null), maximizedPane.id))
              }
            />
          </div>
        </FocusContext.Provider>
        {picker && (
          <EventPicker
            feed={homeFeed}
            favoriteChannels={favoriteChannelsList}
            recentChannels={recentChannelsList}
            onSelectEvent={handlePickEvent}
            onSelectChannel={handlePickChannel}
            onClose={() => setPicker(null)}
          />
        )}
      </main>
    )
  }

  return (
    <main className="multiview-screen">
      {panesView}
      <FocusContext.Provider value={focusKey}>
        <div ref={ref} className="multiview-grid" data-layout={layout}>
          {orderedPanes.map((pane, index) => (
            <MultiviewPane
              key={pane.assignmentId}
              pane={pane}
              isMaximized={false}
              isAudioPane={pane.id === session.audioPaneId}
              sessionMuted={session.muted}
              forceFocus={index === 0}
              activePaneCount={orderedPanes.length}
              onFocusPane={() => onSessionChange((prev) => setFocusedPane(prev, pane.id))}
              onMakeFullscreen={() => maximizePane(pane.id)}
              onRestoreGrid={restoreGrid}
              onSelectSource={(sourceIndex) => onSessionChange((prev) => selectPaneSource(prev, pane.id, sourceIndex))}
              onUseAudio={() => onSessionChange((prev) => setAudioPane(prev, pane.id))}
              onToggleSessionMute={() => onSessionChange((prev) => setMuted(prev, !prev.muted))}
              onReplaceEvent={() => setPicker({ kind: 'replace', paneId: pane.id })}
              onRemove={() => onSessionChange((prev) => removePane(prev, pane.id))}
            />
          ))}
          {canAddMore && (
            <AddEventSlot
              focusKey="multiview-add-slot"
              forceFocus={orderedPanes.length === 0}
              onSelect={() => setPicker({ kind: 'add' })}
            />
          )}
        </div>
      </FocusContext.Provider>
      {picker && (
        <EventPicker
          feed={homeFeed}
          favoriteChannels={favoriteChannelsList}
          recentChannels={recentChannelsList}
          onSelectEvent={handlePickEvent}
          onSelectChannel={handlePickChannel}
          onClose={() => setPicker(null)}
        />
      )}
    </main>
  )
}
