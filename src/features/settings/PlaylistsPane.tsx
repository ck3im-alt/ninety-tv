// "Where does my TV content come from?"
//
// Master/detail: the connected playlists on the left, the actions for
// whichever one is highlighted on the right. That shape is what keeps this
// on one screen no matter how many playlists exist — four action buttons per
// playlist rendered inline would be a scrolling document by the second
// playlist, which is exactly the failure mode this rebuild exists to fix.
import { useEffect, useMemo, useState } from 'react'
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useFocusRecovery } from '../../core/platform'
import { isResyncable, playlistSourceLabel, type PlaylistDefinition } from '../../data/playlists/playlistDefinition'
import { SettingsAction, SettingsColumnHeader, SettingsPaneHeader, SettingsRow } from './settingsPrimitives'
import { PANE_ENTRY_FOCUS_KEY } from './useSettingsFocusable'
import { formatLastSynced } from './formatLastSynced'
import type { PlaylistLibrary, PlaylistSyncStatus } from '../../data/playlists/usePlaylistLibrary'

const ADD_FOCUS_KEY = 'settings-playlists-add'
// The detail column's actions. Explicit keys, not the library's
// auto-generated ones: they are the destination of every "Left, back to the
// list" and they are what focus has to be able to SURVIVE ON (or be
// recovered from) when the playlist they act on is removed.
const ACTION_RENAME_FOCUS_KEY = 'settings-playlist-rename'
const ACTION_EDIT_FOCUS_KEY = 'settings-playlist-edit'
const ACTION_RESYNC_FOCUS_KEY = 'settings-playlist-resync'
const ACTION_REMOVE_FOCUS_KEY = 'settings-playlist-remove'
const ACTION_RESYNC_ALL_FOCUS_KEY = 'settings-playlist-resync-all'
const DETAIL_FOCUS_KEYS = new Set<string>([
  ACTION_RENAME_FOCUS_KEY,
  ACTION_EDIT_FOCUS_KEY,
  ACTION_RESYNC_FOCUS_KEY,
  ACTION_REMOVE_FOCUS_KEY,
  ACTION_RESYNC_ALL_FOCUS_KEY,
])
// Referentially stable, because useFocusRecovery takes it as a dependency.
const isDetailFocusKey = (focusKey: string) => DETAIL_FOCUS_KEYS.has(focusKey)

// The list and the "+ Add playlist" button below it are one vertical chain,
// stated rather than left to the library's geometric search: measured on a
// real 1920x1080 render, Down from the last playlist row resolved to the
// DETAIL column's second action instead of the Add button directly beneath
// it (the right column overlaps the list's vertical band far more than the
// short button does).
function rowFocusKey(playlistId: string, index: number): string {
  return index === 0 ? PANE_ENTRY_FOCUS_KEY : `settings-playlist-${playlistId}`
}

export type PlaylistDialogRequest =
  | { kind: 'add' }
  | { kind: 'rename'; playlist: PlaylistDefinition }
  | { kind: 'edit'; playlist: PlaylistDefinition }
  | { kind: 'remove'; playlist: PlaylistDefinition }

export function PlaylistsPane({
  library,
  onRequestDialog,
  onLeaveToRail,
}: {
  library: PlaylistLibrary
  onRequestDialog: (request: PlaylistDialogRequest) => void
  onLeaveToRail: () => void
}) {
  const { playlists } = library
  const [activeId, setActiveId] = useState<string | null>(playlists[0]?.id ?? null)

  // Keep the highlighted playlist valid as the library changes underneath —
  // removing the playlist whose actions are showing must not leave the
  // detail column pointing at something that no longer exists.
  useEffect(() => {
    if (playlists.length === 0) {
      setActiveId(null)
      return
    }
    setActiveId((current) => (current && playlists.some((p) => p.id === current) ? current : playlists[0].id))
  }, [playlists])

  const active = playlists.find((p) => p.id === activeId) ?? null
  const activeIndex = playlists.findIndex((p) => p.id === activeId)
  // The key the ACTIVE row is actually registered under — index 0 owns
  // PANE_ENTRY_FOCUS_KEY, so reconstructing `settings-playlist-${id}` from
  // the id alone is wrong for the first playlist and lands focus on a key
  // no component holds. Resolved once, here, and handed to the detail
  // column rather than rebuilt there.
  const activeRowFocusKey = activeIndex >= 0 ? rowFocusKey(playlists[activeIndex].id, activeIndex) : PANE_ENTRY_FOCUS_KEY
  const resyncableCount = playlists.filter((p) => isResyncable(p.source)).length

  // Removing a playlist unmounts its row, and — when it was the last one —
  // the whole detail column with it, taking whichever action confirmed the
  // removal down too. Both are recovered explicitly: a surviving row at the
  // same index, else the previous row, else the pane's own Add action.
  // Without this the library restores focus to the Settings screen root,
  // which re-resolves through the section rail.
  const rowEntries = useMemo(
    () => playlists.map((playlist, index) => ({ id: playlist.id, focusKey: rowFocusKey(playlist.id, index) })),
    [playlists],
  )
  useFocusRecovery({
    items: rowEntries,
    // PANE_ENTRY_FOCUS_KEY is the empty state's Add action once the list is
    // gone, and the Add button below the list while any playlist remains.
    anchorFocusKey: playlists.length === 0 ? PANE_ENTRY_FOCUS_KEY : ADD_FOCUS_KEY,
    dependentFocusKeys: isDetailFocusKey,
  })

  if (playlists.length === 0) {
    return (
      <>
        <SettingsPaneHeader title="Playlists" />
        <div className="settings-empty">
          <p className="settings-empty-title">No playlists connected</p>
          <p className="settings-empty-body">
            Add your TV provider and Ninety will organize its channels around the sports you follow. Fixtures and scores
            keep working without one.
          </p>
          <SettingsAction
            focusKey={PANE_ENTRY_FOCUS_KEY}
            label="Add playlist"
            tone="primary"
            onEnter={() => onRequestDialog({ kind: 'add' })}
            onLeft={onLeaveToRail}
          />
        </div>
      </>
    )
  }

  return (
    <>
      <SettingsPaneHeader title="Playlists" meta={`${playlists.length} connected`} />
      <div className="settings-columns playlists">
        <div className="settings-column">
          <div className="settings-list">
            {playlists.map((playlist, index) => (
              <SettingsRow
                // Entry-ness is part of the React key on purpose: the
                // spatial-navigation library captures a focusable's key at
                // REGISTRATION and ignores later changes, so removing the
                // first playlist would otherwise leave PANE_ENTRY_FOCUS_KEY
                // unclaimed and "Right from the rail" would focus nothing.
                // Including it here remounts whichever row is first.
                key={`${playlist.id}-${index === 0 ? 'entry' : 'row'}`}
                // The first row is the pane's entry point, so "Right from
                // the rail" always lands somewhere deterministic.
                focusKey={rowFocusKey(playlist.id, index)}
                label={playlist.name}
                sublabel={playlistSourceLabel(playlist.source)}
                value={<PlaylistStatus playlist={playlist} status={library.syncStatus(playlist.id)} />}
                selected={playlist.id === activeId}
                // Focus, not Enter, drives the detail column — the same
                // live-preview-on-focus pattern the channel browser and the
                // Channels filter already use, so arrowing down the list
                // shows each playlist's actions without committing to
                // anything.
                onFocus={() => setActiveId(playlist.id)}
                onEnter={() => void setFocus(ACTION_RENAME_FOCUS_KEY)}
                onLeft={onLeaveToRail}
                onRight={() => void setFocus(ACTION_RENAME_FOCUS_KEY)}
                onUp={index === 0 ? () => {} : () => void setFocus(rowFocusKey(playlists[index - 1].id, index - 1))}
                onDown={() =>
                  void setFocus(
                    index + 1 < playlists.length ? rowFocusKey(playlists[index + 1].id, index + 1) : ADD_FOCUS_KEY,
                  )
                }
              />
            ))}
          </div>
          <SettingsAction
            focusKey={ADD_FOCUS_KEY}
            label="+ Add playlist"
            onEnter={() => onRequestDialog({ kind: 'add' })}
            onLeft={onLeaveToRail}
            onRight={() => void setFocus(ACTION_RENAME_FOCUS_KEY)}
            onUp={() => void setFocus(rowFocusKey(playlists[playlists.length - 1].id, playlists.length - 1))}
            onDown={() => {}}
          />
        </div>

        <div className="settings-column detail">
          <SettingsColumnHeader title={active ? active.name : 'Playlist'} />
          {active && (
            <PlaylistActions
              library={library}
              playlist={active}
              activeRowFocusKey={activeRowFocusKey}
              resyncableCount={resyncableCount}
              onRequestDialog={onRequestDialog}
            />
          )}
        </div>
      </div>
    </>
  )
}

function PlaylistActions({
  library,
  playlist,
  activeRowFocusKey,
  resyncableCount,
  onRequestDialog,
}: {
  library: PlaylistLibrary
  playlist: PlaylistDefinition
  // Where this playlist's row lives in the list column. Passed in because
  // only the list knows it: the first row is registered under
  // PANE_ENTRY_FOCUS_KEY, not under a key derivable from the playlist id.
  activeRowFocusKey: string
  resyncableCount: number
  onRequestDialog: (request: PlaylistDialogRequest) => void
}) {
  const status = library.syncStatus(playlist.id)
  const syncing = status.kind === 'syncing'
  const resyncable = isResyncable(playlist.source)
  const backToList = () => void setFocus(activeRowFocusKey)

  return (
    <div className="settings-detail">
      <dl className="settings-facts">
        <div>
          <dt>Source</dt>
          <dd>{playlistSourceLabel(playlist.source)}</dd>
        </div>
        <div>
          <dt>Channels</dt>
          <dd>{playlist.channelCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Last synced</dt>
          <dd>{formatLastSynced(playlist.lastSyncedAt)}</dd>
        </div>
      </dl>

      <div className="settings-detail-actions">
        <SettingsAction focusKey={ACTION_RENAME_FOCUS_KEY} label="Rename" onEnter={() => onRequestDialog({ kind: 'rename', playlist })} onLeft={backToList} />
        <SettingsAction
          focusKey={ACTION_EDIT_FOCUS_KEY}
          label={resyncable ? 'Edit connection' : 'Replace file'}
          onEnter={() => onRequestDialog({ kind: 'edit', playlist })}
          onLeft={backToList}
        />
        {resyncable ? (
          <SettingsAction
            focusKey={ACTION_RESYNC_FOCUS_KEY}
            // Neither unmounted NOR made unfocusable while syncing — only
            // its label changes, and Enter is inert until the sync finishes.
            // An async status change must never pull the focused control out
            // from under the user: focus would have nowhere to fall back to
            // and the remote would appear to stop working mid-sync.
            label={syncing ? 'Syncing…' : 'Resync now'}
            onEnter={() => {
              if (!syncing) void library.resyncPlaylist(playlist.id)
            }}
            onLeft={backToList}
          />
        ) : (
          <p className="settings-detail-note">
            This playlist came from a file. Ninety doesn't keep the file itself, so it can't refresh on its own — choose
            the file again to update it.
          </p>
        )}
        <SettingsAction
          focusKey={ACTION_REMOVE_FOCUS_KEY}
          label="Remove"
          tone="danger"
          onEnter={() => onRequestDialog({ kind: 'remove', playlist })}
          onLeft={backToList}
        />
        {resyncableCount > 1 && (
          <SettingsAction focusKey={ACTION_RESYNC_ALL_FOCUS_KEY} label="Resync all" onEnter={() => void library.resyncAll()} onLeft={backToList} />
        )}
      </div>

      {status.kind === 'error' && (
        <p className="settings-status error" role="status">
          {status.message}
        </p>
      )}
      {/* A refreshed playlist that is fetched and validated but deliberately
          held back because a stream is playing (see usePlaylistLibrary's
          playback gate). Worth saying out loud: without it, a viewer who
          pressed nothing and saw nothing change would have no way to tell
          "already up to date" from "waiting for you to stop watching". */}
      {status.kind === 'pending-install' && (
        <p className="settings-status" role="status">
          An updated channel list is ready and will be applied when playback ends.
        </p>
      )}
    </div>
  )
}

function PlaylistStatus({ playlist, status }: { playlist: PlaylistDefinition; status: PlaylistSyncStatus }) {
  if (status.kind === 'syncing') return <span className="settings-badge">Syncing…</span>
  if (status.kind === 'error') return <span className="settings-badge error">Sync failed</span>
  if (status.kind === 'pending-install') return <span className="settings-badge">Update ready</span>
  return (
    <span className="settings-row-value-stack">
      <span>{playlist.channelCount.toLocaleString()} channels</span>
      <span className="settings-row-value-meta">{formatLastSynced(playlist.lastSyncedAt)}</span>
    </span>
  )
}
