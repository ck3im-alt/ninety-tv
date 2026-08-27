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
import { isRequestTimeout } from '../../core/net/fetchWithTimeout'
import { combinePlaylistChannels, type LoadedPlaylistChannels } from './combinePlaylistChannels'
import {
  commitPlaylistChannels,
  deletePlaylistChannels,
  fetchPlaylistGeneration,
  hydratePlaylistLibrary,
  installPreparedChannels,
  persistLibrary,
  syncPlaylist,
  type PreparedPlaylistChannels,
} from './playlistLibrary'
import {
  FRESH_SYNC_RECORD,
  PLAYLIST_SYNC_TICK_MS,
  PREPARE_DURING_PLAYBACK,
  jitterFor,
  recordFailure,
  recordSuccess,
  shouldSync,
  validateGeneration,
  type PlaylistSyncRecord,
  type PlaylistSyncTrigger,
} from './playlistSyncPolicy'
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
  // Fetched, validated and ready — deliberately NOT installed yet, because
  // a stream is playing and installing a generation is the one step that
  // touches the live React tree. Clears itself the moment playback ends.
  // See the coordinator's playback gate below.
  | { kind: 'pending-install'; at: number }
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

// One playlist's scheduling state inside the coordinator. `inFlight` is the
// no-overlap guard: every trigger routes through the same promise, so a
// resume landing in the middle of a periodic sync joins it rather than
// starting a second download of the same 5 MB playlist.
interface SyncRuntime {
  record: PlaylistSyncRecord
  // Per-playlist offset applied to its due time, re-rolled after every
  // attempt — see PLAYLIST_REFRESH_JITTER_MS.
  jitterMs: number
  inFlight: Promise<void> | null
  // Set when a MANUAL sync is running, or when a manual request adopted an
  // automatic sync that was already in flight. Makes that sync's result
  // install even if playback is active: a person standing in Settings
  // pressing Resync is not a background refresh.
  forceInstall: boolean
}

// Distinguishes "the provider said no" from "the provider said something we
// refuse to install". Both keep the previous generation; only this one is
// worth wording differently, because a viewer seeing it has a working
// playlist and a provider that returned something implausible.
class UnsafeGenerationError extends Error {
  readonly reason: 'empty' | 'collapsed'
  constructor(reason: 'empty' | 'collapsed') {
    super(reason === 'empty' ? 'Provider returned no channels' : 'Provider returned far fewer channels than before')
    this.name = 'UnsafeGenerationError'
    this.reason = reason
  }
}

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
  // THE PLAYBACK GATE. App calls this whenever it enters or leaves a screen
  // that owns live video (the Player, Multiview). While it is true, a
  // freshly fetched generation is prepared and held rather than installed;
  // the false edge installs everything held and then immediately checks
  // staleness, which is what makes "leave a two-hour match, find the new PPV
  // channels already there" work without an app restart.
  //
  // Stable identity, and it writes to a ref rather than state on purpose:
  // telling the library that playback started must not re-render every
  // consumer of the library — including the player that just started.
  setPlaybackActive: (active: boolean) => void
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

  // ---------------------------------------------------------------------
  // Synchronization coordinator state. All refs, never React state: these
  // drive scheduling decisions, and a scheduler that re-rendered the app
  // every time it thought about syncing would be its own performance
  // problem. Everything the UI needs to SEE goes through syncStatuses.
  // ---------------------------------------------------------------------

  // True while a Player or Multiview session owns live video. See
  // setPlaybackActive.
  const playbackActiveRef = useRef(false)
  // Per-playlist scheduling state: when it last succeeded/attempted, how
  // many consecutive failures (backoff), its own jitter offset, and the
  // in-flight promise that makes overlapping syncs impossible.
  const syncRuntimeRef = useRef(new Map<string, SyncRuntime>())
  // Generations that are fetched, validated and ready but deliberately not
  // installed because playback is active. At most one per playlist — a
  // newer prepare replaces an older pending one rather than queueing, so a
  // two-hour match cannot accumulate twelve 30,000-channel arrays.
  const pendingRef = useRef(new Map<string, PreparedPlaylistChannels>())

  function syncRuntime(playlistId: string): SyncRuntime {
    let runtime = syncRuntimeRef.current.get(playlistId)
    if (!runtime) {
      runtime = { record: FRESH_SYNC_RECORD, jitterMs: jitterFor(), inFlight: null, forceInstall: false }
      syncRuntimeRef.current.set(playlistId, runtime)
    }
    return runtime
  }

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
    const next = { playlists, loaded, channels, generationId }
    // stateRef is advanced HERE, synchronously with the setState, not only
    // on the next render. A setState issued from a promise chain does not
    // commit before that chain's next microtask runs, so an operation that
    // installs and then immediately reads stateRef (startup's sequential
    // hydrate -> recover -> launch-sync pass is exactly that) would
    // otherwise see the pre-install snapshot and silently drop its own
    // write. The render-time assignment at the top of the hook still runs
    // and is a no-op against this same object.
    stateRef.current = next
    setState(next)
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
      const next = { ...prev, playlists, generationId: combinedGenerationId(playlists.filter((p) => loadedIds.has(p.id))) }
      // Advanced synchronously for the same reason install() does it: a
      // sync landing between a rename and its commit reads stateRef to
      // recover the user's chosen name, and must not read the pre-rename
      // snapshot. (This updater already has a side effect —
      // persistLibrary — and StrictMode's double-invoke is deliberately not
      // in play here; see main.tsx.)
      stateRef.current = next
      return next
    })
  }, [])

  const setStatus = useCallback((playlistId: string, status: PlaylistSyncStatus) => {
    setSyncStatuses((prev) => ({ ...prev, [playlistId]: status }))
  }, [])

  // ---------------------------------------------------------------------
  // ATOMIC GENERATION INSTALL
  //
  // Everything above this line prepares; this is the only thing that
  // publishes. A prepared generation becomes visible to the app in exactly
  // one step: the channel record is written, the library index is written,
  // the ChannelIndex is pre-warmed OFF this render, and then playlists +
  // loaded + channels + generationId land in ONE setState. No consumer can
  // observe a half-installed generation, and nothing before this point has
  // touched the generation the app is currently showing.
  // ---------------------------------------------------------------------
  const installPrepared = useCallback(
    async (prepared: PreparedPlaylistChannels) => {
      markPerf('playlist:install-start')
      await installPreparedChannels(prepared)
      if (!aliveRef.current) return
      // Re-read AFTER the write. A sync can be in flight across a rename, a
      // second playlist being added, or the same playlist being removed —
      // installing against a snapshot captured before the fetch would
      // silently undo whichever of those landed first.
      const current = stateRef.current
      const latest = current.playlists.find((p) => p.id === prepared.playlist.id)
      // Removed while this was in flight. The channel record written just
      // above is orphaned; hydratePlaylistLibrary's pruner clears it on the
      // next launch, which is exactly what that pruner is for.
      if (!latest) return
      // The SOURCE the user is connected to right now wins over the source
      // this generation was fetched from. A sync started against provider A
      // can still be in flight when the viewer edits the connection to
      // provider B (replaceConnection has already installed B's channels by
      // then) — installing A's prepared generation here would silently put
      // them back on the provider they just switched away from, channels and
      // all. Nothing about A is salvageable in that case, so the whole
      // generation is discarded rather than merged.
      if (JSON.stringify(latest.source) !== JSON.stringify(prepared.playlist.source)) {
        console.warn(
          `[playlists] Discarding an in-flight generation for "${latest.name}" — its connection changed while it was downloading.`,
        )
        return
      }
      const merged = { ...prepared.playlist, name: latest.name }
      const playlists = current.playlists.map((p) => (p.id === merged.id ? merged : p))
      persistLibrary(playlists)
      await install(playlists, [
        ...current.loaded.filter((l) => l.playlistId !== merged.id),
        { playlistId: merged.id, channels: prepared.channels },
      ])
      markPerf('playlist:install-end')
      measurePerf('playlist:install', 'playlist:install-start', 'playlist:install-end')
    },
    [install],
  )

  // ---------------------------------------------------------------------
  // THE ONE SYNCHRONIZATION PATH
  //
  // Every trigger — launch, the periodic tick, resume, leaving a long
  // playback session, and the Settings button — arrives here. There is no
  // second timer and no other resync call anywhere in the app, which is
  // what makes "never overlap" enforceable rather than aspirational.
  // ---------------------------------------------------------------------
  const runSync = useCallback(
    (playlist: PlaylistDefinition, trigger: PlaylistSyncTrigger): Promise<void> => {
      if (!isResyncable(playlist.source)) return Promise.resolve()
      const runtime = syncRuntime(playlist.id)

      // NO DUPLICATE, NO OVERLAP. A second trigger for a playlist already
      // syncing joins the sync in progress instead of starting an identical
      // one. A MANUAL request additionally upgrades that in-flight sync so
      // its result installs immediately rather than being held — which is
      // the "handle it intelligently rather than starting another identical
      // operation" case.
      if (runtime.inFlight) {
        if (trigger === 'manual') runtime.forceInstall = true
        return runtime.inFlight
      }

      if (!shouldSync(trigger, runtime.record, Date.now(), runtime.jitterMs)) return Promise.resolve()
      // The fetch half's own playback policy — see PREPARE_DURING_PLAYBACK
      // for the measurement behind the default, and for what flipping it
      // costs. A manual request is never subject to it: the viewer is in
      // Settings, not watching. The install half is gated regardless, below.
      if (!PREPARE_DURING_PLAYBACK && playbackActiveRef.current && trigger !== 'manual') return Promise.resolve()

      runtime.forceInstall = trigger === 'manual'
      markPerf('playlist:sync-request')
      const job = (async () => {
        setStatus(playlist.id, { kind: 'syncing' })
        try {
          // Network + parse + merge. The merge runs in a Worker where the
          // platform supports one (see playlistBuildWorkerClient.ts), so on
          // the main thread this await costs a structured clone, not a
          // ~400 ms merge.
          const prepared = await fetchPlaylistGeneration(playlist)
          if (!aliveRef.current) return

          // VALIDATE BEFORE REPLACING ANYTHING. A provider outage that
          // answers with a truncated body must not be allowed to wipe a
          // working playlist — see validateGeneration for why a manual sync
          // deliberately bypasses the shrink guard.
          const previousCount =
            stateRef.current.loaded.find((l) => l.playlistId === playlist.id)?.channels.length ?? playlist.channelCount
          const validation = validateGeneration(prepared.channels.length, previousCount, trigger)
          if (!validation.ok) throw new UnsafeGenerationError(validation.reason)

          const at = Date.now()
          runtime.record = recordSuccess(at)
          runtime.jitterMs = jitterFor()

          if (playbackActiveRef.current && !runtime.forceInstall) {
            // THE PLAYBACK GATE. The generation is complete and correct; it
            // simply does not become visible yet. Nothing about the stream
            // the viewer is watching is touched — not its sources, not its
            // ranking, not the arrays its screen was mounted with.
            pendingRef.current.set(playlist.id, prepared)
            setStatus(playlist.id, { kind: 'pending-install', at })
            markPerf('playlist:install-deferred')
            return
          }

          await installPrepared(prepared)
          if (!aliveRef.current) return
          setStatus(playlist.id, { kind: 'synced', at })
        } catch (err) {
          if (!aliveRef.current) return
          // NOTHING WAS CLEARED BEFORE THE FETCH, so the previous channels,
          // the cached record and the saved credentials are all still
          // exactly as they were. The failure is recorded (which advances
          // backoff) and reported in Settings — never as a toast over live
          // video, because an automatic refresh failing is not something a
          // viewer needs interrupting for.
          console.warn(`[playlists] ${trigger} sync failed for "${playlist.name}" — existing playlist kept.`, err)
          runtime.record = recordFailure(runtime.record, Date.now())
          runtime.jitterMs = jitterFor()
          setStatus(playlist.id, { kind: 'error', message: syncErrorMessage(err) })
        } finally {
          runtime.inFlight = null
          runtime.forceInstall = false
        }
      })()

      runtime.inFlight = job
      return job
    },
    [installPrepared, setStatus],
  )

  // Sequential, never parallel — the same rule startup recovery has always
  // followed. Two large playlists downloading and merging at once on a
  // low-powered TV compete for the same network and the same main thread
  // the UI is using, and the second one gains nothing by starting early.
  const syncPlaylists = useCallback(
    async (playlists: readonly PlaylistDefinition[], trigger: PlaylistSyncTrigger) => {
      for (const playlist of playlists) {
        if (!aliveRef.current) return
        await runSync(playlist, trigger)
      }
    },
    [runSync],
  )

  // Installs every generation the playback gate held back, then asks
  // whether anything is now stale enough to refetch. Called on the
  // playback-active false edge — i.e. the moment the viewer leaves the
  // Player or Multiview.
  const drainPendingAndRefresh = useCallback(async () => {
    const pending = [...pendingRef.current.values()]
    pendingRef.current.clear()
    for (const prepared of pending) {
      if (!aliveRef.current) return
      await installPrepared(prepared)
      if (!aliveRef.current) return
      setStatus(prepared.playlist.id, { kind: 'synced', at: Date.now() })
    }
    if (!aliveRef.current) return
    // Even with a generation just installed this is worth asking: the held
    // generation may itself be older than the refresh interval after a long
    // match, and a session with no pending generation at all (because it
    // started playing immediately after launch) is exactly the "do not
    // leave the viewer on a two-hour-old playlist" case.
    await syncPlaylists(stateRef.current.playlists.filter((p) => isResyncable(p.source)), 'playback-exit')
  }, [installPrepared, setStatus, syncPlaylists])

  const drainPendingAndRefreshRef = useRef(drainPendingAndRefresh)
  drainPendingAndRefreshRef.current = drainPendingAndRefresh

  const setPlaybackActive = useCallback((active: boolean) => {
    const was = playbackActiveRef.current
    playbackActiveRef.current = active
    // Only the falling edge does work. Entering playback deliberately does
    // nothing at all — no cancellation, no flush, no state change — so
    // starting a stream can never be delayed by the sync coordinator.
    if (was && !active) void drainPendingAndRefreshRef.current()
  }, [])

  // Startup: migrate (once), load every playlist's cached channels, then
  // bring every refetchable playlist up to date in the background — first
  // rebuilding the ones with no usable cache at all, then refreshing the
  // ones that hydrated fine. Never blocks first paint: the cached
  // generation is already installed and on screen before any of this runs,
  // which is the "cached playlist must be available immediately" half of
  // the requirement. Home's own data comes from ninety-api, not from the
  // playlist, so it never waits on this either.
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

      // ONE sequential pass over the library, not two. Each playlist either
      // needs rebuilding from scratch (no usable cache) or refreshing from
      // its cached generation — never both, and never at the same time as
      // another playlist. `result.playlists` is used rather than
      // stateRef.current because the install() above may not have committed
      // a render yet at this exact point.
      const needsRecovery = new Set(result.needsRecovery.map((p) => p.id))
      for (const playlist of result.playlists) {
        if (cancelled) return
        if (needsRecovery.has(playlist.id)) await recoverOne(playlist)
        else if (isResyncable(playlist.source)) await runSync(playlist, 'launch')
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
        // Recovery IS a successful sync — recording it here is what stops
        // the launch sweep, and then the first periodic tick, from
        // immediately refetching a playlist that was just downloaded.
        syncRuntime(playlist.id).record = recordSuccess(Date.now())
        setStatus(playlist.id, { kind: 'synced', at: Date.now() })
      } catch (err) {
        console.error(`[playlists] Automatic recovery failed for "${playlist.name}".`, err)
        if (cancelled || !aliveRef.current) return
        syncRuntime(playlist.id).record = recordFailure(syncRuntime(playlist.id).record, Date.now())
        setStatus(playlist.id, { kind: 'error', message: syncErrorMessage(err) })
        setNotice(`Ninety couldn't reconnect "${playlist.name}". Open Settings to try again.`)
      }
    }

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [install, setStatus, runSync])

  // PERIODIC FRESHNESS + RESUME, as one effect with one timer and one
  // listener for the whole app.
  //
  // Which lifecycle signals this uses, stated explicitly because the
  // requirement asks: the Page Visibility API, and only it —
  // `document.visibilityState` to decide whether a tick should do anything,
  // and the `visibilitychange` event as the resume trigger. Tizen fires
  // both when an app is suspended and resumed, and this codebase has no
  // other lifecycle hook available (see core/platform — there is no Tizen
  // application-state binding). The visibleState check is what keeps a
  // genuinely suspended app from burning the provider's bandwidth and the
  // TV's radio on refreshes nobody will see.
  //
  // The tick itself is a handful of integer comparisons per playlist; the
  // actual staleness decision lives in playlistSyncPolicy.shouldSync, and
  // runSync's in-flight guard means a tick landing on top of a running sync
  // costs nothing.
  useEffect(() => {
    function refreshDue(trigger: PlaylistSyncTrigger) {
      if (document.visibilityState !== 'visible') return
      const resyncable = stateRef.current.playlists.filter((p) => isResyncable(p.source))
      if (resyncable.length === 0) return
      void syncPlaylists(resyncable, trigger)
    }
    const intervalId = setInterval(() => refreshDue('interval'), PLAYLIST_SYNC_TICK_MS)
    function onVisibilityChange() {
      refreshDue('resume')
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [syncPlaylists])

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
      // Connecting a playlist IS its first successful sync — the caller
      // already downloaded and merged it. Recording that here is what stops
      // the coordinator's next tick, sixty seconds later, from immediately
      // re-downloading a 5 MB playlist the viewer just watched import.
      syncRuntime(playlist.id).record = recordSuccess(Date.now())
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
      // Same reasoning as addPlaylist: the replacement was just fetched, so
      // the coordinator must not treat this playlist as never-synced.
      syncRuntime(playlistId).record = recordSuccess(Date.now())
      // A connection edit invalidates any generation held for the OLD
      // connection — installing it after this would silently reinstate the
      // provider the viewer just switched away from.
      pendingRef.current.delete(playlistId)
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

  // MANUAL SYNC (Settings). Goes through the exact same coordinator every
  // automatic trigger uses — which is what lets it deduplicate against an
  // automatic sync already in flight instead of starting a second identical
  // download, and what makes its result install even during playback.
  const resyncPlaylist = useCallback(
    async (playlistId: string) => {
      const playlist = stateRef.current.playlists.find((p) => p.id === playlistId)
      if (!playlist) return
      await runSync(playlist, 'manual')
    },
    [runSync],
  )

  const resyncAll = useCallback(async () => {
    await syncPlaylists(stateRef.current.playlists.filter((p) => isResyncable(p.source)), 'manual')
  }, [syncPlaylists])

  const removePlaylist = useCallback(
    async (playlistId: string) => {
      await deletePlaylistChannels(playlistId)
      if (!aliveRef.current) return
      // Drop the coordinator's state for this playlist too, so a pending
      // generation for a playlist the user just removed can never be
      // installed by the playback-exit drain, and a fresh playlist that
      // happens to reuse the id starts with a clean backoff record.
      pendingRef.current.delete(playlistId)
      syncRuntimeRef.current.delete(playlistId)
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
    setPlaybackActive,
  }
}

// Consumer-facing, never a raw stack or a URL with credentials in it.
// Module-local: the message reaches the UI through PlaylistSyncStatus, so
// nothing outside this hook has any reason to format one.
function syncErrorMessage(err: unknown): string {
  if (err instanceof EmptyPlaylistError) return 'That playlist has no channels — nothing was changed.'
  // The shrink guard fired (see playlistSyncPolicy.validateGeneration). Says
  // what happened AND what to do about it, because unlike a network failure
  // this one has a deliberate override: a manual Resync bypasses the guard.
  if (err instanceof UnsafeGenerationError && err.reason === 'collapsed') {
    return 'Provider returned far fewer channels than before — existing playlist kept. Resync manually to accept it.'
  }
  // Worth separating from a generic failure: "didn't respond" tells a
  // viewer (and a beta tester writing up a report) that the provider is
  // reachable-but-slow rather than that Ninety rejected their playlist.
  // Both branches say the existing playlist was kept, because it was —
  // recoverOne() only sets a status here, it never clears cached channels.
  if (isRequestTimeout(err)) return "Playlist server didn't respond — existing playlist kept."
  return "Couldn't sync — existing playlist kept."
}
