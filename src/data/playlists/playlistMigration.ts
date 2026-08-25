// One-time, idempotent migration from Ninety's single-playlist storage to
// the playlist library.
//
// Every existing Ninety install has exactly one playlist saved as:
//   - localStorage "ninety.playlist.source"  -> one PlaylistSourceRecord
//   - IndexedDB    ninety-tv-channels/record -> one { version, generationId,
//                                                    channels } record
//
// After this runs, the same user has exactly one PlaylistDefinition in the
// library, their cached channels are stamped with that playlist's id and
// stored under it, and nothing else about their install has changed: no
// preferences, no filters, no favorites, no recently-watched, and no
// re-run of onboarding.
//
// Deliberately NOT triggered by opening Settings. This runs at the storage
// boundary, on the app's normal playlist hydration path, so a user who
// never opens Settings still gets migrated — and gets migrated exactly
// once, before anything reads the library.
//
// Safety rules this file follows, mirroring the earlier localStorage ->
// IndexedDB channel-cache transition:
//   1. Nothing legacy is deleted until the new representation is PROVEN
//      written (both the IndexedDB channel record and the library index
//      report success).
//   2. A failure at any point leaves the legacy representation completely
//      intact, so the next launch simply tries again.
//   3. The "already migrated" marker is a flag of its own, never inferred
//      from "the library is non-empty" — otherwise removing your last
//      playlist would resurrect it on the next launch.
import { idbReadChannels, idbClearChannels } from '../../core/storage/idbChannelStore'
import {
  PLAYLIST_CHANNELS_RECORD_VERSION,
  writePlaylistChannels,
  type StoredPlaylistChannelsRecord,
} from '../../core/storage/idbPlaylistChannelStore'
import { PLAYLIST_CHANNELS_SCHEMA_VERSION, loadPlaylistSource, removeLegacyPlaylistChannelsCache } from '../session'
import { generatePlaylistGenerationId } from '../playlistGeneration'
import { defaultPlaylistName, newPlaylistId, stampPlaylistProvenance, type PlaylistDefinition } from './playlistDefinition'
import {
  hasMigratedFromSinglePlaylist,
  loadPlaylistLibrary,
  markMigratedFromSinglePlaylist,
  savePlaylistLibrary,
} from './playlistLibraryStore'
import type { Channel } from '../channel'

export type MigrationOutcome =
  // The flag was already set — nothing read, nothing written.
  | { kind: 'already-migrated' }
  // Nothing was ever connected on this device (fresh install, or state the
  // user cleared themselves). The flag is set so this stays a one-time
  // check rather than a read on every launch.
  | { kind: 'nothing-to-migrate' }
  // One playlist now exists in the library. `channels` is non-null when the
  // legacy channel cache was valid and has been carried over as-is (no
  // re-download needed); null when only the source record survived, in
  // which case the normal recovery path refetches it.
  | { kind: 'migrated'; playlist: PlaylistDefinition; channels: Channel[] | null }
  // Something failed to persist. The legacy representation is untouched and
  // this will be retried on the next launch.
  | { kind: 'failed'; reason: string }

interface MigrationDeps {
  readLegacyChannels: typeof idbReadChannels
  clearLegacyChannels: typeof idbClearChannels
  writeChannels: typeof writePlaylistChannels
  loadSource: typeof loadPlaylistSource
  loadLibrary: typeof loadPlaylistLibrary
  saveLibrary: typeof savePlaylistLibrary
  hasMigrated: typeof hasMigratedFromSinglePlaylist
  markMigrated: typeof markMigratedFromSinglePlaylist
  now: () => number
  newId: () => string
  newGenerationId: () => string
}

const defaultDeps: MigrationDeps = {
  readLegacyChannels: idbReadChannels,
  clearLegacyChannels: idbClearChannels,
  writeChannels: writePlaylistChannels,
  loadSource: loadPlaylistSource,
  loadLibrary: loadPlaylistLibrary,
  saveLibrary: savePlaylistLibrary,
  hasMigrated: hasMigratedFromSinglePlaylist,
  markMigrated: markMigratedFromSinglePlaylist,
  now: Date.now,
  newId: newPlaylistId,
  newGenerationId: generatePlaylistGenerationId,
}

export async function migrateSinglePlaylistIfNeeded(overrides: Partial<MigrationDeps> = {}): Promise<MigrationOutcome> {
  const deps = { ...defaultDeps, ...overrides }

  if (deps.hasMigrated()) return { kind: 'already-migrated' }

  const legacySource = deps.loadSource()
  const legacyCache = await deps.readLegacyChannels()
  const cacheValid =
    legacyCache != null && legacyCache.version === PLAYLIST_CHANNELS_SCHEMA_VERSION && legacyCache.channels.length > 0

  if (!legacySource && !cacheValid) {
    // Nothing to carry over. Marking the flag here is what keeps a normal
    // launch from re-reading the legacy IndexedDB record forever.
    deps.markMigrated()
    return { kind: 'nothing-to-migrate' }
  }

  // A cache with no source record is unusual but real (a source write that
  // failed, or storage cleared unevenly). It's still usable channels, so
  // it's carried over as a file-shaped playlist — the one source type that
  // honestly says "this can't be refetched automatically" — rather than
  // thrown away.
  const source = legacySource ?? { type: 'file' as const, fileName: 'Saved playlist' }
  const existing = deps.loadLibrary()
  const playlist: PlaylistDefinition = {
    id: deps.newId(),
    name: defaultPlaylistName(source, existing.map((p) => p.name)),
    source,
    createdAt: deps.now(),
    // A carried-over cache was genuinely synced at some point, we just
    // don't know when — recorded as "now" rather than inventing a fake past
    // timestamp or claiming it was never synced.
    lastSyncedAt: cacheValid ? deps.now() : null,
    generationId: cacheValid && legacyCache ? legacyCache.generationId : deps.newGenerationId(),
    channelCount: cacheValid && legacyCache ? legacyCache.channels.length : 0,
  }

  let channels: Channel[] | null = null
  if (cacheValid && legacyCache) {
    // Stamp provenance BEFORE writing, so the migrated record is
    // indistinguishable from one written by a fresh connect — no
    // "unstamped legacy channels" special case anywhere downstream.
    channels = stampPlaylistProvenance(legacyCache.channels, playlist.id)
    const record: StoredPlaylistChannelsRecord = {
      version: PLAYLIST_CHANNELS_RECORD_VERSION,
      playlistId: playlist.id,
      generationId: playlist.generationId,
      channels,
    }
    const written = await deps.writeChannels(record)
    if (!written) {
      return { kind: 'failed', reason: 'Could not write the migrated channel cache.' }
    }
  }

  if (!deps.saveLibrary([...existing, playlist])) {
    return { kind: 'failed', reason: 'Could not write the playlist library index.' }
  }
  deps.markMigrated()

  // Only now — with the library index and (where applicable) the new
  // channel record both confirmed written — is it safe to release the old
  // copy of the same data. A failure here is harmless: an orphaned legacy
  // record is only wasted space, and the migration flag stops it from ever
  // being read again.
  //
  // The legacy SOURCE record in localStorage is deliberately left alone: it
  // is a few hundred bytes, it is never read again once the flag is set,
  // and keeping it means a user who somehow ends up on an older build still
  // has a reconnectable playlist rather than an empty app.
  if (cacheValid) void deps.clearLegacyChannels()
  removeLegacyPlaylistChannelsCache()

  return { kind: 'migrated', playlist, channels }
}
