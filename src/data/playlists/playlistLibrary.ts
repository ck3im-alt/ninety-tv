// Storage-level orchestration for the playlist library: hydrate everything
// on launch, and sync/replace/remove ONE playlist atomically.
//
// Kept free of React so the invariants that actually matter here — "a
// failed resync leaves the old channels in place", "removing B never
// touches A", "nothing is deleted before its replacement is written" — are
// testable without rendering anything. usePlaylistLibrary.ts is the thin
// React binding over this.
import {
  PLAYLIST_CHANNELS_RECORD_VERSION,
  listPlaylistChannelKeys,
  readPlaylistChannels,
  removePlaylistChannels,
  writePlaylistChannels,
} from '../../core/storage/idbPlaylistChannelStore'
import { generatePlaylistGenerationId } from '../playlistGeneration'
import { loadChannelsForSource } from './connectPlaylist'
import { migrateSinglePlaylistIfNeeded } from './playlistMigration'
import { isResyncable, stampPlaylistProvenance, type PlaylistDefinition } from './playlistDefinition'
import { loadPlaylistLibrary, savePlaylistLibrary } from './playlistLibraryStore'
import type { LoadedPlaylistChannels } from './combinePlaylistChannels'
import type { Channel } from '../channel'
import type { M3uUrlSourceRecord, XtreamSourceRecord } from '../session'

export interface PlaylistHydration {
  playlists: PlaylistDefinition[]
  // Only the playlists whose cached channels were actually available. In
  // library order, so combinePlaylistChannels produces a stable result.
  loaded: LoadedPlaylistChannels[]
  // Cache missing/stale but the source can be refetched — the caller
  // rebuilds these in the background without asking the user for anything.
  needsRecovery: PlaylistDefinition[]
  // A file playlist whose cache is gone. Nothing to refetch (the bytes were
  // never kept) — the user has to pick the file again.
  unrecoverableFiles: PlaylistDefinition[]
}

// Reads the library index, migrating a pre-existing single-playlist install
// first, then loads each playlist's cached channels. One playlist failing
// to load never prevents the others from loading — a healthy playlist must
// not be taken down by a broken one.
export async function hydratePlaylistLibrary(): Promise<PlaylistHydration> {
  const migration = await migrateSinglePlaylistIfNeeded()
  if (migration.kind === 'failed') {
    console.error('[playlists] Migration from the single-playlist store failed — retrying on next launch.', migration.reason)
  }

  const playlists = loadPlaylistLibrary()
  const loaded: LoadedPlaylistChannels[] = []
  const needsRecovery: PlaylistDefinition[] = []
  const unrecoverableFiles: PlaylistDefinition[] = []

  // The migration already holds the just-carried-over channels in memory —
  // reading them straight back out of IndexedDB would be a pointless second
  // multi-MB round trip on the one launch that can least afford it.
  const migratedChannels =
    migration.kind === 'migrated' && migration.channels ? { id: migration.playlist.id, channels: migration.channels } : null

  const records = await Promise.all(
    playlists.map(async (playlist) => {
      if (migratedChannels && migratedChannels.id === playlist.id) {
        return { playlist, channels: migratedChannels.channels }
      }
      const record = await readPlaylistChannels(playlist.id)
      return { playlist, channels: record?.channels ?? null }
    }),
  )

  for (const { playlist, channels } of records) {
    if (channels && channels.length > 0) {
      loaded.push({ playlistId: playlist.id, channels })
    } else if (isResyncable(playlist.source)) {
      needsRecovery.push(playlist)
    } else {
      unrecoverableFiles.push(playlist)
    }
  }

  void pruneOrphanedChannelRecords(playlists)

  return { playlists, loaded, needsRecovery, unrecoverableFiles }
}

// Channel records with no library entry pointing at them can only come from
// an external reset (the dev AdminPanel wipes localStorage but not
// IndexedDB) — they are unreachable dead weight, potentially tens of MB of
// it. Best-effort and never awaited by hydration: a failure here has no
// user-visible consequence.
async function pruneOrphanedChannelRecords(playlists: readonly PlaylistDefinition[]): Promise<void> {
  try {
    const known = new Set(playlists.map((p) => p.id))
    const keys = await listPlaylistChannelKeys()
    for (const key of keys) {
      if (!known.has(key)) await removePlaylistChannels(key)
    }
  } catch (err) {
    console.warn('[playlists] Could not prune orphaned channel records.', err)
  }
}

export interface SyncedPlaylist {
  playlist: PlaylistDefinition
  channels: Channel[]
}

// Fetches a playlist from its saved source and — only once that has fully
// succeeded — replaces its cached channels atomically.
//
// The ordering is the whole point: fetch, parse, merge and stamp FIRST,
// write SECOND, and return the updated definition LAST. Nothing is cleared
// up front, so a failed sync (network down, provider rejecting the
// credentials, an empty response) throws before a single byte of the
// working cache has been touched. The caller keeps showing the old
// channels and reports the failure inline.
export async function syncPlaylist(playlist: PlaylistDefinition): Promise<SyncedPlaylist> {
  if (!isResyncable(playlist.source)) {
    throw new Error('This playlist was added from a file, so Ninety needs the file again to update it.')
  }
  const channels = await loadChannelsForSource(playlist.source as XtreamSourceRecord | M3uUrlSourceRecord)
  return commitPlaylistChannels(playlist, playlist.source, channels)
}

// Shared tail of every "this playlist now has these channels" path: fresh
// connect, resync, and a successful connection edit. Writes the (large)
// channel record before returning the updated definition, so a caller that
// persists the definition can trust the channels behind it exist.
export async function commitPlaylistChannels(
  playlist: PlaylistDefinition,
  source: PlaylistDefinition['source'],
  channels: Channel[],
): Promise<SyncedPlaylist> {
  const generationId = generatePlaylistGenerationId()
  stampPlaylistProvenance(channels, playlist.id)
  const written = await writePlaylistChannels({
    version: PLAYLIST_CHANNELS_RECORD_VERSION,
    playlistId: playlist.id,
    generationId,
    channels,
  })
  if (!written) {
    // Reported, not thrown: the channels are correct and usable for this
    // session, they just won't survive a restart. Throwing would discard a
    // perfectly good playlist the user is looking at over a storage-quota
    // problem they can do nothing about right now.
    console.error(
      `[playlists] Channel cache for "${playlist.name}" did not persist — it will need to be resynced after a restart.`,
    )
  }
  return {
    playlist: {
      ...playlist,
      source,
      generationId,
      lastSyncedAt: Date.now(),
      channelCount: channels.length,
    },
    channels,
  }
}

// Deletes a playlist's channel record. The library index is updated by the
// caller AFTER this resolves, so a failed delete can't leave an entry
// pointing at data that is half gone.
export async function deletePlaylistChannels(playlistId: string): Promise<boolean> {
  return removePlaylistChannels(playlistId)
}

export function persistLibrary(playlists: readonly PlaylistDefinition[]): boolean {
  return savePlaylistLibrary(playlists)
}
