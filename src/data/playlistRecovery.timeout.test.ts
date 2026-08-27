import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recoverChannelsFromSource } from './playlistRecovery'
import { RequestTimeoutError } from '../core/net/fetchWithTimeout'
import type { M3uUrlSourceRecord } from './session'

// Startup recovery of a plain-M3U playlist used to call
// fetchWithDevCorsFallback with no signal at all, so a host that accepted
// the connection and then stalled held the app on its loading state for as
// long as the TV stayed on. These lock in that it is now bounded, and —
// just as important — that giving up is reported as a FAILURE rather than
// as a successful recovery of an empty playlist.

const SOURCE: M3uUrlSourceRecord = { type: 'm3u-url', url: 'http://provider.test/playlist.m3u' }

function hangingFetch() {
  return vi.fn((_input: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const fail = () => {
        const err = new Error('The operation was aborted.')
        err.name = 'AbortError'
        reject(err)
      }
      if (init?.signal?.aborted) return fail()
      init?.signal?.addEventListener('abort', fail)
    })
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('recoverChannelsFromSource — plain M3U URL', () => {
  it('gives up on a host that never responds instead of hanging forever', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const promise = recoverChannelsFromSource(SOURCE)
    const assertion = expect(promise).rejects.toBeInstanceOf(RequestTimeoutError)
    await vi.advanceTimersByTimeAsync(12_000)
    await assertion
  })

  // The data-loss guard. An empty array here would look to
  // usePlaylistLibrary like a playlist that genuinely has no channels, and
  // a transient network stall would quietly replace a working 30,000-
  // channel library with nothing.
  it('THROWS on timeout rather than resolving to an empty channel list', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const promise = recoverChannelsFromSource(SOURCE)
    const assertion = expect(promise).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(12_000)
    await assertion
  })

  it('does not put the playlist URL (which can carry credentials) in the error message', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const source: M3uUrlSourceRecord = {
      type: 'm3u-url',
      url: 'http://provider.test/get.php?username=alice&password=hunter2',
    }
    const promise = recoverChannelsFromSource(source)
    const assertion = promise.catch((err: Error) => {
      expect(err.message).not.toContain('hunter2')
      expect(err.message).not.toContain('alice')
      expect(err.message).not.toContain('provider.test')
    })
    await vi.advanceTimersByTimeAsync(12_000)
    await assertion
  })

  it('clears its abort timer once the fetch settles, so nothing fires later', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('#EXTM3U\n#EXTINF:-1 tvg-id="a",Channel A\nhttp://s/1.ts\n'),
      } as unknown as Response),
    )
    const channels = await recoverChannelsFromSource(SOURCE)
    expect(channels.length).toBeGreaterThan(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('passes an abort signal to the underlying fetch (it previously passed none)', async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('#EXTM3U\n#EXTINF:-1,Channel A\nhttp://s/1.ts\n'),
    } as unknown as Response)
    vi.stubGlobal('fetch', spy)
    await recoverChannelsFromSource(SOURCE)
    const init = spy.mock.calls[0][1] as RequestInit | undefined
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})
