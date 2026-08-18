import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPlaylist, loadPlaylist, savePlaylist } from './session'
import { makeFakeLocalStorage } from '../core/storage/testFakeLocalStorage'
import type { Channel } from './channel'
import type { XtreamCredentials } from './xtream/types'

const creds: XtreamCredentials = { server: 'https://example.com', username: 'u', password: 'p' }

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

describe('savePlaylist / loadPlaylist', () => {
  it('round-trips channels and creds', () => {
    const channels = makeChannels(3)
    expect(savePlaylist(channels, creds)).toBe(true)
    expect(loadPlaylist()).toEqual({ channels, xtreamCreds: creds })
  })

  it('round-trips a null xtreamCreds (plain M3U playlists)', () => {
    const channels = makeChannels(1)
    savePlaylist(channels, null)
    expect(loadPlaylist()).toEqual({ channels, xtreamCreds: null })
  })

  it('returns null when nothing has been saved', () => {
    expect(loadPlaylist()).toBeNull()
  })

  it('persists the source (creds) separately from the channel cache', () => {
    savePlaylist(makeChannels(1), creds)
    expect(localStorage.getItem('ninety.playlist.source')).not.toBeNull()
    expect(localStorage.getItem('ninety.playlist.channels')).not.toBeNull()
  })
})

describe('schema versioning', () => {
  it('treats a stale-versioned channel cache as absent', () => {
    savePlaylist(makeChannels(2), creds)
    const raw = JSON.parse(localStorage.getItem('ninety.playlist.channels')!)
    raw.version = 0
    localStorage.setItem('ninety.playlist.channels', JSON.stringify(raw))
    expect(loadPlaylist()).toBeNull()
  })

  it('treats a stale-versioned source record as absent', () => {
    savePlaylist(makeChannels(2), creds)
    const raw = JSON.parse(localStorage.getItem('ninety.playlist.source')!)
    raw.version = 0
    localStorage.setItem('ninety.playlist.source', JSON.stringify(raw))
    expect(loadPlaylist()).toBeNull()
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
    expect(() => savePlaylist(makeChannels(1), creds)).not.toThrow()
    expect(savePlaylist(makeChannels(1), creds)).toBe(false)
  })
})

describe('clearPlaylist', () => {
  it('removes both source and channel keys', () => {
    savePlaylist(makeChannels(1), creds)
    clearPlaylist()
    expect(loadPlaylist()).toBeNull()
    expect(localStorage.getItem('ninety.playlist.source')).toBeNull()
    expect(localStorage.getItem('ninety.playlist.channels')).toBeNull()
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
