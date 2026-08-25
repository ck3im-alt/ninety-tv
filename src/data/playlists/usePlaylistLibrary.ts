// React binding over playlistLibrary.ts — owns the connected playlists and
// the combined channel set for the whole app, and is the only place that
// mutates either.
//
// Replaces App.tsx's former `playlist` state (channels + one source + one
// generationId) plus its hydrate/persist effects. Everything App used to do
// inline lives here now, unchanged in spirit:
//   - hydration never blocks first paint
//   - the ChannelIndex is pre-warmed OFF the render that installs new
//     channels, so a ~30,000-channel index build never lands on the same
//     main-thread task as a screen transition
//   - playlists/channels/generationId are always installed together, so no
//     consumer can observe a torn combination
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { warmChannelIndexAsync } from '../channelIndex'
import { markPerf, measurePerf } from '../../core/perf/devPerf'
import { EmptyPlaylistError } from './connectPlaylist'
import { combinePlaylistChannels, type LoadedPlaylistChannels } from './combinePlaylistChannels'
import {
  commitPlaylistChannels,
  deletePlaylistChannels,
  hydratePlaylistLibrary,
  persistLibrary,
  syncPlaylist,
} from './playlistLibrary'
import {
  combinedGenerationId,
  defaultPlaylistName,
  isResyncable,
  newPlaylistId,
  type PlaylistDefinition,
} from './playlistDefinition'
import { findReconnectTarget } from './reconnectTarget'
import { createXtreamCredentialResolver, NO_XTREAM_CREDENTIALS, type XtreamCredentialResolver } from './xtreamResolver'
import type { Channel } from '../channel'
import type { PlaylistSourceRecord } from '../session'

export type PlaylistSyncStatus =
  | { kind: 'idle' }
  | { kind: 'syncing' }
  | { kind: 'synced'; at: number }
  | { kind: 'error'; message: string }

const IDLE: PlaylistSyncStatus = { kind: 'idle' }

interface LibraryState {
  playlists: PlaylistDefinition[]
  loaded: LoadedPlaylistChannels[]
  // Combined, cross-playlist channel list — the array every existing
  // consumer already takes. Held in state (not derived per render) so its
  // reference identity is stable, which is what getChannelIndex's WeakMap
  // and useChannelIdentityIndex both key off.
  channels: Channel[]
  generationId: string | null
}

const EMPTY_STATE: LibraryState = { playlists: [], loaded: [], channels: [], generationId: null }

export interface PlaylistLibrary {
  playlists: PlaylistDefinition[]
  channels: Channel[]
  generationId: string | null
  xtream: XtreamCredentialResolver
  hydration: 'pending' | 'done'
  syncStatus: (playlistId: string) => PlaylistSyncStatus
  // Plain-language problem the user may need to know about (a cache that
  // couldn't be written, an auto-reconnect that failed). Cleared on the next
  // success or when dismissed.
  notice: string | null
  dismissNotice: () => void
  // Set when a file playlist's cache is gone and only the user can fix it.
  reconnectNotice: string | null
  addPlaylist: (source: PlaylistSourceRecord, channels: Channel[]) => Promise<PlaylistDefinition>
  // What every "the user just connected a playlist" surface should call.
  // Adds a new playlist, EXCEPT when the connected source is the file a
  // playlist is currently waiting for — see reconnectTarget.ts — in which
  // case it restores that playlist in place instead of creating a duplicate
  // beside the broken one.
  addOrReconnectPlaylist: (source: PlaylistSourceRecord, channels: Channel[]) => Promise<void>
  renamePlaylist: (playlistId: string, name: string) => void
  // Atomic connection edit: the caller has ALREADY fetched and validated
  // the replacement, so by the time this runs there is nothing left that
  // can fail in a way that would lose the old playlist.
  replaceConnection: (playlistId: string, source: PlaylistSourceRecord, channels: Channel[]) => Promise<void>
  resyncPlaylist: (playlistId: string) => Promise<void>
  resyncAll: () => Promise<void>
  removePlaylist: (playlistId: string) => Promise<void>
}

export function usePlaylistLibrary(): PlaylistLibrary {
  const [state, setState] = useState<LibraryState>(EMPTY_STATE)
  const [hydration, setHydration] = useState<'pending' | 'done'>('pending')
  const [syncStatuses, setSyncStatuses] = useState<Record<string, PlaylistSyncStatus>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [reconnectNotice, setReconnectNotice] = useState<string | null>(null)
  // File playlists whose cached channels are gone, so only the user handing
  // the file back can restore them. Held in a ref rather than state: nothing
  // renders from it — it exists purely so addOrReconnectPlaylist can tell a
  // reconnect from a genuine add.
  const awaitingReconnectRef = useRef<PlaylistDefinition[]>([])
  // Guards every async completion against a hook that has since unmounted
  // (dev StrictMode remounts included) so nothing sets state on a dead tree.
  const aliveRef = useRef(true)
  // Always the freshest playlists/loaded pair, readable from inside an async
  // operation without capturing a stale render's closure — several
  // operations (a resync finishing after the user renamed the same
  // playlist) genuinely interleave.
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Installs playlists + their loaded channels as one atomic unit,
  // pre-warming the ChannelIndex first (off the render that will consume
  // it) exactly as App.tsx's hydration path used to.
  const install = useCallback(async (playlists: PlaylistDefinition[], loaded: LoadedPlaylistChannels[]) => {
    const channels = combinePlaylistChannels(loaded)
    const loadedIds = new Set(loaded.map((l) => l.playlistId))
    const generationId = combinedGenerationId(playlists.filter((p) => loadedIds.has(p.id)))
    await warmChannelIndexAsync(channels)
    if (!aliveRef.current) return
    setState({ playlists, loaded, channels, generationId })
  }, [])

  // Metadata-only update (rename, sync timestamps). Deliberately does NOT
  // recombine channels: with two playlists connected, recombining allocates
  // a fresh ~50,000-entry array and invalidates the warmed ChannelIndex —
  // absurd for renaming a playlist.
  const updateDefinitions = useCallback((update: (playlists: PlaylistDefinition[]) => PlaylistDefinition[]) => {
    setState((prev) => {
      const playlists = update(prev.playlists)
      persistLibrary(playlists)
      const loadedIds = new Set(prev.loaded.map((l) => l.playlistId))
      return { ...prev, playlists, generationId: combinedGenerationId(playlists.filter((p) => loadedIds.has(p.id))) }
    })
  }, [])

  const setStatus = useCallback((playlistId: string, status: PlaylistSyncStatus) => {
    setSyncStatuses((prev) => ({ ...prev, [playlistId]: status }))
  }, [])

  // Startup: migrate (once), load every playlist's cached channels, then
  // rebuild in the background whichever playlists have a refetchable source
  // but no usable cache. Never blocks first paint — Home's own data comes
  // from ninety-api, not from the playlist.
  useEffect(() => {
    let cancelled = false
    markPerf('playlist:hydrate-start')
    void hydratePlaylistLibrary().then(async (result) => {
      markPerf('playlist:hydrate-end')
      measurePerf('playlist:hydrate', 'playlist:hydrate-start', 'playlist:hydrate-end')
      if (cancelled) return
      await install(result.playlists, result.loaded)
      if (cancelled) return
      setHydration('done')

      if (result.unrecoverableFiles.length > 0) {
        awaitingReconnectRef.current = result.unrecoverableFiles
        const names = result.unrecoverableFiles.map((p) => `"${p.name}"`).join(', ')
        setReconnectNotice(`Ninety needs the playlist file again to reconnect ${names} — please add it again below.`)
      }

      // Sequential, not parallel: each recovery downloads and merges a full
      // playlist, and doing several at once on a low-powered TV competes
      // for the same main thread the UI is using.
      for (const playlist of result.needsRecovery) {
        if (cancelled) return
        await recoverOne(playlist)
      }
    })

    async function recoverOne(playlist: PlaylistDefinition) {
      setStatus(playlist.id, { kind: 'syncing' })
      try {
        const synced = await syncPlaylist(playlist)
        if (cancelled || !aliveRef.current) return
        const current = stateRef.current
        const playlists = current.playlists.map((p) => (p.id === playlist.id ? { ...synced.playlist, name: p.name } : p))
        persistLibrary(playlists)
        await install(playlists, [
          ...current.loaded.filter((l) => l.playlistId !== playlist.id),
          { playlistId: playlist.id, channels: synced.channels },
        ])
        if (cancelled) return
        setStatus(playlist.id, { kind: 'synced', at: Date.now() })
      } catch (err) {
        console.error(`[playlists] Automatic recovery failed for "${playlist.name}".`, err)
        if (cancelled || !aliveRef.current) return
        setStatus(playlist.id, { kind: 'error', message: syncErrorMessage(err) })
        setNotice(`Ninety couldn't reconnect "${playlist.name}". Open Settings to try again.`)
      }
    }

    return () => {
      cancelled = true
    }
  }, [install, setStatus])

  const addPlaylist = useCallback(
    async (source: PlaylistSourceRecord, channels: Channel[]) => {
      const definition: PlaylistDefinition = {
        id: newPlaylistId(),
        name: defaultPlaylistName(
          source,
          stateRef.current.playlists.map((p) => p.name),
        ),
        source,
        createdAt: Date.now(),
        lastSyncedAt: null,
        // Replaced by commitPlaylistChannels below, which is what actually
        // stamps a generation once the channels are written.
        generationId: '',
        channelCount: channels.length,
      }
      const { playlist, channels: stamped } = await commitPlaylistChannels(definition, source, channels)
      if (!aliveRef.current) return playlist
      // Re-read AFTER the write: adding a playlist takes long enough for a
      // concurrent resync of another playlist to have landed, and appending
      // to a stale snapshot would silently drop it.
      const current = stateRef.current
      const playlists = [...current.playlists, playlist]
      persistLibrary(playlists)
      await install(playlists, [...current.loaded, { playlistId: playlist.id, channels: stamped }])
      setStatus(playlist.id, { kind: 'synced', at: Date.now() })
      setReconnectNotice(null)
      return playlist
    },
    [install, setStatus],
  )

  const renamePlaylist = useCallback(
    (playlistId: string, name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      updateDefinitions((playlists) => playlists.map((p) => (p.id === playlistId ? { ...p, name: trimmed } : p)))
    },
    [updateDefinitions],
  )

  const replaceConnection = useCallback(
    async (playlistId: string, source: PlaylistSourceRecord, channels: Channel[]) => {
      const existing = stateRef.current.playlists.find((p) => p.id === playlistId)
      if (!existing) return
      // Reuses the SAME playlist id, so favorites, recently-watched and
      // every stamped source that already points at this playlist stay
      // valid across a connection change.
      const { playlist, channels: stamped } = await commitPlaylistChannels(existing, source, channels)
      if (!aliveRef.current) return
      const current = stateRef.current
      const playlists = current.playlists.map((p) => (p.id === playlistId ? playlist : p))
      persistLibrary(playlists)
      await install(playlists, [
        ...current.loaded.filter((l) => l.playlistId !== playlistId),
        { playlistId, channels: stamped },
      ])
      awaitingReconnectRef.current = awaitingReconnectRef.current.filter((p) => p.id !== playlistId)
      setStatus(playlistId, { kind: 'synced', at: Date.now() })
      setReconnectNotice(null)
    },
    [install, setStatus],
  )

  // The entry point every "the user just connected a playlist" surface uses
  // (App's standalone setup screen, onboarding's step 1). Routes to
  // replaceConnection when this is the file an existing playlist is waiting
  // for — see reconnectTarget.ts — and otherwise adds normally.
  const addOrReconnectPlaylist = useCallback(
    async (source: PlaylistSourceRecord, channels: Channel[]) => {
      const target = findReconnectTarget(source, awaitingReconnectRef.current)
      if (target) {
        await replaceConnection(target.id, source, channels)
        return
      }
      await addPlaylist(source, channels)
    },
    [addPlaylist, replaceConnection],
  )

  const resyncPlaylist = useCallback(
    async (playlistId: string) => {
      const playlist = stateRef.current.playlists.find((p) => p.id === playlistId)
      if (!playlist || !isResyncable(playlist.source)) return
      setStatus(playlistId, { kind: 'syncing' })
      try {
        const synced = await syncPlaylist(playlist)
        if (!aliveRef.current) return
        const current = stateRef.current
        // Re-read the definition rather than reusing the captured one: the
        // user may have renamed this playlist while the fetch was in
        // flight, and a sync must never silently revert an edit.
        const latest = current.playlists.find((p) => p.id === playlistId)
        const merged = { ...synced.playlist, name: latest?.name ?? synced.playlist.name }
        const playlists = current.playlists.map((p) => (p.id === playlistId ? merged : p))
        persistLibrary(playlists)
        await install(playlists, [
          ...current.loaded.filter((l) => l.playlistId !== playlistId),
          { playlistId, channels: synced.channels },
        ])
        if (!aliveRef.current) return
        setStatus(playlistId, { kind: 'synced', at: Date.now() })
      } catch (err) {
        console.error(`[playlists] Resync failed for "${playlist.name}".`, err)
        if (!aliveRef.current) return
        // Nothing was cleared before the fetch, so the previous channels,
        // the cached record and the saved credentials are all still exactly
        // as they were.
        setStatus(playlistId, { kind: 'error', message: syncErrorMessage(err) })
      }
    },
    [install, setStatus],
  )

  const resyncAll = useCallback(async () => {
    const ids = stateRef.current.playlists.filter((p) => isResyncable(p.source)).map((p) => p.id)
    for (const id of ids) await resyncPlaylist(id)
  }, [resyncPlaylist])

  const removePlaylist = useCallback(
    async (playlistId: string) => {
      await deletePlaylistChannels(playlistId)
      if (!aliveRef.current) return
      const current = stateRef.current
      const playlists = current.playlists.filter((p) => p.id !== playlistId)
      persistLibrary(playlists)
      // Rebuilt from the REMAINING playlists rather than by subtracting
      // sources from the combined list: a channel both playlists carried
      // has to keep the other playlist's stream, and rebuilding is the only
      // way that stays exactly consistent with a fresh launch.
      await install(
        playlists,
        current.loaded.filter((l) => l.playlistId !== playlistId),
      )
      awaitingReconnectRef.current = awaitingReconnectRef.current.filter((p) => p.id !== playlistId)
      setSyncStatuses((prev) => {
        const next = { ...prev }
        delete next[playlistId]
        return next
      })
    },
    [install],
  )

  const xtream = useMemo(
    () => (state.playlists.length === 0 ? NO_XTREAM_CREDENTIALS : createXtreamCredentialResolver(state.playlists)),
    [state.playlists],
  )

  const syncStatus = useCallback((playlistId: string) => syncStatuses[playlistId] ?? IDLE, [syncStatuses])
  const dismissNotice = useCallback(() => setNotice(null), [])

  return {
    playlists: state.playlists,
    channels: state.channels,
    generationId: state.generationId,
    xtream,
    hydration,
    syncStatus,
    notice,
    dismissNotice,
    reconnectNotice,
    addPlaylist,
    addOrReconnectPlaylist,
    renamePlaylist,
    replaceConnection,
    resyncPlaylist,
    resyncAll,
    removePlaylist,
  }
}

// Consumer-facing, never a raw stack or a URL with credentials in it.
// Module-local: the message reaches the UI through PlaylistSyncStatus, so
// nothing outside this hook has any reason to format one.
function syncErrorMessage(err: unknown): string {
  if (err instanceof EmptyPlaylistError) return 'That playlist has no channels — nothing was changed.'
  return "Couldn't sync — existing playlist kept."
}
