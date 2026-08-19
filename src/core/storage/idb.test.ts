import { describe, expect, it } from 'vitest'
import { openSingleRecordStore } from './idb'

// This test suite runs in Node (no jsdom, no browser IndexedDB — same
// constraint testFakeLocalStorage.ts documents for localStorage), so
// `indexedDB` is genuinely undefined here. That happens to be exactly the
// scenario this module must degrade gracefully from on a real device too
// (some restricted Tizen Web Runtime contexts have no IndexedDB at all), so
// this is real, valuable coverage rather than a workaround: it proves the
// "unavailable -> never throws, resolves null/false" contract end to end.
// The real transaction-handling path (openDb/get/put/delete against an
// actual IndexedDB engine) can only be exercised in a real browser/Tizen
// runtime and is covered by manual on-device verification instead.
describe('openSingleRecordStore — IndexedDB unavailable', () => {
  it('read() resolves null without throwing', async () => {
    const store = openSingleRecordStore<{ value: number }>('test-db', 'test-store')
    await expect(store.read()).resolves.toBeNull()
  })

  it('write() resolves false without throwing', async () => {
    const store = openSingleRecordStore<{ value: number }>('test-db', 'test-store')
    await expect(store.write({ value: 1 })).resolves.toBe(false)
  })

  it('clear() resolves false without throwing', async () => {
    const store = openSingleRecordStore<{ value: number }>('test-db', 'test-store')
    await expect(store.clear()).resolves.toBe(false)
  })
})
