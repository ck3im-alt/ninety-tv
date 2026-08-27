// @vitest-environment jsdom
//
// The synchronization architecture, exercised end-to-end through the REAL
// hook against a fake provider and a fake channel store.
//
// The product requirement being pinned here: providers add PPV/event
// channels throughout the day, so Ninety refreshes aggressively — and a
// refresh must NEVER be observable to a stream that is already playing. Both
// halves are only true if the coordinator is the single path every trigger
// goes through, which is what these tests assert.
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

// The provider. Every fetch returns whatever `providerChannels` currently
// holds, and every call is counted — "did a refresh actually happen" and
// "did two triggers cause two downloads" are both answered from here.
const providerFetches: string[] = []
let providerChannels: () => Channel[] = () => channelsFor(['A', 'B', 'C'])
let providerFails = false
// When set, the provider hangs until it is released — the only way to make
// "something else happened WHILE a sync was downloading" testable.
let providerGate: Promise<void> | null = null
vi.mock('./connectPlaylist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./connectPlaylist')>()
  return {
    ...actual,
    loadChannelsForSource: async () => {
      providerFetches.push(new Date().toISOString())
      // A real fetch is never synchronous; the microtask gap is what lets
      // "a second trigger arrives while the first is in flight" be tested.
      await Promise.resolve()
      if (providerGate) await providerGate
      if (providerFails) throw new Error('network down')
      const next = providerChannels()
      if (next.length === 0) throw new actual.EmptyPlaylistError()
      return next
    },
  }
})

import { usePlaylistLibrary, type PlaylistLibrary } from './usePlaylistLibrary'
import { savePlaylistLibrary } from './playlistLibraryStore'
import { PLAYLIST_REFRESH_INTERVAL_MS, PLAYLIST_SYNC_TICK_MS } from './playlistSyncPolicy'
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

// A library that hydrates from a working cache — the normal launch.
function seedCachedLibrary(names = ['A', 'B', 'C']) {
  savePlaylistLibrary([{ ...PLAYLIST, channelCount: names.length }])
  store.set(PLAYLIST.id, {
    version: PLAYLIST_CHANNELS_RECORD_VERSION,
    playlistId: PLAYLIST.id,
    generationId: 'gen-cached',
    channels: channelsFor(names),
  })
}

// Renders the hook and exposes its latest value plus a render counter.
interface Harness {
  library: () => PlaylistLibrary
  renderCount: () => number
  channelNames: () => string[]
}

function renderLibrary(): Harness {
  let latest: PlaylistLibrary | null = null
  let renders = 0
  function Probe() {
    latest = usePlaylistLibrary()
    renders++
    return null
  }
  render(<Probe />)
  return {
    library: () => latest!,
    renderCount: () => renders,
    channelNames: () => latest!.channels.map((c) => c.name),
  }
}

// Lets the hydration promise chain, the install's warmChannelIndexAsync
// yields and React's commits all drain. Generous — warmChannelIndexAsync
// yields via setTimeout(0) under jsdom.
async function settle(times = 12) {
  for (let i = 0; i < times; i++) {
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
  providerFails = false
  providerGate = null
  providerChannels = () => channelsFor(['A', 'B', 'C'])
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
  // jsdom reports 'visible' by default; several tests override it.
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('startup', () => {
  it('renders the cached playlist before the startup refresh finishes', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    // Provider hangs forever — the cached generation must still reach the UI.
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    providerChannels = () => {
      throw new Error('unreachable')
    }
    const harness = renderLibrary()
    await settle()

    expect(harness.library().hydration).toBe('done')
    expect(harness.channelNames()).toEqual(['A', 'B', 'C'])
    release()
    await held
  })

  it('starts a provider refresh on launch even though the cache hydrated fine', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    providerChannels = () => channelsFor(['A', 'B', 'C', 'NEW PPV'])
    const harness = renderLibrary()
    await settle()

    expect(providerFetches).toHaveLength(1)
    expect(harness.channelNames()).toContain('NEW PPV')
  })

  it('does not refresh a playlist the launch pass just rebuilt from scratch', async () => {
    // No cached channels at all -> the recovery path runs, which IS a sync.
    savePlaylistLibrary([PLAYLIST])
    renderLibrary()
    await settle()
    expect(providerFetches).toHaveLength(1)
  })
})

describe('atomic install', () => {
  it('installs a successful refresh as one generation — channels, count and generation id move together', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    providerChannels = () => channelsFor(['A', 'B', 'C', 'D'])
    const harness = renderLibrary()
    await settle()

    expect(harness.channelNames()).toEqual(['A', 'B', 'C', 'D'])
    expect(harness.library().playlists[0].channelCount).toBe(4)
    expect(harness.library().generationId).not.toBe(`${PLAYLIST.id}:gen-cached`)
    // Persisted immediately enough that a cold launch would use it.
    expect(store.get(PLAYLIST.id)!.channels.map((c) => c.name)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('keeps the previous generation when the provider fails — nothing is cleared up front', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    providerFails = true
    const harness = renderLibrary()
    await settle()

    expect(providerFetches).toHaveLength(1)
    expect(harness.channelNames()).toEqual(['A', 'B', 'C'])
    expect(store.get(PLAYLIST.id)!.channels).toHaveLength(3)
    expect(harness.library().syncStatus(PLAYLIST.id).kind).toBe('error')
  })

  it('refuses an automatic generation that collapsed, and keeps the working one', async () => {
    seedCachedLibrary(Array.from({ length: 400 }, (_, i) => `CH${i}`))
    providerChannels = () => channelsFor(['CH0'])
    const harness = renderLibrary()
    await settle()

    expect(harness.channelNames()).toHaveLength(400)
    const status = harness.library().syncStatus(PLAYLIST.id)
    expect(status.kind).toBe('error')
    expect(status.kind === 'error' && status.message).toMatch(/far fewer channels/)
  })

  it('lets a MANUAL sync accept the same collapsed generation', async () => {
    seedCachedLibrary(Array.from({ length: 400 }, (_, i) => `CH${i}`))
    providerChannels = () => channelsFor(['CH0'])
    const harness = renderLibrary()
    await settle()
    expect(harness.channelNames()).toHaveLength(400)

    await act(async () => {
      await harness.library().resyncPlaylist(PLAYLIST.id)
    })
    await settle()
    expect(harness.channelNames()).toEqual(['CH0'])
  })
})

describe('no duplicate, no overlapping sync', () => {
  it('a second trigger arriving mid-flight joins the sync in progress instead of starting another', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    const harness = renderLibrary()
    await settle()
    expect(providerFetches).toHaveLength(1)

    // Two manual requests fired back to back, before the first can settle.
    await act(async () => {
      const first = harness.library().resyncPlaylist(PLAYLIST.id)
      const second = harness.library().resyncPlaylist(PLAYLIST.id)
      await Promise.all([first, second])
    })
    await settle()
    expect(providerFetches).toHaveLength(2)
  })

  it('a periodic tick soon after a successful sync does nothing', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    renderLibrary()
    await settle()
    expect(providerFetches).toHaveLength(1)

    await act(async () => {
      vi.advanceTimersByTime(PLAYLIST_SYNC_TICK_MS * 3)
    })
    await settle()
    expect(providerFetches).toHaveLength(1)
  })

  it('a periodic tick once the playlist is genuinely stale does refresh it', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    const harness = renderLibrary()
    await settle()
    providerChannels = () => channelsFor(['A', 'B', 'C', 'LATE PPV'])

    // Past the interval plus the widest possible jitter, so the assertion
    // does not depend on which offset this run happened to roll.
    await act(async () => {
      vi.advanceTimersByTime(PLAYLIST_REFRESH_INTERVAL_MS * 2)
    })
    await settle()
    expect(providerFetches).toHaveLength(2)
    expect(harness.channelNames()).toContain('LATE PPV')
  })
})

describe('resume', () => {
  it('a resume after a long suspend refreshes', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    renderLibrary()
    await settle()
    expect(providerFetches).toHaveLength(1)

    vi.setSystemTime(Date.now() + PLAYLIST_REFRESH_INTERVAL_MS * 3)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await settle()
    expect(providerFetches).toHaveLength(2)
  })

  it('a resume seconds after a sync does not', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    renderLibrary()
    await settle()
    expect(providerFetches).toHaveLength(1)

    vi.setSystemTime(Date.now() + 5_000)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await settle()
    expect(providerFetches).toHaveLength(1)
  })

  it('a periodic tick while the app is genuinely hidden does nothing', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    renderLibrary()
    await settle()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })

    await act(async () => {
      vi.advanceTimersByTime(PLAYLIST_REFRESH_INTERVAL_MS * 2)
    })
    await settle()
    expect(providerFetches).toHaveLength(1)
  })
})

describe('a connection edit landing on top of an in-flight sync', () => {
  it('discards the in-flight generation rather than putting the viewer back on the old provider', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    const harness = renderLibrary()
    await settle()

    // A sync against the CURRENT provider, held open mid-download.
    let release!: () => void
    providerGate = new Promise<void>((resolve) => {
      release = resolve
    })
    providerChannels = () => channelsFor(['OLD-1', 'OLD-2', 'OLD-3'])
    const fetchesBefore = providerFetches.length
    const syncing = harness.library().resyncPlaylist(PLAYLIST.id)
    await settle(2)
    expect(providerFetches.length).toBe(fetchesBefore + 1)

    // Meanwhile the viewer edits the connection to a different provider,
    // handing over channels they already fetched themselves — that lands
    // while the sync above is still downloading.
    await act(async () => {
      await harness.library().replaceConnection(
        PLAYLIST.id,
        { type: 'm3u-url', url: 'https://other-provider.example/get.php' },
        channelsFor(['NEW-1', 'NEW-2']),
      )
    })
    await settle()
    expect(harness.channelNames()).toEqual(['NEW-1', 'NEW-2'])

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    providerGate = null
    release()
    await act(async () => {
      await syncing
    })
    await settle()
    warn.mockRestore()

    // The old provider's channels never came back, and the connection the
    // viewer chose is still the one on file.
    expect(harness.channelNames()).toEqual(['NEW-1', 'NEW-2'])
    expect(harness.library().playlists[0].source).toEqual({ type: 'm3u-url', url: 'https://other-provider.example/get.php' })
  })
})

describe('a freshly connected playlist', () => {
  it('is not re-downloaded by the very next tick — connecting IS a successful sync', async () => {
    // Empty library: the viewer connects a playlist by hand.
    savePlaylistLibrary([])
    const harness = renderLibrary()
    await settle()
    expect(providerFetches).toHaveLength(0)

    await act(async () => {
      await harness.library().addPlaylist(PLAYLIST.source, channelsFor(['A', 'B', 'C']))
    })
    await settle()
    expect(harness.channelNames()).toEqual(['A', 'B', 'C'])

    await act(async () => {
      vi.advanceTimersByTime(PLAYLIST_SYNC_TICK_MS * 5)
    })
    await settle()
    // Nothing: the playlist the viewer just imported is by definition fresh.
    expect(providerFetches).toHaveLength(0)
  })
})

describe('the playback gate', () => {
  it('holds a fetched generation while a stream is playing — the live channel array never changes', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    const harness = renderLibrary()
    await settle()
    const duringPlayback = harness.library().channels

    act(() => harness.library().setPlaybackActive(true))
    providerChannels = () => channelsFor(['A', 'B', 'C', 'NEW PPV'])

    await act(async () => {
      vi.advanceTimersByTime(PLAYLIST_REFRESH_INTERVAL_MS * 2)
    })
    await settle()

    // The provider WAS asked — freshness work continues during playback.
    expect(providerFetches).toHaveLength(2)
    // But nothing the player is holding moved. Reference identity, not just
    // contents: that is what every downstream memo and index keys off.
    expect(harness.library().channels).toBe(duringPlayback)
    expect(harness.channelNames()).toEqual(['A', 'B', 'C'])
    expect(harness.library().syncStatus(PLAYLIST.id).kind).toBe('pending-install')
  })

  it('installs the held generation the moment playback ends', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    const harness = renderLibrary()
    await settle()

    act(() => harness.library().setPlaybackActive(true))
    providerChannels = () => channelsFor(['A', 'B', 'C', 'NEW PPV'])
    await act(async () => {
      vi.advanceTimersByTime(PLAYLIST_REFRESH_INTERVAL_MS * 2)
    })
    await settle()
    expect(harness.channelNames()).toEqual(['A', 'B', 'C'])

    await act(async () => {
      harness.library().setPlaybackActive(false)
    })
    await settle()
    expect(harness.channelNames()).toContain('NEW PPV')
    expect(harness.library().syncStatus(PLAYLIST.id).kind).toBe('synced')
  })

  it('leaving a long playback session with nothing held still triggers an immediate stale check', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    const harness = renderLibrary()
    await settle()
    expect(providerFetches).toHaveLength(1)

    // Playback starts, and the app is suspended throughout (so no periodic
    // tick ever ran) — the two-hour-match case with no pending generation.
    act(() => harness.library().setPlaybackActive(true))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000)
    providerChannels = () => channelsFor(['A', 'B', 'C', 'MATCH PPV'])

    await act(async () => {
      harness.library().setPlaybackActive(false)
    })
    await settle()
    expect(providerFetches).toHaveLength(2)
    expect(harness.channelNames()).toContain('MATCH PPV')
  })

  it('a MANUAL sync installs immediately even if playback is somehow still flagged active', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    const harness = renderLibrary()
    await settle()
    act(() => harness.library().setPlaybackActive(true))
    providerChannels = () => channelsFor(['A', 'B', 'C', 'MANUAL'])

    await act(async () => {
      await harness.library().resyncPlaylist(PLAYLIST.id)
    })
    await settle()
    expect(harness.channelNames()).toContain('MANUAL')
  })

  it('entering playback does no work at all — starting a stream is never delayed by the coordinator', async () => {
    seedCachedLibrary(['A', 'B', 'C'])
    const harness = renderLibrary()
    await settle()
    const before = providerFetches.length
    const rendersBefore = harness.renderCount()

    act(() => harness.library().setPlaybackActive(true))

    expect(providerFetches).toHaveLength(before)
    // No state was written, so nothing re-rendered — the gate lives in a ref
    // precisely so telling the library that playback started cannot ripple
    // back into the player that just started.
    expect(harness.renderCount()).toBe(rendersBefore)
  })
})
