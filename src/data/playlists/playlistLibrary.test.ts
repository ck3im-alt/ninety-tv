// Storage-level invariants for the playlist library. The ones that matter:
// a failed resync must leave the old channels, source and cache exactly as
// they were; one broken playlist must never take a healthy one down; and
// removing a playlist must touch only its own record.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeLocalStorage } from '../../core/storage/testFakeLocalStorage'
import type { Channel } from '../channel'
import type { PlaylistDefinition } from './playlistDefinition'
import type { StoredPlaylistChannelsRecord } from '../../core/storage/idbPlaylistChannelStore'

// In-memory stand-in for the keyed IndexedDB channel store (no engine in
// this environment — see idb.test.ts), plus a stubbed network fetch so a
// "resync" is deterministic. Same dependency-injection idiom the rest of
// this project's I/O boundaries use.
const store = new Map<string, StoredPlaylistChannelsRecord>()
let writeShouldFail = false
vi.mock('../../core/storage/idbPlaylistChannelStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/storage/idbPlaylistChannelStore')>()
  return {
    ...actual,
    readPlaylistChannels: async (id: string) => store.get(id) ?? null,
    writePlaylistChannels: async (record: StoredPlaylistChannelsRecord) => {
      if (writeShouldFail) return false
      store.set(record.playlistId, record)
      return true
    },
    removePlaylistChannels: async (id: string) => {
      store.delete(id)
      return true
    },
    listPlaylistChannelKeys: async () => [...store.keys()],
  }
})

const loadChannelsForSource = vi.fn()
vi.mock('./connectPlaylist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./connectPlaylist')>()
  return { ...actual, loadChannelsForSource: (...args: unknown[]) => loadChannelsForSource(...args) }
})

import { commitPlaylistChannels, deletePlaylistChannels, hydratePlaylistLibrary, syncPlaylist } from './playlistLibrary'
import { markMigratedFromSinglePlaylist, savePlaylistLibrary } from './playlistLibraryStore'
import { PLAYLIST_CHANNELS_RECORD_VERSION } from '../../core/storage/idbPlaylistChannelStore'

function channels(prefix: string, count: number): Channel[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    name: `${prefix} ${i}`,
    groupTitle: 'UK| Sports',
    sources: [{ label: 'HD', url: `http://${prefix}.example/live/u/p/${i}.ts` }],
  }))
}

function definition(overrides: Partial<PlaylistDefinition> = {}): PlaylistDefinition {
  return {
    id: 'pl-a',
    name: 'A',
    source: { type: 'xtream', server: 'https://server-a.example', username: 'ua', password: 'pa' },
    createdAt: 0,
    lastSyncedAt: 1_000,
    generationId: 'gen-a',
    channelCount: 2,
    ...overrides,
  }
}

const fileDefinition = definition({ id: 'pl-file', name: 'File', source: { type: 'file', fileName: 'x.m3u' } })

beforeEach(() => {
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
  store.clear()
  writeShouldFail = false
  loadChannelsForSource.mockReset()
  // Every test here starts from an already-migrated install, so hydration
  // exercises the library itself rather than the one-time migration (which
  // playlistMigration.test.ts covers on its own).
  markMigratedFromSinglePlaylist()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('hydratePlaylistLibrary', () => {
  it('loads every playlist’s cached channels, in library order', async () => {
    const a = definition({ id: 'pl-a' })
    const b = definition({ id: 'pl-b', name: 'B' })
    savePlaylistLibrary([a, b])
    store.set('pl-a', { version: PLAYLIST_CHANNELS_RECORD_VERSION, playlistId: 'pl-a', generationId: 'gen-a', channels: channels('a', 2) })
    store.set('pl-b', { version: PLAYLIST_CHANNELS_RECORD_VERSION, playlistId: 'pl-b', generationId: 'gen-b', channels: channels('b', 3) })

    const result = await hydratePlaylistLibrary()

    expect(result.playlists.map((p) => p.id)).toEqual(['pl-a', 'pl-b'])
    expect(result.loaded.map((l) => l.playlistId)).toEqual(['pl-a', 'pl-b'])
    expect(result.loaded[1].channels).toHaveLength(3)
    expect(result.needsRecovery).toEqual([])
  })

  it('reports a refetchable playlist with no cache for recovery, WITHOUT dropping the healthy one', async () => {
    const a = definition({ id: 'pl-a' })
    const b = definition({ id: 'pl-b', name: 'B' })
    savePlaylistLibrary([a, b])
    store.set('pl-a', { version: PLAYLIST_CHANNELS_RECORD_VERSION, playlistId: 'pl-a', generationId: 'gen-a', channels: channels('a', 2) })

    const result = await hydratePlaylistLibrary()

    expect(result.loaded.map((l) => l.playlistId)).toEqual(['pl-a'])
    expect(result.needsRecovery.map((p) => p.id)).toEqual(['pl-b'])
    expect(result.unrecoverableFiles).toEqual([])
  })

  it('a cached FILE playlist and an Xtream playlist coexist — one unavailable source never destroys the other', async () => {
    savePlaylistLibrary([fileDefinition, definition({ id: 'pl-a' })])
    store.set('pl-file', {
      version: PLAYLIST_CHANNELS_RECORD_VERSION,
      playlistId: 'pl-file',
      generationId: 'gen-f',
      channels: channels('f', 2),
    })

    const result = await hydratePlaylistLibrary()

    expect(result.loaded.map((l) => l.playlistId)).toEqual(['pl-file'])
    expect(result.needsRecovery.map((p) => p.id)).toEqual(['pl-a'])
    expect(result.unrecoverableFiles).toEqual([])
  })

  it('reports a file playlist with no cache as unrecoverable rather than pretending it can be refetched', async () => {
    savePlaylistLibrary([fileDefinition])
    const result = await hydratePlaylistLibrary()
    expect(result.unrecoverableFiles.map((p) => p.id)).toEqual(['pl-file'])
    expect(result.needsRecovery).toEqual([])
  })

  it('is empty and quiet when nothing is connected', async () => {
    await expect(hydratePlaylistLibrary()).resolves.toMatchObject({ playlists: [], loaded: [], needsRecovery: [] })
  })

  it('prunes channel records no library entry points at (left behind by an external storage reset)', async () => {
    savePlaylistLibrary([definition({ id: 'pl-a' })])
    store.set('pl-a', { version: PLAYLIST_CHANNELS_RECORD_VERSION, playlistId: 'pl-a', generationId: 'g', channels: channels('a', 1) })
    store.set('pl-orphan', { version: PLAYLIST_CHANNELS_RECORD_VERSION, playlistId: 'pl-orphan', generationId: 'g', channels: channels('o', 1) })

    await hydratePlaylistLibrary()
    // Pruning is deliberately not awaited by hydration; let its microtasks run.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect([...store.keys()]).toEqual(['pl-a'])
  })
})

describe('syncPlaylist', () => {
  it('replaces only the target playlist’s cached channels, and stamps its provenance', async () => {
    store.set('pl-a', { version: PLAYLIST_CHANNELS_RECORD_VERSION, playlistId: 'pl-a', generationId: 'gen-a', channels: channels('a', 2) })
    store.set('pl-b', { version: PLAYLIST_CHANNELS_RECORD_VERSION, playlistId: 'pl-b', generationId: 'gen-b', channels: channels('b', 2) })
    loadChannelsForSource.mockResolvedValue(channels('fresh', 5))

    const result = await syncPlaylist(definition({ id: 'pl-b', name: 'B' }))

    expect(result.playlist.channelCount).toBe(5)
    expect(result.playlist.generationId).not.toBe('gen-b')
    expect(result.playlist.lastSyncedAt).not.toBeNull()
    expect(store.get('pl-b')!.channels).toHaveLength(5)
    expect(store.get('pl-b')!.channels[0].sources[0].playlistId).toBe('pl-b')
    // A untouched.
    expect(store.get('pl-a')!.channels).toHaveLength(2)
    expect(store.get('pl-a')!.generationId).toBe('gen-a')
  })

  it('a failed fetch throws BEFORE anything is cleared — old channels, cache and credentials all survive', async () => {
    const before = { version: PLAYLIST_CHANNELS_RECORD_VERSION, playlistId: 'pl-a', generationId: 'gen-a', channels: channels('a', 2) }
    store.set('pl-a', before)
    loadChannelsForSource.mockRejectedValue(new Error('network down'))

    await expect(syncPlaylist(definition())).rejects.toThrow('network down')

    expect(store.get('pl-a')).toEqual(before)
  })

  it('refuses to resync a file playlist rather than silently doing nothing', async () => {
    await expect(syncPlaylist(fileDefinition)).rejects.toThrow(/needs the file again/)
    expect(loadChannelsForSource).not.toHaveBeenCalled()
  })
})

describe('commitPlaylistChannels', () => {
  it('still returns a usable playlist when the (large) channel write fails — the session keeps working', async () => {
    writeShouldFail = true
    const result = await commitPlaylistChannels(definition(), definition().source, channels('a', 3))
    expect(result.channels).toHaveLength(3)
    expect(result.playlist.channelCount).toBe(3)
    expect(store.has('pl-a')).toBe(false)
  })

  it('records the NEW source when a connection edit succeeds, keeping the same playlist id', async () => {
    const newSource = { type: 'xtream' as const, server: 'https://server-new.example', username: 'un', password: 'pn' }
    const result = await commitPlaylistChannels(definition(), newSource, channels('a', 1))
    expect(result.playlist.id).toBe('pl-a')
    expect(result.playlist.source).toEqual(newSource)
  })
})

describe('deletePlaylistChannels', () => {
  it('removes only the named playlist’s record', async () => {
    store.set('pl-a', { version: PLAYLIST_CHANNELS_RECORD_VERSION, playlistId: 'pl-a', generationId: 'g', channels: channels('a', 1) })
    store.set('pl-b', { version: PLAYLIST_CHANNELS_RECORD_VERSION, playlistId: 'pl-b', generationId: 'g', channels: channels('b', 1) })
    await deletePlaylistChannels('pl-a')
    expect([...store.keys()]).toEqual(['pl-b'])
  })
})
