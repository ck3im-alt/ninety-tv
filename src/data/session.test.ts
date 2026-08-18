import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPlaylist,
  loadPlaylistState,
  savePlaylist,
  xtreamCredsFromSource,
  type FileSourceRecord,
  type M3uUrlSourceRecord,
  type XtreamSourceRecord,
} from './session'
import { makeFakeLocalStorage } from '../core/storage/testFakeLocalStorage'
import type { Channel } from './channel'

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

beforeEach(() => {
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('savePlaylist / loadPlaylistState — ready', () => {
  it('round-trips channels and an xtream source as "ready"', () => {
    const channels = makeChannels(3)
    expect(savePlaylist(channels, xtreamSource)).toBe(true)
    expect(loadPlaylistState()).toEqual({ kind: 'ready', channels, source: xtreamSource })
  })

  it('round-trips a null source (plain M3U playlists with no recorded source) as "ready"', () => {
    const channels = makeChannels(1)
    savePlaylist(channels, null)
    expect(loadPlaylistState()).toEqual({ kind: 'ready', channels, source: null })
  })

  it('returns "no-source" when nothing has been saved', () => {
    expect(loadPlaylistState()).toEqual({ kind: 'no-source' })
  })

  it('persists the source separately from the channel cache', () => {
    savePlaylist(makeChannels(1), xtreamSource)
    expect(localStorage.getItem('ninety.playlist.source')).not.toBeNull()
    expect(localStorage.getItem('ninety.playlist.channels')).not.toBeNull()
  })

  it('never writes the merged Channel[] into the source record', () => {
    savePlaylist(makeChannels(50), xtreamSource)
    const rawSource = localStorage.getItem('ninety.playlist.source')!
    expect(rawSource).not.toContain('"channels"')
    expect(rawSource).not.toContain('stream.example.com')
    const parsed = JSON.parse(rawSource)
    expect(parsed.source).toEqual(xtreamSource)
  })
})

describe('recovery outcomes', () => {
  it('Xtream source + missing cache -> source-available-cache-missing', () => {
    // Only write the source, simulating a channel-cache write that never
    // happened (or failed) while the source write succeeded.
    savePlaylist([], xtreamSource)
    localStorage.removeItem('ninety.playlist.channels')
    expect(loadPlaylistState()).toEqual({ kind: 'source-available-cache-missing', source: xtreamSource })
  })

  it('M3U URL source + missing cache -> source-available-cache-missing', () => {
    savePlaylist([], m3uUrlSource)
    localStorage.removeItem('ninety.playlist.channels')
    expect(loadPlaylistState()).toEqual({ kind: 'source-available-cache-missing', source: m3uUrlSource })
  })

  it('stale-versioned channel cache -> source retained, reported as cache-invalid (not lost)', () => {
    savePlaylist(makeChannels(2), xtreamSource)
    const raw = JSON.parse(localStorage.getItem('ninety.playlist.channels')!)
    raw.version = 0
    localStorage.setItem('ninety.playlist.channels', JSON.stringify(raw))
    expect(loadPlaylistState()).toEqual({ kind: 'source-available-cache-invalid', source: xtreamSource })
  })

  it('stale-versioned source record is treated as absent', () => {
    savePlaylist(makeChannels(2), xtreamSource)
    const raw = JSON.parse(localStorage.getItem('ninety.playlist.source')!)
    raw.version = 0
    localStorage.setItem('ninety.playlist.source', JSON.stringify(raw))
    localStorage.removeItem('ninety.playlist.channels')
    expect(loadPlaylistState()).toEqual({ kind: 'no-source' })
  })

  it('file-upload source + missing cache -> unrecoverable-file-source, not auto-recoverable', () => {
    savePlaylist([], fileSource)
    localStorage.removeItem('ninety.playlist.channels')
    expect(loadPlaylistState()).toEqual({ kind: 'unrecoverable-file-source', source: fileSource })
  })
})

describe('storage failure', () => {
  it('reports failure without throwing when the channel cache write fails', () => {
    const fake = makeFakeLocalStorage()
    const realSetItem = fake.setItem.bind(fake)
    Object.defineProperty(fake, 'setItem', {
      value: (key: string, value: string) => {
        if (key === 'ninety.playlist.channels') throw new DOMException('quota exceeded', 'QuotaExceededError')
        realSetItem(key, value)
      },
    })
    vi.stubGlobal('localStorage', fake)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => savePlaylist(makeChannels(1), xtreamSource)).not.toThrow()
    expect(savePlaylist(makeChannels(1), xtreamSource)).toBe(false)
  })

  it('a failed channel-cache write does not lose the small source record', () => {
    const fake = makeFakeLocalStorage()
    const realSetItem = fake.setItem.bind(fake)
    Object.defineProperty(fake, 'setItem', {
      value: (key: string, value: string) => {
        if (key === 'ninety.playlist.channels') throw new DOMException('quota exceeded', 'QuotaExceededError')
        realSetItem(key, value)
      },
    })
    vi.stubGlobal('localStorage', fake)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    savePlaylist(makeChannels(500), xtreamSource)

    // The cache write failed, but the source record is still there — a
    // reload should be able to recover, not force manual re-entry.
    expect(loadPlaylistState()).toEqual({ kind: 'source-available-cache-missing', source: xtreamSource })
  })
})

describe('clearPlaylist', () => {
  it('removes both source and channel keys', () => {
    savePlaylist(makeChannels(1), xtreamSource)
    clearPlaylist()
    expect(loadPlaylistState()).toEqual({ kind: 'no-source' })
    expect(localStorage.getItem('ninety.playlist.source')).toBeNull()
    expect(localStorage.getItem('ninety.playlist.channels')).toBeNull()
  })
})

describe('xtreamCredsFromSource', () => {
  it('extracts credentials from an xtream source', () => {
    expect(xtreamCredsFromSource(xtreamSource)).toEqual({
      server: 'https://example.com',
      username: 'u',
      password: 'p',
    })
  })

  it('returns null for m3u-url, file, and null sources', () => {
    expect(xtreamCredsFromSource(m3uUrlSource)).toBeNull()
    expect(xtreamCredsFromSource(fileSource)).toBeNull()
    expect(xtreamCredsFromSource(null)).toBeNull()
  })
})

describe('serialized size (documents the actual persistence risk)', () => {
  // A real IPTV playlist can run into the tens of thousands of channels.
  // This isn't a pass/fail budget (localStorage quotas vary by browser/TV
  // firmware, commonly 5-10MB) — it's here so the shape of the risk is
  // visible in the test suite rather than only discovered on a real TV:
  // large playlists are within the same order of magnitude as typical
  // quotas, which is why savePlaylist()'s return value matters.
  it('stays within an order of magnitude of typical localStorage quotas at realistic scale', () => {
    const channels = makeChannels(20_000)
    const bytes = new Blob([JSON.stringify(channels)]).size
    // ~20k channels serializes to a few MB in this shape — comfortably
    // within a typical 5-10MB quota today, but close enough that a bigger
    // playlist or added fields could tip over it, which is the whole
    // reason savePlaylist()'s return value exists.
    expect(bytes).toBeLessThan(10 * 1024 * 1024)
  })
})
