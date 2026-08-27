// @vitest-environment jsdom
//
// THE FALLBACK MODE FOR PREPARE_DURING_PLAYBACK.
//
// That constant is the one setting in the freshness architecture that has
// not been measured on a physical Samsung TV: with it TRUE (the default) the
// download/parse/merge half of a sync keeps running while a stream plays,
// costing one structured clone of the resulting Channel[] on the main
// thread. If that clone turns out to be visible from the couch on real TV
// silicon, the documented remedy is to set it to FALSE — one line.
//
// This file exists so that flip is not a leap. It pins the three properties
// the fallback has to have, with the constant actually switched off:
//
//   1. nothing is fetched while playback is active,
//   2. freshness is NOT lost — leaving playback runs the staleness check
//      immediately and installs whatever the provider has added,
//   3. a person pressing Resync in Settings is still never blocked.
//
// Everything else about the coordinator is covered by
// playlistSyncCoordinator.test.tsx, which exercises the default.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeLocalStorage } from '../../core/storage/testFakeLocalStorage'
import type { StoredPlaylistChannelsRecord } from '../../core/storage/idbPlaylistChannelStore'

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

// The whole point of this file: the same coordinator, with the fetch-half
// policy flipped.
vi.mock('./playlistSyncPolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./playlistSyncPolicy')>()
  return { ...actual, PREPARE_DURING_PLAYBACK: false }
})

const providerFetches: string[] = []
let providerChannels: () => Channel[] = () => channelsFor(['A', 'B', 'C'])
vi.mock('./connectPlaylist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./connectPlaylist')>()
  return {
    ...actual,
    loadChannelsForSource: async () => {
      providerFetches.push(new Date().toISOString())
      await Promise.resolve()
      const next = providerChannels()
      if (next.length === 0) throw new actual.EmptyPlaylistError()
      return next
    },
  }
})

import { usePlaylistLibrary, type PlaylistLibrary } from './usePlaylistLibrary'
import { savePlaylistLibrary } from './playlistLibraryStore'
import { PLAYLIST_REFRESH_INTERVAL_MS } from './playlistSyncPolicy'
import { PLAYLIST_CHANNELS_RECORD_VERSION } from '../../core/storage/idbPlaylistChannelStore'
import type { Channel } from '../channel'
import type { PlaylistDefinition } from './playlistDefinition'

function channelsFor(names: string[]): Channel[] {
  return names.map((name) => ({
    id: `no||${name.toLowerCase()}`,
    name,
    groupTitle: 'NO| Sports',
    sources: [{ label: 'Default', url: `https://provider.example/${name}.ts` }],
    epgChannelIds: [`epg.${name}`],
    rawNames: [name],
    hasEpgChannelId: true,
  }))
}

const PLAYLIST: PlaylistDefinition = {
  id: 'pl-a',
  name: 'Provider A',
  source: { type: 'm3u-url', url: 'https://provider.example/get.php' },
  createdAt: 0,
  lastSyncedAt: 0,
  generationId: 'gen-cached',
  channelCount: 3,
}

function seedCachedLibrary(names = ['A', 'B', 'C']) {
  savePlaylistLibrary([{ ...PLAYLIST, channelCount: names.length }])
  store.set(PLAYLIST.id, {
    version: PLAYLIST_CHANNELS_RECORD_VERSION,
    playlistId: PLAYLIST.id,
    generationId: 'gen-cached',
    channels: channelsFor(names),
  })
}

interface Harness {
  library: () => PlaylistLibrary
  channelNames: () => string[]
}

function renderLibrary(): Harness {
  let latest: PlaylistLibrary | null = null
  function Probe() {
    latest = usePlaylistLibrary()
    return null
  }
  render(<Probe />)
  return {
    library: () => latest!,
    channelNames: () => latest!.channels.map((c) => c.name),
  }
}

async function settle(times = 12) {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve()
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
  vi.setSystemTime(1_700_000_000_000)
  store.clear()
  providerFetches.length = 0
  providerChannels = () => channelsFor(['A', 'B', 'C'])
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('with preparation-during-playback disabled', () => {
  it('asks the provider for nothing at all while a stream is playing', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    const harness = renderLibrary()
    await settle()
    expect(providerFetches).toHaveLength(1) // the launch sync

    const duringPlayback = harness.library().channels
    act(() => harness.library().setPlaybackActive(true))
    providerChannels = () => channelsFor(['A', 'B', 'C', 'NEW PPV'])

    // Several refresh intervals go by. With the default this would download
    // and hold; here it must not even reach the network.
    await act(async () => {
      vi.advanceTimersByTime(PLAYLIST_REFRESH_INTERVAL_MS * 3)
    })
    await settle()

    expect(providerFetches).toHaveLength(1)
    expect(harness.library().channels).toBe(duringPlayback)
    // And nothing is left half-done: no generation is claimed to be waiting.
    expect(harness.library().syncStatus(PLAYLIST.id).kind).not.toBe('pending-install')
  })

  it('still delivers the new channels the moment playback ends — freshness is deferred, not lost', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    const harness = renderLibrary()
    await settle()

    act(() => harness.library().setPlaybackActive(true))
    providerChannels = () => channelsFor(['A', 'B', 'C', 'NEW PPV'])
    await act(async () => {
      vi.advanceTimersByTime(PLAYLIST_REFRESH_INTERVAL_MS * 3)
    })
    await settle()
    expect(harness.channelNames()).toEqual(['A', 'B', 'C'])

    await act(async () => {
      harness.library().setPlaybackActive(false)
    })
    await settle()

    // The playback-exit trigger is what carries the whole feature in this
    // mode: one fetch, and the PPV channel added during the match is there.
    expect(providerFetches).toHaveLength(2)
    expect(harness.channelNames()).toContain('NEW PPV')
    expect(harness.library().syncStatus(PLAYLIST.id).kind).toBe('synced')
  })

  it('does not re-download on exit from a SHORT playback session that is still fresh', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    const harness = renderLibrary()
    await settle()
    expect(providerFetches).toHaveLength(1)

    act(() => harness.library().setPlaybackActive(true))
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    await act(async () => {
      harness.library().setPlaybackActive(false)
    })
    await settle()

    // Watching one goal replay must not cost a 5 MB download.
    expect(providerFetches).toHaveLength(1)
  })

  it('never blocks a person pressing Resync in Settings', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    const harness = renderLibrary()
    await settle()
    act(() => harness.library().setPlaybackActive(true))
    providerChannels = () => channelsFor(['A', 'B', 'C', 'MANUAL'])

    await act(async () => {
      await harness.library().resyncPlaylist(PLAYLIST.id)
    })
    await settle()

    expect(providerFetches).toHaveLength(2)
    expect(harness.channelNames()).toContain('MANUAL')
  })
})
