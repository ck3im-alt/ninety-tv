// Main-thread side of the playlist-build Worker: hands one playlist payload
// off to a fresh single-use Worker and resolves the merged Channel[].
//
// THE FALLBACK IS THE POINT. Tizen's WebKit varies by TV model year and
// module-Worker support is not guaranteed on every one of them, so this
// module is written so that a Worker that cannot be constructed, errors
// out, or never answers degrades to running the exact same pure function
// (runPlaylistBuildRequest) synchronously on the main thread — i.e. to
// precisely the behaviour this codebase had before the Worker existed.
// Nothing about correctness depends on the Worker being available; only
// smoothness does. `buildPlaylistChannels` therefore never rejects because
// of a Worker problem, only because the playlist data itself is unusable.
//
// The real Worker is reached only through the injectable `WorkerFactory`,
// same as channelIdentityWorkerClient.ts, so the orchestration and the
// fallback are both testable in plain Node/Vitest without a real Worker.
import { runPlaylistBuildRequest } from './playlistBuildWorkerProtocol'
import type { PlaylistBuildWorkerRequest, PlaylistBuildWorkerResponse } from './playlistBuildWorkerProtocol'
import { recordPerf } from '../../core/perf/devPerf'
import type { Channel } from '../channel'
import type { RawChannel } from '../rawChannel'

// Deliberately narrower than the DOM Worker type — a test fake only has to
// implement what this module actually touches.
export interface PlaylistBuildWorkerLike {
  postMessage: (data: PlaylistBuildWorkerRequest) => void
  terminate: () => void
  onmessage: ((event: { data: PlaylistBuildWorkerResponse }) => void) | null
  onerror: ((event: unknown) => void) | null
}

export type PlaylistBuildWorkerFactory = () => PlaylistBuildWorkerLike

// Vite bundles this `new URL(...)` reference into its own chunk at build
// time (the same mechanism that already produces
// `assets/channelIdentityWorker-*.js` in the Tizen build). Wrapped in a
// function rather than constructed at module scope so a construction
// failure surfaces as a caught error here — and therefore as the
// synchronous fallback — instead of a module-load-time crash.
export function createPlaylistBuildWorker(): PlaylistBuildWorkerLike {
  return new Worker(new URL('./playlistBuildWorker.ts', import.meta.url), { type: 'module' }) as unknown as PlaylistBuildWorkerLike
}

// A Worker that accepts the message and then never answers would otherwise
// hang a sync forever, holding the coordinator's in-flight guard with it.
// Generous enough that a genuinely slow TV finishing a 30 k-channel merge is
// never cut off (the measured worker-side compute is ~0.4 s on a dev Mac;
// assume 3-6x on TV silicon), short enough that a wedged Worker resolves
// into the synchronous fallback within one refresh interval.
const WORKER_TIMEOUT_MS = 30_000

export type PlaylistBuildInput = { kind: 'm3u-text'; text: string } | { kind: 'raw-channels'; raw: RawChannel[] }

export interface PlaylistBuildOutcome {
  channels: Channel[]
  // Which path actually produced the channels — surfaced so the sync
  // coordinator's perf marks say whether a given refresh was off-thread or
  // fell back, rather than leaving that invisible on a real device.
  ranInWorker: boolean
}

let nextJobId = 1

// Never rejects for a Worker-side problem — see the module header. Rejects
// only if the synchronous fallback itself decides the payload is unusable.
export async function buildPlaylistChannels(
  input: PlaylistBuildInput,
  createWorker: PlaylistBuildWorkerFactory = createPlaylistBuildWorker,
): Promise<PlaylistBuildOutcome> {
  const jobId = nextJobId++
  const request: PlaylistBuildWorkerRequest = { jobId, ...input }

  try {
    const channels = await runInWorker(request, createWorker)
    return { channels, ranInWorker: true }
  } catch (err) {
    // A DATA error means the Worker ran fine and the playlist itself is
    // unusable. Re-running the identical pure function on the main thread
    // would spend hundreds of milliseconds (and a second ~30,000-object
    // allocation, on a TV that may not have room for it) to arrive at the
    // same throw. Only an INFRASTRUCTURE failure — no Worker support, a
    // dead Worker, a Worker that never answered — is worth retrying here.
    if (err instanceof PlaylistBuildDataError) throw err
    console.warn('[playlists] Playlist build Worker unavailable — merging on the main thread instead.', err)
    return { channels: buildSynchronously(request), ranInWorker: false }
  }
}

// Thrown when the Worker itself was healthy and said the payload could not
// be built. Distinct from every other failure in this module, all of which
// mean "the Worker route did not work" and are recoverable by falling back.
export class PlaylistBuildDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlaylistBuildDataError'
  }
}

function buildSynchronously(request: PlaylistBuildWorkerRequest): Channel[] {
  const response = runPlaylistBuildRequest(request)
  if (!response.ok) throw new Error(response.message)
  return response.channels
}

function runInWorker(request: PlaylistBuildWorkerRequest, createWorker: PlaylistBuildWorkerFactory): Promise<Channel[]> {
  return new Promise<Channel[]>((resolve, reject) => {
    let worker: PlaylistBuildWorkerLike
    try {
      worker = createWorker()
    } catch (err) {
      reject(err)
      return
    }

    let settled = false
    const timer = setTimeout(() => finish(() => reject(new Error('Playlist build Worker timed out'))), WORKER_TIMEOUT_MS)

    function finish(act: () => void): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.onmessage = null
      worker.onerror = null
      try {
        worker.terminate()
      } catch {
        // A Worker that already died has nothing to terminate — the result
        // (or failure) has been delivered either way.
      }
      act()
    }

    const postedAt = now()
    worker.onmessage = (event) => {
      const response = event.data
      // Single-use Worker, so a mismatched jobId can only mean a fake/reused
      // Worker sent someone else's answer — ignore it rather than resolving
      // this job with another job's channels.
      if (response.jobId !== request.jobId) return
      if (!response.ok) {
        finish(() => reject(new PlaylistBuildDataError(response.message)))
        return
      }
      const roundTripMs = now() - postedAt
      recordPerf('playlist:build-worker-round-trip', roundTripMs)
      recordPerf('playlist:build-worker-compute', response.workerFinishedAt - response.workerReceivedAt)
      finish(() => resolve(response.channels))
    }
    worker.onerror = (event) => {
      finish(() => reject(event instanceof Error ? event : new Error('Playlist build Worker errored')))
    }

    try {
      worker.postMessage(request)
    } catch (err) {
      finish(() => reject(err))
    }
  })
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
