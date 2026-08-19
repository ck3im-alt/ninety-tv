import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeLocalStorage } from '../core/storage/testFakeLocalStorage'
import type { Channel } from './channel'
import type { FileSourceRecord, M3uUrlSourceRecord, XtreamSourceRecord } from './session'

const xtreamSource: XtreamSourceRecord = { type: 'xtream', server: 'https://example.com', username: 'u', password: 'p' }
const m3uUrlSource: M3uUrlSourceRecord = { type: 'm3u-url', url: 'https://example.com/playlist.m3u' }
const fileSource: FileSourceRecord = { type: 'file', fileName: 'my-playlist.m3u' }

function makeChannels(count: number): Channel[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ch${i}`,
    name: `Channel ${i}`,
    groupTitle: 'News',
    sources: [{ label: 'HD', url: `https://stream.example.com/${i}.m3u8` }],
  }))
}

// The channel cache now lives in IndexedDB (see idbChannelStore.ts) — mocked
// here (same vi.mock idiom playlistRecovery.test.ts already uses for its own
// I/O boundaries) so session.ts's orchestration logic (ordering, outcome
// selection, exactly-what-gets-called-when) can be tested without a real
// IndexedDB engine. idbChannelStore.test.ts separately covers the wrapper
// functions themselves against an injected fake store, and idb.test.ts
// covers the "IndexedDB unavailable" degradation path.
const idbReadChannels = vi.fn()
const idbWriteChannels = vi.fn()
const idbClearChannels = vi.fn()
vi.mock('../core/storage/idbChannelStore', () => ({
  idbReadChannels: (...args: unknown[]) => idbReadChannels(...args),
  idbWriteChannels: (...args: unknown[]) => idbWriteChannels(...args),
  idbClearChannels: (...args: unknown[]) => idbClearChannels(...args),
}))

let session: typeof import('./session')

beforeEach(async () => {
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
  idbReadChannels.mockReset().mockResolvedValue(null)
  idbWriteChannels.mockReset().mockResolvedValue(true)
  idbClearChannels.mockReset().mockResolvedValue(true)
  session = await import('./session')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('hydratePlaylistState', () => {
  it('returns "ready" with channels + generationId from IndexedDB when the cache is valid', async () => {
    session.saveSource(xtreamSource)
    idbReadChannels.mockResolvedValue({
      version: session.PLAYLIST_CHANNELS_SCHEMA_VERSION,
      generationId: 'gen-1',
      channels: makeChannels(3),
    })
    await expect(session.hydratePlaylistState()).resolves.toEqual({
      kind: 'ready',
      channels: makeChannels(3),
      generationId: 'gen-1',
      source: xtreamSource,
    })
  })

  it('returns "ready" with a null source when only channels were ever recorded', async () => {
    idbReadChannels.mockResolvedValue({ version: session.PLAYLIST_CHANNELS_SCHEMA_VERSION, generationId: 'gen-1', channels: makeChannels(1) })
    await expect(session.hydratePlaylistState()).resolves.toEqual({
      kind: 'ready',
      channels: makeChannels(1),
      generationId: 'gen-1',
      source: null,
    })
  })

  it('returns "no-source" when nothing has ever been saved', async () => {
    await expect(session.hydratePlaylistState()).resolves.toEqual({ kind: 'no-source' })
  })

  it('returns "recovering" for an Xtream source with a missing IndexedDB cache', async () => {
    session.saveSource(xtreamSource)
    await expect(session.hydratePlaylistState()).resolves.toEqual({ kind: 'recovering', source: xtreamSource })
  })

  it('returns "recovering" for an M3U-URL source with a missing IndexedDB cache', async () => {
    session.saveSource(m3uUrlSource)
    await expect(session.hydratePlaylistState()).resolves.toEqual({ kind: 'recovering', source: m3uUrlSource })
  })

  it('returns "recovering" when the cached channel record is a stale schema version', async () => {
    session.saveSource(xtreamSource)
    idbReadChannels.mockResolvedValue({ version: 0, generationId: 'gen-1', channels: makeChannels(2) })
    await expect(session.hydratePlaylistState()).resolves.toEqual({ kind: 'recovering', source: xtreamSource })
  })

  it('returns "unrecoverable-file-source" for a file source with no valid cache', async () => {
    session.saveSource(fileSource)
    await expect(session.hydratePlaylistState()).resolves.toEqual({ kind: 'unrecoverable-file-source', source: fileSource })
  })

  it('treats a stale-versioned source record as fully absent -> "no-source"', async () => {
    session.saveSource(xtreamSource)
    const raw = JSON.parse(localStorage.getItem('ninety.playlist.source')!)
    raw.version = 0
    localStorage.setItem('ninety.playlist.source', JSON.stringify(raw))
    await expect(session.hydratePlaylistState()).resolves.toEqual({ kind: 'no-source' })
  })

  it('never inspects localStorage for the channel cache — reads it exclusively via idbReadChannels', async () => {
    await session.hydratePlaylistState()
    expect(idbReadChannels).toHaveBeenCalledTimes(1)
  })
})

describe('source record isolation', () => {
  it('persists the source separately from the channel cache, and never embeds channel/stream data', () => {
    session.saveSource(xtreamSource)
    const raw = localStorage.getItem('ninety.playlist.source')!
    expect(raw).not.toContain('"channels"')
    expect(raw).not.toContain('stream.example.com')
    expect(JSON.parse(raw).source).toEqual(xtreamSource)
  })
})

describe('savePlaylistChannels', () => {
  it('writes to IndexedDB with the current schema version, generationId, and channels', async () => {
    const channels = makeChannels(4)
    await expect(session.savePlaylistChannels(channels, 'gen-42')).resolves.toBe(true)
    expect(idbWriteChannels).toHaveBeenCalledWith({
      version: session.PLAYLIST_CHANNELS_SCHEMA_VERSION,
      generationId: 'gen-42',
      channels,
    })
  })

  it('reports failure without throwing when the IndexedDB write fails', async () => {
    idbWriteChannels.mockResolvedValue(false)
    await expect(session.savePlaylistChannels(makeChannels(1), 'gen-1')).resolves.toBe(false)
  })
})

describe('clearPlaylist — IndexedDB cleared first, ordering is load-bearing', () => {
  it('clears IndexedDB before touching any localStorage key', async () => {
    const callOrder: string[] = []
    idbClearChannels.mockImplementation(async () => {
      callOrder.push('idb-clear')
      return true
    })
    session.saveSource(xtreamSource)
    const realRemoveItem = localStorage.removeItem.bind(localStorage)
    vi.spyOn(localStorage, 'removeItem').mockImplementation((key: string) => {
      callOrder.push(`localStorage-remove:${key}`)
      realRemoveItem(key)
    })

    await session.clearPlaylist()

    expect(callOrder[0]).toBe('idb-clear')
    expect(callOrder).toContain('localStorage-remove:ninety.playlist.source')
  })

  it('returns true and removes the source key on full success', async () => {
    session.saveSource(xtreamSource)
    await expect(session.clearPlaylist()).resolves.toBe(true)
    expect(localStorage.getItem('ninety.playlist.source')).toBeNull()
  })

  it('a failed IndexedDB clear stops immediately and leaves the source record intact — must not partially destroy playlist state', async () => {
    idbClearChannels.mockResolvedValue(false)
    session.saveSource(xtreamSource)

    await expect(session.clearPlaylist()).resolves.toBe(false)

    // The existing playlist must remain recoverable: the source record was
    // never touched because the IndexedDB clear failed first.
    expect(localStorage.getItem('ninety.playlist.source')).not.toBeNull()
    await expect(session.hydratePlaylistState()).resolves.toEqual({ kind: 'recovering', source: xtreamSource })
  })
})

describe('removeLegacyPlaylistChannelsCache', () => {
  it('removes only the legacy channels key, leaving the source key untouched', () => {
    localStorage.setItem('ninety.playlist.channels', '{"old":"data"}')
    session.saveSource(xtreamSource)
    session.removeLegacyPlaylistChannelsCache()
    expect(localStorage.getItem('ninety.playlist.channels')).toBeNull()
    expect(localStorage.getItem('ninety.playlist.source')).not.toBeNull()
  })

  it('is a harmless no-op when nothing legacy is stored', () => {
    expect(() => session.removeLegacyPlaylistChannelsCache()).not.toThrow()
  })
})

describe('xtreamCredsFromSource', () => {
  it('extracts credentials from an xtream source', async () => {
    expect(session.xtreamCredsFromSource(xtreamSource)).toEqual({
      server: 'https://example.com',
      username: 'u',
      password: 'p',
    })
  })

  it('returns null for m3u-url, file, and null sources', () => {
    expect(session.xtreamCredsFromSource(m3uUrlSource)).toBeNull()
    expect(session.xtreamCredsFromSource(fileSource)).toBeNull()
    expect(session.xtreamCredsFromSource(null)).toBeNull()
  })
})

describe('serialized size of a realistic-scale channel cache (documents the risk the IndexedDB migration exists to remove)', () => {
  it('stays within an order of magnitude of typical localStorage quotas — the exact risk no longer applies since this data now lives in IndexedDB, not localStorage', () => {
    const channels = makeChannels(20_000)
    const bytes = new Blob([JSON.stringify(channels)]).size
    expect(bytes).toBeLessThan(10 * 1024 * 1024)
  })
})
