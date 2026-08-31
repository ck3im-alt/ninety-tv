// The reset policy: which stores each scope touches, and in what order.
//
// The defect this exists to prevent is specific and was live before this
// module: the previous reset (the dev AdminPanel's) cleared localStorage
// only, so the entire cached channel library survived a "reset" inside
// IndexedDB. Every test below that names IndexedDB is guarding that.
//
// Both IndexedDB stores are mocked — same vi.mock idiom session.test.ts
// already uses for clearPlaylist — because jsdom has no IndexedDB and the
// contract under test is "which clears are called, and does a failure stop
// the wipe", not the databases' own mechanics.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeLocalStorage } from '../core/storage/testFakeLocalStorage'

const idbClearChannels = vi.fn()
vi.mock('../core/storage/idbChannelStore', () => ({
  idbClearChannels: (...args: unknown[]) => idbClearChannels(...args),
}))

const clearAllPlaylistChannels = vi.fn()
vi.mock('../core/storage/idbPlaylistChannelStore', () => ({
  clearAllPlaylistChannels: (...args: unknown[]) => clearAllPlaylistChannels(...args),
}))

const { PRESERVED_PLAYLIST_STORAGE_KEYS, resetAppData } = await import('./resetAppData')

// A representative slice of everything the app persists, so "clears
// everything" is asserted against real key names rather than a token pair.
const ALL_KEYS = {
  'ninety.onboardingComplete': 'true',
  'ninety.sportPreferences': '{}',
  'ninety.favoriteChannels': '[]',
  'ninety.favoriteCategories': '[]',
  'ninety.channelFilters': '{}',
  'ninety.recentlyWatched': '[]',
  'ninety.watchAffinity': '{}',
  'ninety.knownTeams': '[]',
  'ninety.channelCatalog': '{}',
  'ninety.playlist.source': '{}',
  'ninety.playlist.channels': '[]',
  'ninety.playlists': '[]',
  'ninety.playlists.migratedFromSingle': 'true',
}

// Tests run in Node, not jsdom — localStorage is not a global here, so it
// is stubbed the same way session.test.ts does it.
function seedStorage(): void {
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
  for (const [key, value] of Object.entries(ALL_KEYS)) localStorage.setItem(key, value)
  // Something belonging to another app sharing the origin — a reset must
  // never be a blanket localStorage.clear().
  localStorage.setItem('someOtherApp.token', 'keep-me')
}

function remainingNinetyKeys(): string[] {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith('ninety.'))
    .sort()
}

beforeEach(() => {
  seedStorage()
  idbClearChannels.mockReset().mockResolvedValue(true)
  clearAllPlaylistChannels.mockReset().mockResolvedValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("resetAppData('everything')", () => {
  it('clears every key the app wrote', async () => {
    await resetAppData('everything')
    expect(remainingNinetyKeys()).toEqual([])
  })

  it('empties BOTH IndexedDB databases, not just the legacy one', async () => {
    // The whole point of this module. 'ninety-tv-channels' holds the legacy
    // single-playlist cache; 'ninety-tv-playlist-channels' holds the
    // per-playlist library records. A migrated build still has both on disk.
    await resetAppData('everything')
    expect(idbClearChannels).toHaveBeenCalledTimes(1)
    expect(clearAllPlaylistChannels).toHaveBeenCalledTimes(1)
  })

  it('leaves storage belonging to anything else on the origin alone', async () => {
    await resetAppData('everything')
    expect(localStorage.getItem('someOtherApp.token')).toBe('keep-me')
  })

  it('reports success', async () => {
    await expect(resetAppData('everything')).resolves.toBe(true)
  })
})

describe("resetAppData('everything') when storage refuses", () => {
  // Ordering is load-bearing: the caller reloads the page on success, and
  // reloading into a half-cleared app is worse than not resetting at all.
  it('does not touch localStorage when the channel cache fails to clear', async () => {
    idbClearChannels.mockResolvedValue(false)

    await expect(resetAppData('everything')).resolves.toBe(false)
    // Nothing destroyed — the app is still coherent and the caller can say so.
    expect(remainingNinetyKeys()).toEqual(Object.keys(ALL_KEYS).sort())
  })

  it('does not touch localStorage when the playlist library fails to clear', async () => {
    clearAllPlaylistChannels.mockResolvedValue(false)

    await expect(resetAppData('everything')).resolves.toBe(false)
    expect(remainingNinetyKeys()).toEqual(Object.keys(ALL_KEYS).sort())
  })
})

describe("resetAppData('onboarding')", () => {
  it('keeps exactly the keys that say which playlist is connected', async () => {
    await resetAppData('onboarding')
    expect(remainingNinetyKeys()).toEqual([...PRESERVED_PLAYLIST_STORAGE_KEYS].sort())
  })

  it('clears the onboarding flag, so the app reloads into setup', async () => {
    await resetAppData('onboarding')
    // resolveInitialScreen opens onboarding whenever this is absent — this
    // is the single key that makes the reload land in the right place.
    expect(localStorage.getItem('ninety.onboardingComplete')).toBeNull()
  })

  it('clears the viewer choices, including derived personalization', async () => {
    await resetAppData('onboarding')
    for (const key of ['ninety.sportPreferences', 'ninety.favoriteChannels', 'ninety.favoriteCategories', 'ninety.channelFilters', 'ninety.recentlyWatched', 'ninety.watchAffinity', 'ninety.knownTeams']) {
      expect(localStorage.getItem(key)).toBeNull()
    }
  })

  it('never touches IndexedDB — the cached channels belong to the kept playlist', async () => {
    await resetAppData('onboarding')
    expect(idbClearChannels).not.toHaveBeenCalled()
    expect(clearAllPlaylistChannels).not.toHaveBeenCalled()
  })

  it('leaves the playlist re-usable without re-entering credentials', async () => {
    await resetAppData('onboarding')
    // The point of this scope: the testing loop re-walks onboarding without
    // retyping Xtream credentials or re-downloading 30k channels.
    expect(localStorage.getItem('ninety.playlist.source')).toBe('{}')
    expect(localStorage.getItem('ninety.playlists')).toBe('[]')
  })

  it('keeps the migration marker with the library it belongs to', async () => {
    // Dropping this while keeping the library would re-run the single ->
    // library migration against an already-absorbed source record.
    await resetAppData('onboarding')
    expect(localStorage.getItem('ninety.playlists.migratedFromSingle')).toBe('true')
  })

  it('reports success', async () => {
    await expect(resetAppData('onboarding')).resolves.toBe(true)
  })
})

describe('the preserved-key list', () => {
  // A guard against the list drifting silently: these four are the only
  // keys any scope is allowed to keep, and each one is a playlist
  // CONNECTION, never a preference.
  it('names only playlist-connection keys', () => {
    expect([...PRESERVED_PLAYLIST_STORAGE_KEYS].sort()).toEqual([
      'ninety.playlist.channels',
      'ninety.playlist.source',
      'ninety.playlists',
      'ninety.playlists.migratedFromSingle',
    ])
  })
})
