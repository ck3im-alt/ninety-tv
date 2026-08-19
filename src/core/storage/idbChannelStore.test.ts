import { describe, expect, it } from 'vitest'
import { idbReadChannels, idbWriteChannels, idbClearChannels, type StoredChannelsRecord } from './idbChannelStore'
import type { IdbSingleRecordStore } from './idb'
import type { Channel } from '../../data/channel'

// In-memory fake satisfying IdbSingleRecordStore<T> — same
// dependency-injection pattern already used for WorkerFactory
// (channelIdentityWorkerClient.ts) and CatalogSource
// (channelIdentityLifecycle.ts). Proves idbChannelStore.ts's wrapper
// functions delegate correctly; the real IndexedDB transaction mechanics
// live in idb.ts and are covered by idb.test.ts + manual on-device checks.
function makeFakeStore(): IdbSingleRecordStore<StoredChannelsRecord> & { failNextWrite?: boolean; failNextClear?: boolean } {
  let record: StoredChannelsRecord | null = null
  const fake = {
    failNextWrite: false,
    failNextClear: false,
    async read() {
      return record
    },
    async write(value: StoredChannelsRecord) {
      if (fake.failNextWrite) return false
      record = value
      return true
    },
    async clear() {
      if (fake.failNextClear) return false
      record = null
      return true
    },
  }
  return fake
}

function makeChannels(count: number): Channel[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ch${i}`,
    name: `Channel ${i}`,
    groupTitle: 'News',
    sources: [{ label: 'HD', url: `https://stream.example.com/${i}.m3u8` }],
  }))
}

describe('idbChannelStore', () => {
  it('read() returns null before anything has been written', async () => {
    const store = makeFakeStore()
    await expect(idbReadChannels(store)).resolves.toBeNull()
  })

  it('write() then read() round-trips the full record, structured-clone style (no JSON in between)', async () => {
    const store = makeFakeStore()
    const record: StoredChannelsRecord = { version: 2, generationId: 'gen-1', channels: makeChannels(5) }
    await expect(idbWriteChannels(record, store)).resolves.toBe(true)
    await expect(idbReadChannels(store)).resolves.toEqual(record)
  })

  it('write() failure is reported as false, not thrown', async () => {
    const store = makeFakeStore()
    store.failNextWrite = true
    await expect(idbWriteChannels({ version: 2, generationId: 'gen-1', channels: [] }, store)).resolves.toBe(false)
  })

  it('clear() removes the stored record and reports success', async () => {
    const store = makeFakeStore()
    await idbWriteChannels({ version: 2, generationId: 'gen-1', channels: makeChannels(1) }, store)
    await expect(idbClearChannels(store)).resolves.toBe(true)
    await expect(idbReadChannels(store)).resolves.toBeNull()
  })

  it('clear() failure is reported as false, and the record is left in place', async () => {
    const store = makeFakeStore()
    const record: StoredChannelsRecord = { version: 2, generationId: 'gen-1', channels: makeChannels(1) }
    await idbWriteChannels(record, store)
    store.failNextClear = true
    await expect(idbClearChannels(store)).resolves.toBe(false)
    await expect(idbReadChannels(store)).resolves.toEqual(record)
  })
})
