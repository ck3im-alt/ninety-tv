import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeLocalStorage } from '../core/storage/testFakeLocalStorage'
import type { Channel } from './channel'
import type { XtreamSourceRecord } from './session'

const xtreamSource: XtreamSourceRecord = { type: 'xtream', server: 'https://example.com', username: 'u', password: 'p' }

function makeChannels(count: number): Channel[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ch${i}`,
    name: `Channel ${i}`,
    groupTitle: 'News',
    sources: [{ label: 'HD', url: `https://stream.example.com/${i}.m3u8` }],
  }))
}

// Covers what remains of this module after multi-playlist landed: the
// legacy source record (still read by the one-time migration), the Channels
// filter/favorites/recently-watched keys, and clearPlaylist's ordering
// guarantees. The connected playlist itself moved to data/playlists/ and is
// covered by that directory's own tests.
//
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

// The multi-playlist channel store clearPlaylist now also has to empty —
// same reason as above: no real IndexedDB engine in this environment.
const clearAllPlaylistChannels = vi.fn()
vi.mock('../core/storage/idbPlaylistChannelStore', () => ({
  clearAllPlaylistChannels: (...args: unknown[]) => clearAllPlaylistChannels(...args),
}))

let session: typeof import('./session')

beforeEach(async () => {
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
  idbReadChannels.mockReset().mockResolvedValue(null)
  idbWriteChannels.mockReset().mockResolvedValue(true)
  idbClearChannels.mockReset().mockResolvedValue(true)
  clearAllPlaylistChannels.mockReset().mockResolvedValue(true)
  session = await import('./session')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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
    expect(session.loadPlaylistSource()).toEqual(xtreamSource)
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

describe('serialized size of a realistic-scale channel cache (documents the risk the IndexedDB migration exists to remove)', () => {
  it('stays within an order of magnitude of typical localStorage quotas — the exact risk no longer applies since this data now lives in IndexedDB, not localStorage', () => {
    const channels = makeChannels(20_000)
    const bytes = new Blob([JSON.stringify(channels)]).size
    expect(bytes).toBeLessThan(10 * 1024 * 1024)
  })
})
