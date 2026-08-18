// Exercises runChannelIdentityResolution's orchestration (success,
// cancellation, worker construction failure, worker runtime failure) via an
// injected fake WorkerLike — no real browser Worker involved, per the
// resolver-integration task's requirement that this stay unit-testable
// without one.
import { describe, expect, it, vi } from 'vitest'
import { runChannelIdentityResolution, ChannelIdentityJobCancelled, resolveChannelIdentityWorkerRequest } from './channelIdentityWorkerClient'
import type { WorkerLike, WorkerFactory } from './channelIdentityWorkerClient'
import type { ChannelIdentityWorkerRequest, ChannelIdentityWorkerResponse } from './channelIdentityWorker'
import type { NinetyLogicalChannel } from './ninetyApiClient'

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

// A fake worker that actually runs the real resolver synchronously-ish
// (deferred a microtask, like a real async postMessage round trip) —
// realistic responses without a real Worker thread.
class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: ChannelIdentityWorkerResponse }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  terminate = vi.fn()
  lastRequest: ChannelIdentityWorkerRequest | null = null

  postMessage(data: ChannelIdentityWorkerRequest): void {
    this.lastRequest = data
    queueMicrotask(() => {
      this.onmessage?.({ data: resolveChannelIdentityWorkerRequest(data) })
    })
  }
}

describe('runChannelIdentityResolution', () => {
  it('resolves with the catalog version, resolutions map, and non-negative timings', async () => {
    const fake = new FakeWorker()
    const factory: WorkerFactory = () => fake

    const job = runChannelIdentityResolution(
      'v1',
      [logical({ id: 'a', name: 'Channel A' })],
      [{ id: 'p1', name: 'Channel A' }],
      factory,
    )

    const result = await job.result
    expect(result.catalogVersion).toBe('v1')
    expect(result.resolutions.get('a')?.classification).toBe('CONFIRMED')
    expect(result.timings.workerRoundTripMs).toBeGreaterThanOrEqual(0)
    expect(result.timings.workerComputeMs).toBeGreaterThanOrEqual(0)
    expect(fake.terminate).toHaveBeenCalledTimes(1)
  })

  it('never posts a stream URL into the worker request', async () => {
    const fake = new FakeWorker()
    const job = runChannelIdentityResolution(
      'v1',
      [logical({ id: 'a', name: 'Channel A' })],
      [{ id: 'p1', name: 'Channel A', sources: [{ epgChannelId: 'x', originalName: 'Raw Name' }] }],
      () => fake,
    )
    await job.result
    expect(JSON.stringify(fake.lastRequest)).not.toContain('url')
    expect(JSON.stringify(fake.lastRequest)).not.toContain('http')
  })

  it('cancel() terminates the worker and rejects result with ChannelIdentityJobCancelled', async () => {
    const fake = new FakeWorker()
    // Never auto-responds — this worker just sits there until cancelled.
    fake.postMessage = vi.fn()

    const job = runChannelIdentityResolution('v1', [], [], () => fake)
    job.cancel()

    await expect(job.result).rejects.toBeInstanceOf(ChannelIdentityJobCancelled)
    expect(fake.terminate).toHaveBeenCalledTimes(1)
  })

  it('a response that arrives AFTER cancel() is ignored — result stays rejected, onIndex-equivalent never fires twice', async () => {
    const fake = new FakeWorker()
    const job = runChannelIdentityResolution('v1', [logical({ id: 'a', name: 'A' })], [], () => fake)

    job.cancel()
    // Simulate a slow real worker whose message was already in flight when
    // cancel() ran — must be a no-op, not a second settlement.
    fake.onmessage?.({ data: resolveChannelIdentityWorkerRequest({ generationId: 1, catalogVersion: 'v1', catalog: [], playlistIdentityRecords: [] }) })

    await expect(job.result).rejects.toBeInstanceOf(ChannelIdentityJobCancelled)
  })

  it('worker construction failure rejects result without throwing synchronously', async () => {
    const factory: WorkerFactory = () => {
      throw new Error('Worker is not defined')
    }
    const job = runChannelIdentityResolution('v1', [], [], factory)
    await expect(job.result).rejects.toThrow('Worker is not defined')
  })

  it('a worker runtime error rejects result and terminates the worker', async () => {
    const fake = new FakeWorker()
    fake.postMessage = () => {
      queueMicrotask(() => fake.onerror?.(new Error('worker crashed')))
    }
    const job = runChannelIdentityResolution('v1', [], [], () => fake)
    await expect(job.result).rejects.toThrow('worker crashed')
    expect(fake.terminate).toHaveBeenCalledTimes(1)
  })
})
