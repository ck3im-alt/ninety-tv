// Pure request/response shapes — plus the actual parse+merge call — for the
// playlist-build Worker boundary. Split out of playlistBuildWorker.ts for
// the same reason channelIdentityWorkerProtocol.ts is: the main-thread
// client must never need a value import from the Worker bootstrap file, or
// a bundler that doesn't fully tree-shake an unused re-export could pull
// the heavy merge implementation back into the main-thread chunk and defeat
// the point of the Worker entirely.
//
// WHAT CROSSES THE BOUNDARY, stated explicitly. Unlike the channel-identity
// Worker — which deliberately sends a URL-free projection — this one does
// carry real stream URLs, and for an Xtream playlist those URLs embed the
// user's own username/password. That is unavoidable (building the Channel[]
// IS the work) and it is safe: a dedicated Worker is same-origin, same
// device, has no network call of its own anywhere in this module's import
// graph, and nothing here logs a URL. The bytes never leave the TV — they
// move between two threads of the same page.
//
// This file has no dependency on any Worker/DOM global, so it is imported
// both by the real Worker bootstrap and directly by its tests, which
// exercise the computation without a real Worker thread.
import { parseM3u } from '../m3u/parseM3u'
import { mergeChannelSources } from '../../features/channels/mergeChannels'
import type { Channel } from '../channel'
import type { RawChannel } from '../rawChannel'

// Two request kinds because the two connectable source types converge on
// mergeChannelSources from different starting points: an M3U URL yields
// playlist TEXT (cheapest possible thing to clone into a Worker — one
// string), while an Xtream panel yields already-structured RawChannel[]
// built from its JSON API. Sending the M3U text rather than pre-parsing it
// on the main thread moves parseM3u off-thread too, for free.
export type PlaylistBuildWorkerRequest =
  | { jobId: number; kind: 'm3u-text'; text: string }
  | { jobId: number; kind: 'raw-channels'; raw: RawChannel[] }

export type PlaylistBuildWorkerResponse =
  | {
      jobId: number
      ok: true
      channels: Channel[]
      // Worker-local timestamps — the client turns these into a
      // compute-vs-clone breakdown against its own pre-postMessage stamp.
      // Same clock origin as the main thread for a same-document dedicated
      // Worker, so subtracting across threads is valid.
      workerReceivedAt: number
      workerFinishedAt: number
    }
  | { jobId: number; ok: false; message: string }

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

// The whole Worker-side computation, in one pure function. A throw here is
// turned into an `ok: false` response rather than an uncaught Worker error,
// so a malformed provider payload surfaces to the caller as a normal
// rejected job (which the sync coordinator already treats as "keep the
// previous generation") instead of killing the Worker.
export function runPlaylistBuildRequest(request: PlaylistBuildWorkerRequest): PlaylistBuildWorkerResponse {
  const workerReceivedAt = now()
  try {
    const raw = request.kind === 'm3u-text' ? parseM3u(request.text) : request.raw
    const channels = mergeChannelSources(raw)
    return { jobId: request.jobId, ok: true, channels, workerReceivedAt, workerFinishedAt: now() }
  } catch (err) {
    return { jobId: request.jobId, ok: false, message: err instanceof Error ? err.message : 'Playlist build failed' }
  }
}
