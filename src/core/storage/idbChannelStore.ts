// IndexedDB-backed store for the large, merged Channel[] cache — replaces
// the old synchronous `JSON.parse(localStorage.getItem(...))`/
// `JSON.stringify` + `setItem` round trip in session.ts, which blocked the
// main thread on every app boot and every playlist save for a ~30,925-
// channel playlist. See idb.ts for the underlying single-record-store
// mechanics (structured clone, never JSON; read()/write()/clear() never
// throw).
import { openSingleRecordStore, type IdbSingleRecordStore } from './idb'
import type { Channel } from '../../data/channel'

export interface StoredChannelsRecord {
  version: number
  // Opaque id stamped once per playlist generation (see
  // data/playlistGeneration.ts) — persisted here so a normal cached launch
  // can read it straight back instead of recomputing anything from the
  // channel data itself. Used to key the identity resolver's cross-session
  // resolution cache (see data/sports/channelIdentityResolutionCache.ts).
  generationId: string
  channels: Channel[]
}

const defaultStore: IdbSingleRecordStore<StoredChannelsRecord> = openSingleRecordStore('ninety-tv-channels', 'channels')

export function idbReadChannels(
  store: IdbSingleRecordStore<StoredChannelsRecord> = defaultStore,
): Promise<StoredChannelsRecord | null> {
  return store.read()
}

export function idbWriteChannels(
  record: StoredChannelsRecord,
  store: IdbSingleRecordStore<StoredChannelsRecord> = defaultStore,
): Promise<boolean> {
  return store.write(record)
}

export function idbClearChannels(store: IdbSingleRecordStore<StoredChannelsRecord> = defaultStore): Promise<boolean> {
  return store.clear()
}
