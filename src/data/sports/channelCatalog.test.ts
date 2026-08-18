import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeLocalStorage } from '../../core/storage/testFakeLocalStorage'
import type { NinetyLogicalChannel } from './ninetyApiClient'

vi.mock('./ninetyApiClient', () => ({
  getChannelCatalog: vi.fn(),
}))

import { getChannelCatalog } from './ninetyApiClient'
import { clearChannelCatalogCache, loadCachedChannelCatalog, refreshChannelCatalog } from './channelCatalog'

function channel(overrides: Partial<NinetyLogicalChannel> = {}): NinetyLogicalChannel {
  return {
    id: 'lc1',
    name: 'Sky Sports Main Event',
    country: 'GB',
    broadcast_type: 'LINEAR',
    network_name: 'Sky',
    channel_number: null,
    channel_variant: null,
    aliases: [],
    external_ids: [],
    source_names: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('loadCachedChannelCatalog', () => {
  it('returns null when nothing has been cached', () => {
    expect(loadCachedChannelCatalog()).toBeNull()
  })
})

describe('refreshChannelCatalog', () => {
  it('fetches and caches on first call', async () => {
    vi.mocked(getChannelCatalog).mockResolvedValue({ version: 'v1', channels: [channel()] })
    const result = await refreshChannelCatalog()
    expect(result.apiVersion).toBe('v1')
    expect(result.channels).toHaveLength(1)
    expect(loadCachedChannelCatalog()).toEqual({ apiVersion: 'v1', channels: [channel()] })
  })

  it('does not rewrite storage when the version is unchanged', async () => {
    vi.mocked(getChannelCatalog).mockResolvedValue({ version: 'v1', channels: [channel()] })
    await refreshChannelCatalog()
    const stored = localStorage.getItem('ninety.channelCatalog')

    vi.mocked(getChannelCatalog).mockResolvedValue({ version: 'v1', channels: [channel({ name: 'Renamed but same version' })] })
    await refreshChannelCatalog()
    expect(localStorage.getItem('ninety.channelCatalog')).toBe(stored)
  })

  it('updates the cache when the version changes', async () => {
    vi.mocked(getChannelCatalog).mockResolvedValue({ version: 'v1', channels: [channel()] })
    await refreshChannelCatalog()

    vi.mocked(getChannelCatalog).mockResolvedValue({ version: 'v2', channels: [channel({ name: 'Updated Name' })] })
    const result = await refreshChannelCatalog()
    expect(result.apiVersion).toBe('v2')
    expect(result.channels[0].name).toBe('Updated Name')
    expect(loadCachedChannelCatalog()?.apiVersion).toBe('v2')
  })

  it('caches per country — a different country is not served from the other country\'s cache', async () => {
    vi.mocked(getChannelCatalog).mockResolvedValue({ version: 'v1', channels: [channel({ country: 'NO' })] })
    await refreshChannelCatalog('NO')
    expect(loadCachedChannelCatalog('SE')).toBeNull()
    expect(loadCachedChannelCatalog('NO')).not.toBeNull()
  })

  it('never sends anything from the request except an optional country filter', async () => {
    vi.mocked(getChannelCatalog).mockResolvedValue({ version: 'v1', channels: [] })
    await refreshChannelCatalog('NO')
    expect(getChannelCatalog).toHaveBeenCalledWith({ country: 'NO' })
    expect(vi.mocked(getChannelCatalog).mock.calls[0][0]).not.toHaveProperty('channels')
    expect(vi.mocked(getChannelCatalog).mock.calls[0][0]).not.toHaveProperty('playlist')
  })
})

describe('clearChannelCatalogCache', () => {
  it('removes the cached catalog', async () => {
    vi.mocked(getChannelCatalog).mockResolvedValue({ version: 'v1', channels: [channel()] })
    await refreshChannelCatalog()
    clearChannelCatalogCache()
    expect(loadCachedChannelCatalog()).toBeNull()
  })
})
