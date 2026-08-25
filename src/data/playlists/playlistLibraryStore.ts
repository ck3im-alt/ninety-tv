// Persistence for the playlist LIBRARY INDEX — the small, synchronous half
// of multi-playlist state (ids, names, sources, sync metadata). The large
// half (each playlist's Channel[]) lives in IndexedDB, one record per
// playlist, in core/storage/idbPlaylistChannelStore.ts.
//
// Exactly the same split, and for exactly the same reason, as the
// single-playlist design this replaces (see data/session.ts's header): the
// index is a few hundred bytes and effectively never fails to write, so a
// failed channel-cache write still leaves behind enough to reconnect every
// playlist automatically on the next launch.
import { readStored, writeStored } from '../../core/storage/localStore'
import type { PlaylistDefinition } from './playlistDefinition'

const LIBRARY_KEY = 'ninety.playlists'
// Set once the one-time migration from the single-playlist representation
// has run to completion (see playlistMigration.ts). Kept SEPARATE from the
// library itself on purpose: an empty library is a legitimate state (the
// user removed their last playlist), and without this flag the migration
// would read the still-present legacy source record and resurrect the
// playlist they just deleted on the next launch.
const MIGRATED_KEY = 'ninety.playlists.migratedFromSingle'

const LIBRARY_SCHEMA_VERSION = 1

interface StoredLibrary {
  version: number
  playlists: PlaylistDefinition[]
}

const EMPTY_LIBRARY: StoredLibrary = { version: LIBRARY_SCHEMA_VERSION, playlists: [] }

// Order is meaningful and preserved: it's the order playlists are combined
// in (see combinePlaylistChannels) and the order Settings lists them in.
export function loadPlaylistLibrary(): PlaylistDefinition[] {
  const stored = readStored<StoredLibrary>(LIBRARY_KEY, EMPTY_LIBRARY)
  if (!stored || stored.version !== LIBRARY_SCHEMA_VERSION || !Array.isArray(stored.playlists)) return []
  return stored.playlists.filter(isUsableDefinition)
}

export function savePlaylistLibrary(playlists: readonly PlaylistDefinition[]): boolean {
  return writeStored<StoredLibrary>(LIBRARY_KEY, { version: LIBRARY_SCHEMA_VERSION, playlists: [...playlists] })
}

export function hasMigratedFromSinglePlaylist(): boolean {
  return readStored<boolean>(MIGRATED_KEY, false)
}

export function markMigratedFromSinglePlaylist(): boolean {
  return writeStored<boolean>(MIGRATED_KEY, true)
}

// Used only by session.ts's clearPlaylist (the dev AdminPanel's "forget the
// playlist" action). Clearing the migration flag alongside the library is
// correct there and only there: that action deliberately restores the
// "nothing connected" state, and the legacy keys it also removes mean a
// re-run of the migration would find nothing to migrate anyway.
export function clearPlaylistLibrary(): boolean {
  try {
    localStorage.removeItem(LIBRARY_KEY)
    localStorage.removeItem(MIGRATED_KEY)
    return true
  } catch {
    return false
  }
}

// Defensive: a definition missing an id or a source can't address its own
// channel cache or be reconnected, so it would only ever render as a broken
// row in Settings. Dropping it is strictly better than showing it.
function isUsableDefinition(value: unknown): value is PlaylistDefinition {
  if (!value || typeof value !== 'object') return false
  const def = value as Partial<PlaylistDefinition>
  return typeof def.id === 'string' && def.id.length > 0 && def.source != null && typeof def.source.type === 'string'
}
