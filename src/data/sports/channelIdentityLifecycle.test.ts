import { describe, expect, it, vi } from 'vitest'
import { buildChannelIdentityIndex } from './channelIdentityLifecycle'
import type { CatalogSource, ChannelCatalogSnapshot } from './channelIdentityLifecycle'
import type { Channel } from '../channel'
import type { NinetyLogicalChannel } from './ninetyApiClient'

function logicalChannel(overrides: Partial<NinetyLogicalChannel> = {}): NinetyLogicalChannel {
  return {
    id: 'gb_tnt_sports_1',
    name: 'TNT Sports 1',
    country: 'GB',
    broadcast_type: 'LINEAR',
    network_name: 'TNT Sports',
    channel_number: null,
    channel_variant: null,
    aliases: [],
    external_ids: [],
    source_names: [],
    ...overrides,
  }
}

function playlistChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'p1',
    name: 'TNT SPORTS 1',
    groupTitle: 'UK| SPORT',
    sources: [{ label: 'Default', url: 'http://example.invalid/stream' }],
    ...overrides,
  }
}

describe('buildChannelIdentityIndex (Part 12: offline cache build)', () => {
  it('builds an index from a cached catalog with no network call at all', async () => {
    const cached: ChannelCatalogSnapshot = { apiVersion: 'v1', channels: [logicalChannel()] }
    const refresh = vi.fn<CatalogSource['refresh']>(() => new Promise(() => {})) // never resolves
    const onIndex = vi.fn()

    // Deliberately don't await — a real network refresh may never settle
    // within the test, but the cache-derived index must arrive synchronously
    // (well, on the same microtask) regardless.
    void buildChannelIdentityIndex([playlistChannel()], { loadCached: () => cached, refresh }, onIndex)
    await Promise.resolve()
    await Promise.resolve()

    expect(onIndex).toHaveBeenCalledTimes(1)
    const index = onIndex.mock.calls[0][0]
    expect(index.catalogVersion).toBe('v1')
    expect(index.getPlaylistChannels('gb_tnt_sports_1').map((c: Channel) => c.id)).toEqual(['p1'])
  })
})

describe('buildChannelIdentityIndex (Part 13: failed refresh keeps cached identity)', () => {
  it('does not clear or replace the cache-derived index when refresh fails', async () => {
    const cached: ChannelCatalogSnapshot = { apiVersion: 'v1', channels: [logicalChannel()] }
    const source: CatalogSource = {
      loadCached: () => cached,
      refresh: () => Promise.reject(new Error('network down')),
    }
    const onIndex = vi.fn()

    await buildChannelIdentityIndex([playlistChannel()], source, onIndex)

    // Called exactly once, from the cache — the failed refresh must never
    // trigger a second call (which would imply clearing/replacing it).
    expect(onIndex).toHaveBeenCalledTimes(1)
    expect(onIndex.mock.calls[0][0].catalogVersion).toBe('v1')
  })

  it('leaves the index null (never calls onIndex) when there is no cache and the refresh fails', async () => {
    const source: CatalogSource = {
      loadCached: () => null,
      refresh: () => Promise.reject(new Error('network down')),
    }
    const onIndex = vi.fn()

    await buildChannelIdentityIndex([playlistChannel()], source, onIndex)

    expect(onIndex).not.toHaveBeenCalled()
  })
})

describe('buildChannelIdentityIndex (Part 14: changed catalog version rebuilds)', () => {
  it('rebuilds when the refreshed catalog has a different version than the cache', async () => {
    const cached: ChannelCatalogSnapshot = { apiVersion: 'v1', channels: [logicalChannel({ aliases: [] })] }
    const fresh: ChannelCatalogSnapshot = { apiVersion: 'v2', channels: [logicalChannel({ aliases: ['New Alias'] })] }
    const source: CatalogSource = { loadCached: () => cached, refresh: () => Promise.resolve(fresh) }
    const onIndex = vi.fn()

    await buildChannelIdentityIndex([playlistChannel()], source, onIndex)

    expect(onIndex).toHaveBeenCalledTimes(2)
    expect(onIndex.mock.calls[0][0].catalogVersion).toBe('v1')
    expect(onIndex.mock.calls[1][0].catalogVersion).toBe('v2')
  })

  it('does not rebuild when the refreshed catalog version matches the cache', async () => {
    const snapshot: ChannelCatalogSnapshot = { apiVersion: 'v1', channels: [logicalChannel()] }
    const source: CatalogSource = { loadCached: () => snapshot, refresh: () => Promise.resolve(snapshot) }
    const onIndex = vi.fn()

    await buildChannelIdentityIndex([playlistChannel()], source, onIndex)

    expect(onIndex).toHaveBeenCalledTimes(1)
  })

  it('builds once (from the refresh alone) when there is no cache to seed from', async () => {
    const fresh: ChannelCatalogSnapshot = { apiVersion: 'v1', channels: [logicalChannel()] }
    const source: CatalogSource = { loadCached: () => null, refresh: () => Promise.resolve(fresh) }
    const onIndex = vi.fn()

    await buildChannelIdentityIndex([playlistChannel()], source, onIndex)

    expect(onIndex).toHaveBeenCalledTimes(1)
    expect(onIndex.mock.calls[0][0].catalogVersion).toBe('v1')
  })
})

describe('buildChannelIdentityIndex (Part 15: changed playlist rebuilds)', () => {
  it('a second call with a different playlist produces an index reflecting the new playlist, not the old one', async () => {
    const snapshot: ChannelCatalogSnapshot = { apiVersion: 'v1', channels: [logicalChannel()] }
    const source: CatalogSource = { loadCached: () => snapshot, refresh: () => Promise.resolve(snapshot) }

    const onIndexA = vi.fn()
    await buildChannelIdentityIndex([playlistChannel({ id: 'p1', name: 'TNT SPORTS 1' })], source, onIndexA)
    expect(onIndexA.mock.calls.at(-1)![0].getPlaylistChannels('gb_tnt_sports_1').map((c: Channel) => c.id)).toEqual(['p1'])

    const onIndexB = vi.fn()
    await buildChannelIdentityIndex([playlistChannel({ id: 'p2', name: 'TNT SPORTS 1' })], source, onIndexB)
    expect(onIndexB.mock.calls.at(-1)![0].getPlaylistChannels('gb_tnt_sports_1').map((c: Channel) => c.id)).toEqual(['p2'])
  })
})
