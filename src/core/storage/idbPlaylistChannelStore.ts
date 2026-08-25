// IndexedDB-backed cache for each connected playlist's merged Channel[] —
// the multi-playlist successor to idbChannelStore.ts's single fixed record.
//
// One record PER playlist, keyed by PlaylistDefinition.id, rather than one
// record holding a map of every playlist. That's the whole point: resyncing
// or removing playlist B must not read, rewrite or risk playlist A's
// (potentially ~30,000-channel) record. With a single combined record, a
// resync of B would have to serialize A's channels again on every write —
// both slower and a chance to lose A if that write fails halfway.
//
// idbChannelStore.ts is deliberately left in place and untouched: it is the
// LEGACY store, still read exactly once by the one-time migration in
// data/playlists/playlistMigration.ts, and cleared only after the new
// representation is proven written.
import { openKeyedRecordStore, type IdbKeyedRecordStore } from './idb'
import type { Channel } from '../../data/channel'

export interface StoredPlaylistChannelsRecord {
  // Bumped when Channel's shape or the merge/normalization logic changes in
  // a way that makes previously-cached channels stale or invalid — same
  // contract as session.ts's PLAYLIST_CHANNELS_SCHEMA_VERSION, kept
  // independent so the two can't accidentally invalidate each other.
  //
  // Starts at 1 (not continuing the legacy store's 2): this is a brand-new
  // store with its own record shape, and every record in it is written by
  // code that already stamps per-source playlist provenance.
  version: number
  playlistId: string
  // Opaque id stamped once per SYNC of THIS playlist (see
  // data/playlistGeneration.ts). Per-playlist rather than global so
  // resyncing B doesn't invalidate anything keyed off A's generation.
  generationId: string
  channels: Channel[]
}

export const PLAYLIST_CHANNELS_RECORD_VERSION = 1

const defaultStore: IdbKeyedRecordStore<StoredPlaylistChannelsRecord> = openKeyedRecordStore(
  'ninety-tv-playlist-channels',
  'playlists',
)

// Returns null for a missing record AND for one written by an incompatible
// (future or stale) schema version — callers treat both identically: the
// playlist's channels have to be re-fetched from its source.
export async function readPlaylistChannels(
  playlistId: string,
  store: IdbKeyedRecordStore<StoredPlaylistChannelsRecord> = defaultStore,
): Promise<StoredPlaylistChannelsRecord | null> {
  const record = await store.read(playlistId)
  if (!record || record.version !== PLAYLIST_CHANNELS_RECORD_VERSION) return null
  return record
}

export function writePlaylistChannels(
  record: StoredPlaylistChannelsRecord,
  store: IdbKeyedRecordStore<StoredPlaylistChannelsRecord> = defaultStore,
): Promise<boolean> {
  return store.write(record.playlistId, record)
}

export function removePlaylistChannels(
  playlistId: string,
  store: IdbKeyedRecordStore<StoredPlaylistChannelsRecord> = defaultStore,
): Promise<boolean> {
  return store.remove(playlistId)
}

export function listPlaylistChannelKeys(
  store: IdbKeyedRecordStore<StoredPlaylistChannelsRecord> = defaultStore,
): Promise<string[]> {
  return store.keys()
}

// Deletes every cached playlist record — used only by the "forget the
// connected playlist" paths (session.ts's clearPlaylist, driven by the dev
// AdminPanel). Reports whether ALL deletions completed, so a caller that
// reloads afterwards can decline to when storage is only partially cleared.
export async function clearAllPlaylistChannels(
  store: IdbKeyedRecordStore<StoredPlaylistChannelsRecord> = defaultStore,
): Promise<boolean> {
  const keys = await store.keys()
  const results = await Promise.all(keys.map((key) => store.remove(key)))
  return results.every(Boolean)
}
