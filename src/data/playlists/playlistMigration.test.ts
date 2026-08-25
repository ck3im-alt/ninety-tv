// Backward compatibility for every existing Ninety install. A user who has
// one playlist today must boot after this update with exactly one playlist,
// their cached channels intact, and nothing else about their install
// disturbed — no re-onboarding, no lost favorites, no lost filters.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { makeFakeLocalStorage } from '../../core/storage/testFakeLocalStorage'
import { migrateSinglePlaylistIfNeeded } from './playlistMigration'
import { PLAYLIST_CHANNELS_RECORD_VERSION, type StoredPlaylistChannelsRecord } from '../../core/storage/idbPlaylistChannelStore'
import * as session from '../session'
import * as libraryStore from './playlistLibraryStore'
import type { Channel } from '../channel'
import type { PlaylistSourceRecord } from '../session'

const xtreamSource: PlaylistSourceRecord = { type: 'xtream', server: 'https://panel.example', username: 'u', password: 'p' }
const m3uUrlSource: PlaylistSourceRecord = { type: 'm3u-url', url: 'https://lists.example/playlist.m3u' }
const fileSource: PlaylistSourceRecord = { type: 'file', fileName: 'living-room.m3u' }

function legacyChannels(): Channel[] {
  return [
    { id: 'ch0', name: 'Channel 0', groupTitle: 'UK| Sports', sources: [{ label: 'HD', url: 'http://a/0.ts' }] },
    { id: 'ch1', name: 'Channel 1', groupTitle: 'UK| News', sources: [{ label: 'HD', url: 'http://a/1.ts' }] },
  ]
}

let written: StoredPlaylistChannelsRecord[]
let legacyCleared: number

// The one-time migration reads the legacy IndexedDB record and writes the
// new per-playlist one. Both are injected so this is a test of the
// migration's ORDERING and outcomes, not of IndexedDB (which has no engine
// in this environment — see idb.test.ts).
function deps(overrides: Parameters<typeof migrateSinglePlaylistIfNeeded>[0] = {}) {
  return {
    readLegacyChannels: async () => null,
    clearLegacyChannels: async () => {
      legacyCleared += 1
      return true
    },
    writeChannels: async (record: StoredPlaylistChannelsRecord) => {
      written.push(record)
      return true
    },
    now: () => 1_700_000_000_000,
    newId: () => 'pl-migrated',
    newGenerationId: () => 'gen-new',
    ...overrides,
  }
}

// Every module under test reads localStorage at call time (never captured
// at import), so stubbing the global per test is full isolation — no module
// reset needed.
beforeEach(() => {
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
  written = []
  legacyCleared = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('migrateSinglePlaylistIfNeeded', () => {
  it('migrates an existing singular Xtream source + valid cache into exactly one playlist', async () => {
    session.saveSource(xtreamSource)
    const result = await migrateSinglePlaylistIfNeeded(
      deps({
        readLegacyChannels: async () => ({
          version: session.PLAYLIST_CHANNELS_SCHEMA_VERSION,
          generationId: 'gen-legacy',
          channels: legacyChannels(),
        }),
      }),
    )

    expect(result.kind).toBe('migrated')
    const library = libraryStore.loadPlaylistLibrary()
    expect(library).toHaveLength(1)
    expect(library[0]).toMatchObject({ id: 'pl-migrated', source: xtreamSource, channelCount: 2 })
    // The legacy generation is CARRIED OVER, not regenerated — the channels
    // are literally the same data, so invalidating the identity-resolution
    // cache keyed off it would cost a multi-second re-resolve for nothing.
    expect(library[0].generationId).toBe('gen-legacy')
  })

  it('stamps the carried-over channels with the new playlist id, so provenance has no legacy special case', async () => {
    session.saveSource(xtreamSource)
    const result = await migrateSinglePlaylistIfNeeded(
      deps({
        readLegacyChannels: async () => ({
          version: session.PLAYLIST_CHANNELS_SCHEMA_VERSION,
          generationId: 'gen-legacy',
          channels: legacyChannels(),
        }),
      }),
    )

    expect(result).toMatchObject({ kind: 'migrated' })
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ version: PLAYLIST_CHANNELS_RECORD_VERSION, playlistId: 'pl-migrated' })
    expect(written[0].channels.flatMap((c) => c.sources.map((s) => s.playlistId))).toEqual(['pl-migrated', 'pl-migrated'])
  })

  it('migrates an existing singular M3U URL source', async () => {
    session.saveSource(m3uUrlSource)
    await migrateSinglePlaylistIfNeeded(deps())
    expect(libraryStore.loadPlaylistLibrary()[0]).toMatchObject({ source: m3uUrlSource, name: 'lists.example' })
  })

  it('migrates an existing file source + its cache, keeping the file metadata', async () => {
    session.saveSource(fileSource)
    await migrateSinglePlaylistIfNeeded(
      deps({
        readLegacyChannels: async () => ({
          version: session.PLAYLIST_CHANNELS_SCHEMA_VERSION,
          generationId: 'gen-legacy',
          channels: legacyChannels(),
        }),
      }),
    )
    const library = libraryStore.loadPlaylistLibrary()
    expect(library[0]).toMatchObject({ source: fileSource, name: 'living-room', channelCount: 2 })
  })

  it('migrates a source with NO valid cache — recoverable later, but nothing is written to the channel store', async () => {
    session.saveSource(xtreamSource)
    const result = await migrateSinglePlaylistIfNeeded(deps())
    expect(result).toMatchObject({ kind: 'migrated', channels: null })
    expect(written).toHaveLength(0)
    expect(libraryStore.loadPlaylistLibrary()[0]).toMatchObject({ lastSyncedAt: null, channelCount: 0 })
  })

  it('treats a stale-versioned legacy cache as absent rather than carrying over invalid channels', async () => {
    session.saveSource(xtreamSource)
    const result = await migrateSinglePlaylistIfNeeded(
      deps({ readLegacyChannels: async () => ({ version: 1, generationId: 'old', channels: legacyChannels() }) }),
    )
    expect(result).toMatchObject({ kind: 'migrated', channels: null })
    expect(written).toHaveLength(0)
  })

  it('is idempotent — a second run reads nothing and changes nothing', async () => {
    session.saveSource(xtreamSource)
    await migrateSinglePlaylistIfNeeded(deps())
    const afterFirst = libraryStore.loadPlaylistLibrary()

    const readLegacyChannels = vi.fn(async () => null)
    const second = await migrateSinglePlaylistIfNeeded(deps({ readLegacyChannels }))

    expect(second).toEqual({ kind: 'already-migrated' })
    expect(readLegacyChannels).not.toHaveBeenCalled()
    expect(libraryStore.loadPlaylistLibrary()).toEqual(afterFirst)
  })

  it('does not resurrect a playlist the user removed after migrating — the marker is what stops it', async () => {
    session.saveSource(xtreamSource)
    await migrateSinglePlaylistIfNeeded(deps())
    // User removes their last playlist. The legacy source record is still
    // sitting in localStorage; without the migration marker the next launch
    // would helpfully "restore" what they just deleted.
    libraryStore.savePlaylistLibrary([])

    await migrateSinglePlaylistIfNeeded(deps())
    expect(libraryStore.loadPlaylistLibrary()).toEqual([])
  })

  it('an empty previous install stays empty, and records that it has been checked', async () => {
    const result = await migrateSinglePlaylistIfNeeded(deps())
    expect(result).toEqual({ kind: 'nothing-to-migrate' })
    expect(libraryStore.loadPlaylistLibrary()).toEqual([])
    expect(libraryStore.hasMigratedFromSinglePlaylist()).toBe(true)
  })

  it('carries over a valid cache even when the source record is gone, rather than throwing the channels away', async () => {
    const result = await migrateSinglePlaylistIfNeeded(
      deps({
        readLegacyChannels: async () => ({
          version: session.PLAYLIST_CHANNELS_SCHEMA_VERSION,
          generationId: 'gen-legacy',
          channels: legacyChannels(),
        }),
      }),
    )
    expect(result.kind).toBe('migrated')
    // Recorded as a file-shaped source: the one type that honestly says
    // "this cannot be refetched automatically".
    expect(libraryStore.loadPlaylistLibrary()[0].source).toEqual({ type: 'file', fileName: 'Saved playlist' })
  })

  it('leaves everything legacy intact and stays un-migrated when the channel write fails', async () => {
    session.saveSource(xtreamSource)
    const result = await migrateSinglePlaylistIfNeeded(
      deps({
        readLegacyChannels: async () => ({
          version: session.PLAYLIST_CHANNELS_SCHEMA_VERSION,
          generationId: 'gen-legacy',
          channels: legacyChannels(),
        }),
        writeChannels: async () => false,
      }),
    )

    expect(result.kind).toBe('failed')
    expect(libraryStore.loadPlaylistLibrary()).toEqual([])
    expect(libraryStore.hasMigratedFromSinglePlaylist()).toBe(false)
    expect(session.loadPlaylistSource()).toEqual(xtreamSource)
    expect(legacyCleared).toBe(0)
  })

  it('only releases the legacy channel cache AFTER the new representation is proven written', async () => {
    session.saveSource(xtreamSource)
    await migrateSinglePlaylistIfNeeded(
      deps({
        readLegacyChannels: async () => ({
          version: session.PLAYLIST_CHANNELS_SCHEMA_VERSION,
          generationId: 'gen-legacy',
          channels: legacyChannels(),
        }),
      }),
    )
    expect(written).toHaveLength(1)
    expect(legacyCleared).toBe(1)
  })

  it('leaves preferences, filters, favorites and recently-watched completely untouched', async () => {
    const preferences = await import('../preferences')
    preferences.savePreferences({
      sports: ['football'],
      footballLeagueIds: ['football_premier_league'],
      favoriteCountries: ['Norway', 'Sweden'],
      streamType: 'tv',
    })
    preferences.markOnboardingComplete()
    session.saveFilters(new Set(['Germany']), new Set(['Norway::Movies']))
    session.saveFavoriteChannels(new Set(['ch0']))
    session.saveFavoriteCategories(new Set(['Norway::Sports']))
    session.saveRecentlyWatched(['ch1', 'ch0'])
    session.saveSource(xtreamSource)

    await migrateSinglePlaylistIfNeeded(deps())

    expect(preferences.loadPreferences()).toEqual({
      sports: ['football'],
      footballLeagueIds: ['football_premier_league'],
      favoriteCountries: ['Norway', 'Sweden'],
      streamType: 'tv',
    })
    expect(preferences.hasCompletedOnboarding()).toBe(true)
    expect(session.loadFilters()).toEqual({ hiddenCountries: ['Germany'], hiddenCategories: ['Norway::Movies'] })
    expect(session.loadFavoriteChannels()).toEqual(new Set(['ch0']))
    expect(session.loadFavoriteCategories()).toEqual(new Set(['Norway::Sports']))
    expect(session.loadRecentlyWatched()).toEqual(['ch1', 'ch0'])
  })
})
