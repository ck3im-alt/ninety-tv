// Pure request/response shapes and the actual resolveChannelIdentities call
// for Channel Identity Resolver v2's Worker boundary — split out of
// channelIdentityWorker.ts so the main-thread client
// (channelIdentityWorkerClient.ts) never needs a value import from the
// Worker bootstrap file itself, only from here. A bundler that doesn't
// fully tree-shake an unused re-export could otherwise pull the heavy
// resolver implementation into the main-thread chunk via that import,
// defeating the point of running it in a Worker at all.
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
// This file has no dependency on any Worker/DOM global — it's imported both
// by the real worker bootstrap (channelIdentityWorker.ts) and directly by
// channelIdentityWorker.test.ts to exercise the pure computation without a
// real Worker thread.
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
