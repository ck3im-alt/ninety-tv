// The parse+merge Worker boundary.
//
// Two things have to be true for moving this off the main thread to be safe:
// the Worker must produce EXACTLY what the synchronous path produced (merge
// semantics are load-bearing for channel identity — the merge key IS
// Channel.id), and a platform without usable module Workers must degrade to
// that synchronous path rather than failing a sync. Both are asserted here
// against a real ~2,000-channel playlist rather than a hand-built literal.
import { describe, expect, it, vi } from 'vitest'
import { runPlaylistBuildRequest, type PlaylistBuildWorkerRequest, type PlaylistBuildWorkerResponse } from './playlistBuildWorkerProtocol'
import { PlaylistBuildDataError, buildPlaylistChannels, type PlaylistBuildWorkerLike } from './playlistBuildWorkerClient'
import { parseM3u } from '../m3u/parseM3u'
import { mergeChannelSources } from '../../features/channels/mergeChannels'
import { generateSyntheticRawChannels } from '../testUtils/syntheticPlaylist'
import type { RawChannel } from '../rawChannel'

function toM3uText(raw: RawChannel[]): string {
  const lines = ['#EXTM3U']
  for (const c of raw) {
    lines.push(
      `#EXTINF:-1 tvg-id="${c.epgChannelId ?? ''}" tvg-logo="${c.logo ?? ''}" group-title="${c.groupTitle ?? ''}",${c.name}`,
    )
    lines.push(c.url)
  }
  return lines.join('\n')
}

const RAW = generateSyntheticRawChannels({ channelCount: 2_000, categoriesPerCountry: 8, qualityVariantsPerChannel: 3 })
const TEXT = toM3uText(RAW)

// A Worker fake that runs the real protocol function — the same code the
// real Worker bootstrap runs — one microtask later, like a real postMessage.
function workingWorker(): PlaylistBuildWorkerLike {
  const worker: PlaylistBuildWorkerLike = {
    onmessage: null,
    onerror: null,
    terminate: () => {},
    postMessage: (data) => {
      void Promise.resolve().then(() => worker.onmessage?.({ data: runPlaylistBuildRequest(data) }))
    },
  }
  return worker
}

describe('worker/synchronous equivalence', () => {
  it('an m3u-text request produces byte-identical channels to parseM3u + mergeChannelSources', async () => {
    const expected = mergeChannelSources(parseM3u(TEXT))
    const { channels, ranInWorker } = await buildPlaylistChannels({ kind: 'm3u-text', text: TEXT }, workingWorker)
    expect(ranInWorker).toBe(true)
    expect(channels).toEqual(expected)
    // Quality variants really did collapse — otherwise "identical" would be
    // trivially true for a playlist the merge had nothing to do.
    expect(channels.length).toBeLessThan(RAW.length)
    expect(channels.some((c) => c.sources.length > 1)).toBe(true)
  })

  it('a raw-channels request (the Xtream path) produces the same channels too', async () => {
    const expected = mergeChannelSources(RAW)
    const { channels } = await buildPlaylistChannels({ kind: 'raw-channels', raw: RAW }, workingWorker)
    expect(channels).toEqual(expected)
  })

  it('the same merge key still decides identity — ids match the synchronous path exactly', async () => {
    const expected = mergeChannelSources(RAW).map((c) => c.id)
    const { channels } = await buildPlaylistChannels({ kind: 'raw-channels', raw: RAW }, workingWorker)
    expect(channels.map((c) => c.id)).toEqual(expected)
  })
})

describe('degradation — correctness never depends on the Worker existing', () => {
  it('falls back to the synchronous path when the Worker cannot be constructed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { channels, ranInWorker } = await buildPlaylistChannels({ kind: 'm3u-text', text: TEXT }, () => {
      throw new Error('module workers unsupported on this WebKit')
    })
    expect(ranInWorker).toBe(false)
    expect(channels).toEqual(mergeChannelSources(parseM3u(TEXT)))
    warn.mockRestore()
  })

  it('falls back when the Worker errors after construction', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { channels, ranInWorker } = await buildPlaylistChannels({ kind: 'm3u-text', text: TEXT }, () => {
      const worker: PlaylistBuildWorkerLike = {
        onmessage: null,
        onerror: null,
        terminate: () => {},
        postMessage: () => {
          void Promise.resolve().then(() => worker.onerror?.(new Error('worker exploded')))
        },
      }
      return worker
    })
    expect(ranInWorker).toBe(false)
    expect(channels).toHaveLength(mergeChannelSources(parseM3u(TEXT)).length)
    warn.mockRestore()
  })

  it('ignores a response for a different job rather than resolving with another job’s channels', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    const promise = buildPlaylistChannels({ kind: 'm3u-text', text: TEXT }, () => {
      const worker: PlaylistBuildWorkerLike = {
        onmessage: null,
        onerror: null,
        terminate: () => {},
        postMessage: () => {
          void Promise.resolve().then(() => {
            const wrong: PlaylistBuildWorkerResponse = { jobId: -1, ok: true, channels: [], workerReceivedAt: 0, workerFinishedAt: 0 }
            worker.onmessage?.({ data: wrong })
          })
        },
      }
      return worker
    })
    // The mismatched response was ignored, so the job runs to its timeout and
    // then degrades — never to an empty playlist.
    await vi.advanceTimersByTimeAsync(31_000)
    const { channels, ranInWorker } = await promise
    expect(ranInWorker).toBe(false)
    expect(channels.length).toBeGreaterThan(0)
    vi.useRealTimers()
    warn.mockRestore()
  })

  it('does NOT re-run the merge on the main thread when the Worker itself said the payload is unusable', async () => {
    // A data error means the Worker ran fine and the playlist is bad.
    // Repeating an identical pure computation on the main thread would burn
    // hundreds of milliseconds — and a second ~30,000-object allocation on a
    // memory-constrained TV — to reach exactly the same throw.
    let posts = 0
    await expect(
      buildPlaylistChannels({ kind: 'm3u-text', text: TEXT }, () => {
        const worker: PlaylistBuildWorkerLike = {
          onmessage: null,
          onerror: null,
          terminate: () => {},
          postMessage: (data) => {
            posts++
            void Promise.resolve().then(() =>
              worker.onmessage?.({ data: { jobId: data.jobId, ok: false, message: 'playlist is not parseable' } }),
            )
          },
        }
        return worker
      }),
    ).rejects.toBeInstanceOf(PlaylistBuildDataError)
    expect(posts).toBe(1)
  })

  it('surfaces a genuinely unusable payload as a rejection, not as a silent empty playlist', async () => {
    const bad: PlaylistBuildWorkerRequest = { jobId: 1, kind: 'raw-channels', raw: null as unknown as RawChannel[] }
    const response = runPlaylistBuildRequest(bad)
    expect(response.ok).toBe(false)
  })
})
