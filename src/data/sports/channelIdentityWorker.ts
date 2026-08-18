// Runs Channel Identity Resolver v2's expensive resolveChannelIdentities
// call off the main thread — see channelIdentityWorkerClient.ts (the
// main-thread side that spawns this as a `new Worker(...)`) and the
// resolver-integration task's own header for why this exists: a real
// 30,925-channel playlist against a 115-channel catalog measured ~6s
// median, which is unacceptable to run synchronously on a Samsung TV UI
// thread.
//
// The request/response shapes here are the ONLY data that crosses the
// postMessage boundary — `playlistIdentityRecords` is already a
// PlaylistChannelIdentity[] (see channelIdentityProjection.ts), never a
// real Channel[], so no stream URL or Xtream credential ever reaches this
// module. `resolutions` in the response is a plain array of
// [logicalChannelId, LogicalChannelResolution] pairs (a Map isn't always
// the safest structured-clone shape across every WebKit build Tizen might
// ship) whose matches carry only playlistChannelId strings — never a
// Channel object — so the round trip out is exactly as safe as the trip in.
//
// This file is imported directly (for resolveChannelIdentityWorkerRequest)
// by both the real worker bootstrap below AND by
// channelIdentityWorker.test.ts, so the actual computation is a plain
// function with no dependency on any Worker/DOM global — the "am I running
// inside a dedicated worker" bootstrapping is a separate, clearly-marked
// side effect at the bottom of the file.
import { resolveChannelIdentities } from './channelIdentityResolver'
import type { LogicalChannelResolution } from './channelIdentityResolver'
import type { NinetyLogicalChannel } from './ninetyApiClient'
import type { PlaylistChannelIdentity } from './channelIdentityProjection'

export interface ChannelIdentityWorkerRequest {
  generationId: number
  catalogVersion: string
  catalog: NinetyLogicalChannel[]
  playlistIdentityRecords: PlaylistChannelIdentity[]
}

export interface ChannelIdentityWorkerResponse {
  generationId: number
  catalogVersion: string
  resolutions: [string, LogicalChannelResolution][]
  // Worker-local timestamps (Part 9 instrumentation) — the client computes
  // round-trip/compute-time breakdowns from these against its own
  // pre-postMessage timestamp. Same clock origin as the main thread for a
  // same-document dedicated worker, so subtracting across threads is valid.
  workerReceivedAt: number
  workerFinishedAt: number
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function resolveChannelIdentityWorkerRequest(request: ChannelIdentityWorkerRequest): ChannelIdentityWorkerResponse {
  const workerReceivedAt = now()
  const resolutions = resolveChannelIdentities(request.catalog, request.playlistIdentityRecords)
  const workerFinishedAt = now()
  return {
    generationId: request.generationId,
    catalogVersion: request.catalogVersion,
    resolutions: [...resolutions.entries()],
    workerReceivedAt,
    workerFinishedAt,
  }
}

// Dedicated-worker bootstrap. Accessed via `globalThis` (rather than the
// bare `self` identifier) so this file stays importable from plain Node/
// Vitest for the pure function above — this project's tsconfig uses the DOM
// lib project-wide (for the main-thread app), and DOM's `self: Window` global
// declaration conflicts with WebWorker lib's `self: WorkerGlobalScope` if
// both were ever in scope at once, so this deliberately never references the
// typed `self`/`onmessage`/`postMessage` globals directly.
const workerScope = globalThis as unknown as {
  onmessage: ((event: { data: ChannelIdentityWorkerRequest }) => void) | null
  postMessage?: (data: ChannelIdentityWorkerResponse) => void
}

if (typeof workerScope.postMessage === 'function') {
  workerScope.onmessage = (event) => {
    workerScope.postMessage!(resolveChannelIdentityWorkerRequest(event.data))
  }
}
