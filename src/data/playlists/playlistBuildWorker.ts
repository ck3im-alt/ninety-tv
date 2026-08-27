// Dedicated-worker bootstrap for parseM3u + mergeChannelSources — measured
// at ~429 ms of unbroken main-thread work for a 30,925-channel / 5.35 MB
// playlist (89 % of it inside mergeChannelSources' per-channel
// normalizeChannelName), which is the single largest blocking task in the
// app and the reason a 10-15 minute automatic refresh cadence was not
// affordable before this existed.
//
// A thin wrapper, exactly like channelIdentityWorker.ts: the request/response
// shapes and the computation itself live in playlistBuildWorkerProtocol.ts
// so nothing else can grow this file.
import { runPlaylistBuildRequest } from './playlistBuildWorkerProtocol'
import type { PlaylistBuildWorkerRequest, PlaylistBuildWorkerResponse } from './playlistBuildWorkerProtocol'

// Via `globalThis` rather than the bare `self` identifier, for the same
// reason channelIdentityWorker.ts does it: DOM's `self: Window` and
// WebWorker's `self: WorkerGlobalScope` conflict under this repo's
// DOM-lib-based tsconfig.
const workerScope = globalThis as unknown as {
  onmessage: ((event: { data: PlaylistBuildWorkerRequest }) => void) | null
  postMessage?: (data: PlaylistBuildWorkerResponse) => void
}

if (typeof workerScope.postMessage === 'function') {
  workerScope.onmessage = (event) => {
    workerScope.postMessage!(runPlaylistBuildRequest(event.data))
  }
}
