// A PRE-UPDATE install opening the new app, driven through the same
// entry point production uses (hydratePlaylistLibrary) rather than by
// calling the migration directly — playlistMigration.test.ts already covers
// the migration's own ordering and failure modes in isolation.
//
// The scenario, in order, because the interesting failures are all about
// sequence rather than any single step:
//   launch 1  -> exactly one playlist appears, with the user's cached
//                channels, now carrying playlist provenance
//   launch 2  -> no second migration, no duplicate playlist
//   remove it -> and launch 3 must NOT resurrect it from the legacy record
//                that is deliberately still sitting in localStorage
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeLocalStorage } from '../../core/storage/testFakeLocalStorage'
import type { StoredPlaylistChannelsRecord } from '../../core/storage/idbPlaylistChannelStore'
import type { StoredChannelsRecord } from '../../core/storage/idbChannelStore'

// The new per-playlist store.
const store = new Map<string, StoredPlaylistChannelsRecord>()
vi.mock('../../core/storage/idbPlaylistChannelStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/storage/idbPlaylistChannelStore')>()
  return {
    ...actual,
    readPlaylistChannels: async (id: string) => store.get(id) ?? null,
    writePlaylistChannels: async (record: StoredPlaylistChannelsRecord) => {
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

// The LEGACY single-record store the migration reads exactly once.
let legacyRecord: StoredChannelsRecord | null = null
vi.mock('../../core/storage/idbChannelStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/storage/idbChannelStore')>()
  return {
    ...actual,
    idbReadChannels: async () => legacyRecord,
    idbClearChannels: async () => {
      legacyRecord = null
      return true
    },
  }
})

import { hydratePlaylistLibrary, deletePlaylistChannels, persistLibrary } from './playlistLibrary'
import { loadPlaylistLibrary } from './playlistLibraryStore'
import { PLAYLIST_CHANNELS_SCHEMA_VERSION, saveSource, saveFavoriteChannels, loadFavoriteChannels } from '../session'
import { savePreferences, loadPreferences, markOnboardingComplete, hasCompletedOnboarding } from '../preferences'
import type { Channel } from '../channel'

function legacyChannels(): Channel[] {
  return [
    { id: 'ch0', name: 'TNT Sports 1', groupTitle: 'UK| Sports', sources: [{ label: 'HD', url: 'http://panel/0.ts' }] },
    { id: 'ch1', name: 'BBC One', groupTitle: 'UK| General', sources: [{ label: 'HD', url: 'http://panel/1.ts' }] },
  ]
}

// Everything a real pre-update install has on disk the moment before it
// first runs this build.
function seedPreUpdateInstall() {
  saveSource({ type: 'xtream', server: 'https://panel.example', username: 'u', password: 'p' })
  legacyRecord = { version: PLAYLIST_CHANNELS_SCHEMA_VERSION, generationId: 'gen-legacy', channels: legacyChannels() }
  savePreferences({
    sports: ['football'],
    footballLeagueIds: ['football_premier_league'],
    favoriteCountries: ['United Kingdom'],
    streamType: 'tv',
    favoriteTeamIds: [],
    homeContentMode: 'all',
  })
  markOnboardingComplete()
  saveFavoriteChannels(new Set(['ch0']))
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
  store.clear()
  legacyRecord = null
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a pre-update install opening the new app', () => {
  it('lands on exactly one playlist holding the channels it already had', async () => {
    seedPreUpdateInstall()

    const first = await hydratePlaylistLibrary()

    expect(first.playlists).toHaveLength(1)
    expect(first.playlists[0].source).toEqual({
      type: 'xtream',
      server: 'https://panel.example',
      username: 'u',
      password: 'p',
    })
    expect(first.needsRecovery).toEqual([])
    expect(first.unrecoverableFiles).toEqual([])
    expect(first.loaded[0].channels.map((c) => c.name)).toEqual(['TNT Sports 1', 'BBC One'])
  })

  it('stamps the carried-over channels, so nothing downstream sees an untagged legacy source', async () => {
    seedPreUpdateInstall()
    const { playlists, loaded } = await hydratePlaylistLibrary()
    const stamped = loaded[0].channels.flatMap((c) => c.sources.map((s) => s.playlistId))
    expect(stamped).toEqual([playlists[0].id, playlists[0].id])
  })

  it('disturbs nothing else about the install', async () => {
    seedPreUpdateInstall()
    await hydratePlaylistLibrary()

    expect(hasCompletedOnboarding()).toBe(true)
    expect(loadPreferences()).toEqual({
      sports: ['football'],
      footballLeagueIds: ['football_premier_league'],
      favoriteCountries: ['United Kingdom'],
      streamType: 'tv',
      favoriteTeamIds: [],
      homeContentMode: 'all',
    })
    expect(loadFavoriteChannels()).toEqual(new Set(['ch0']))
  })

  it('does not migrate a second time on the next launch', async () => {
    seedPreUpdateInstall()
    const first = await hydratePlaylistLibrary()
    const second = await hydratePlaylistLibrary()

    expect(second.playlists).toHaveLength(1)
    expect(second.playlists[0].id).toBe(first.playlists[0].id)
    expect(second.loaded[0].channels).toHaveLength(2)
    expect(loadPlaylistLibrary()).toHaveLength(1)
  })

  it('does NOT resurrect the playlist after the user removes it, even though the legacy source record survives', async () => {
    seedPreUpdateInstall()
    const { playlists } = await hydratePlaylistLibrary()

    // Exactly what removePlaylist does: drop the channel record, then the
    // library entry.
    await deletePlaylistChannels(playlists[0].id)
    persistLibrary([])

    const afterRemoval = await hydratePlaylistLibrary()
    expect(afterRemoval.playlists).toEqual([])
    expect(afterRemoval.loaded).toEqual([])
    expect(afterRemoval.needsRecovery).toEqual([])
    // Onboarding is a separate concern from having a playlist — an empty
    // library must never send an existing user back through first-run.
    expect(hasCompletedOnboarding()).toBe(true)
  })
})
