// Dedicated-worker bootstrap for Channel Identity Resolver v2's expensive
// resolveChannelIdentities call — see channelIdentityWorkerClient.ts (the
// main-thread side that spawns this as a `new Worker(...)`) and
// channelIdentityWorkerProtocol.ts (the pure request/response shapes and
// the actual resolveChannelIdentities call, kept in their own module so
// this file's only value import is the one below — nothing else should be
// added here that could grow this bootstrap beyond a thin wrapper).
import { resolveChannelIdentityWorkerRequest } from './channelIdentityWorkerProtocol'
import type { ChannelIdentityWorkerRequest, ChannelIdentityWorkerResponse } from './channelIdentityWorkerProtocol'

// Accessed via `globalThis` (rather than the bare `self` identifier) so this
// file stays consistent with the rest of the codebase's DOM-lib-based
// tsconfig — DOM's `self: Window` global declaration conflicts with
// WebWorker lib's `self: WorkerGlobalScope` if both were ever in scope at
// once, so this deliberately never references the typed
// `self`/`onmessage`/`postMessage` globals directly.
const workerScope = globalThis as unknown as {
  onmessage: ((event: { data: ChannelIdentityWorkerRequest }) => void) | null
  postMessage?: (data: ChannelIdentityWorkerResponse) => void
}

if (typeof workerScope.postMessage === 'function') {
  workerScope.onmessage = (event) => {
    workerScope.postMessage!(resolveChannelIdentityWorkerRequest(event.data))
  }
}
