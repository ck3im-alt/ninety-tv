// Tests the worker's request-handling logic directly, with no real Worker
// involved — see channelIdentityWorker.ts's header for why
// resolveChannelIdentityWorkerRequest is a plain, Worker-global-free
// function. The real Worker bootstrap (self.onmessage wiring) is exercised
// indirectly via channelIdentityWorkerClient.test.ts's fake-worker tests.
import { describe, expect, it } from 'vitest'
import { resolveChannelIdentityWorkerRequest } from './channelIdentityWorker'
import type { ChannelIdentityWorkerRequest } from './channelIdentityWorker'
import type { NinetyLogicalChannel } from './ninetyApiClient'
import type { PlaylistChannelIdentity } from './channelIdentityProjection'

function logical(overrides: Partial<NinetyLogicalChannel> & Pick<NinetyLogicalChannel, 'id' | 'name'>): NinetyLogicalChannel {
  return {
    country: null,
    broadcast_type: 'LINEAR',
    network_name: null,
    channel_number: null,
    channel_variant: null,
    aliases: [],
    external_ids: [],
    source_names: [],
    ...overrides,
  }
}

function identity(overrides: Partial<PlaylistChannelIdentity> & Pick<PlaylistChannelIdentity, 'id' | 'name'>): PlaylistChannelIdentity {
  return { ...overrides }
}

describe('resolveChannelIdentityWorkerRequest', () => {
  it('echoes back generationId/catalogVersion and returns resolutions matching resolveChannelIdentities directly', () => {
    const request: ChannelIdentityWorkerRequest = {
      generationId: 7,
      catalogVersion: 'v3',
      catalog: [logical({ id: 'gb_tnt_sports_1', name: 'TNT Sports 1' })],
      playlistIdentityRecords: [identity({ id: 'p1', name: 'TNT Sports 1' })],
    }

    const response = resolveChannelIdentityWorkerRequest(request)

    expect(response.generationId).toBe(7)
    expect(response.catalogVersion).toBe('v3')
    const resolutions = new Map(response.resolutions)
    expect(resolutions.get('gb_tnt_sports_1')?.classification).toBe('CONFIRMED')
    expect(resolutions.get('gb_tnt_sports_1')?.matches.map((m) => m.playlistChannelId)).toEqual(['p1'])
  })

  it('reports non-negative worker-local timing fields with finish >= received', () => {
    const request: ChannelIdentityWorkerRequest = {
      generationId: 1,
      catalogVersion: 'v1',
      catalog: [],
      playlistIdentityRecords: [],
    }
    const response = resolveChannelIdentityWorkerRequest(request)
    expect(response.workerReceivedAt).toBeGreaterThanOrEqual(0)
    expect(response.workerFinishedAt).toBeGreaterThanOrEqual(response.workerReceivedAt)
  })

  it('never needs a stream URL — playlistIdentityRecords carries no `sources[].url`', () => {
    const request: ChannelIdentityWorkerRequest = {
      generationId: 1,
      catalogVersion: 'v1',
      catalog: [logical({ id: 'a', name: 'Channel A' })],
      playlistIdentityRecords: [{ id: 'p1', name: 'Channel A', sources: [{ epgChannelId: 'x' }] }],
    }
    expect(JSON.stringify(request)).not.toContain('url')
    const response = resolveChannelIdentityWorkerRequest(request)
    expect(new Map(response.resolutions).get('a')?.classification).toBe('CONFIRMED')
  })
})
