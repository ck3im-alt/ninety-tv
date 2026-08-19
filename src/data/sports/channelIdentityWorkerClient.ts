// Main-thread client for channelIdentityWorker.ts — owns spawning a
// dedicated Worker per resolution attempt, posting it a safe
// PlaylistChannelIdentity[] request, and turning its response back into a
// Map<logicalChannelId, LogicalChannelResolution>.
//
// The real browser Worker is reached only through the injectable
// `WorkerFactory` (default: createChannelIdentityWorker below), specifically
// so channelIdentityLifecycle.ts's orchestration — and this module's own
// tests — can supply a fake WorkerLike and exercise cancellation/failure
// paths without ever constructing a real Worker (unavailable in plain
// Node/Vitest, and unnecessary for testing the orchestration logic itself).
import type { NinetyLogicalChannel } from './ninetyApiClient'
import type { LogicalChannelResolution } from './channelIdentityResolver'
import type { PlaylistChannelIdentity } from './channelIdentityProjection'
import type { ChannelIdentityWorkerRequest, ChannelIdentityWorkerResponse } from './channelIdentityWorkerProtocol'

// Deliberately narrower than the DOM Worker type — only what this module
// actually uses, so a test fake doesn't need to be a real Worker.
export interface WorkerLike {
  postMessage: (data: ChannelIdentityWorkerRequest) => void
  terminate: () => void
  onmessage: ((event: { data: ChannelIdentityWorkerResponse }) => void) | null
  onerror: ((event: unknown) => void) | null
}

export type WorkerFactory = () => WorkerLike

// The real factory — Vite bundles this `new URL(...)` worker reference into
// its own chunk at build time (verified against dist/ in the resolver-
// integration task's Tizen build check). Wrapped in a function (rather than
// constructed at module scope) so a construction failure — e.g. no module
// Worker support on some Tizen WebKit version — surfaces as a normal
// rejection of one job's `result`, not a module-load-time crash.
export function createChannelIdentityWorker(): WorkerLike {
  return new Worker(new URL('./channelIdentityWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike
}

export class ChannelIdentityJobCancelled extends Error {
  constructor() {
    super('channel identity resolution job was cancelled')
    this.name = 'ChannelIdentityJobCancelled'
  }
}

export interface ChannelIdentityResolutionTimings {
  // Wall-clock time from just before postMessage to the response landing
  // back on the main thread — includes both structured-clone legs plus the
  // worker's own compute time.
  workerRoundTripMs: number
  // The worker's own resolveChannelIdentities duration, reported by the
  // worker itself (Part 9's "resolver worker time").
  workerComputeMs: number
}

export interface ChannelIdentityResolutionResult {
  catalogVersion: string
  resolutions: Map<string, LogicalChannelResolution>
  timings: ChannelIdentityResolutionTimings
}

export interface ChannelIdentityJob {
  result: Promise<ChannelIdentityResolutionResult>
  cancel: () => void
}

let nextGenerationId = 1

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

// Runs one resolveChannelIdentities computation off the main thread via a
// fresh, single-use Worker. Each call gets its own Worker/generationId —
// staleness across overlapping calls (Part 5 of the resolver-integration
// task) is handled by the caller (channelIdentityLifecycle.ts) deciding
// whether to await/use a given job's `result` at all, and by calling
// `cancel()` on a job it no longer wants (which terminates the Worker
// immediately rather than leaving it to burn CPU on a discarded computation).
export function runChannelIdentityResolution(
  catalogVersion: string,
  catalog: NinetyLogicalChannel[],
  playlistIdentityRecords: PlaylistChannelIdentity[],
  createWorker: WorkerFactory = createChannelIdentityWorker,
): ChannelIdentityJob {
  const generationId = nextGenerationId++
  let settled = false
  let worker: WorkerLike | null = null
  let rejectResult: (err: unknown) => void = () => {}

  const requestSentAt = now()

  const result = new Promise<ChannelIdentityResolutionResult>((resolvePromise, reject) => {
    rejectResult = reject

    let created: WorkerLike
    try {
      created = createWorker()
    } catch (err) {
      settled = true
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }
    worker = created

    created.onmessage = (event) => {
      if (settled) return
      settled = true
      const response = event.data
      const receivedAt = now()
      resolvePromise({
        catalogVersion: response.catalogVersion,
        resolutions: new Map(response.resolutions),
        timings: {
          workerRoundTripMs: receivedAt - requestSentAt,
          workerComputeMs: response.workerFinishedAt - response.workerReceivedAt,
        },
      })
      created.terminate()
    }
    created.onerror = (err) => {
      if (settled) return
      settled = true
      reject(err instanceof Error ? err : new Error('channel identity worker failed'))
      created.terminate()
    }

    const request: ChannelIdentityWorkerRequest = { generationId, catalogVersion, catalog, playlistIdentityRecords }
    created.postMessage(request)
  })

  return {
    result,
    cancel: () => {
      if (settled) return
      settled = true
      worker?.terminate()
      rejectResult(new ChannelIdentityJobCancelled())
    },
  }
}
