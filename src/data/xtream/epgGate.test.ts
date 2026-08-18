import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { XtreamCredentials, XtreamEpgListing } from './types'

const getShortEpgMock = vi.fn()
vi.mock('./xtreamClient', () => ({ getShortEpg: (...args: unknown[]) => getShortEpgMock(...args) }))

const CREDS: XtreamCredentials = { server: 'https://panel.example', username: 'u', password: 'p' }

function listing(id: number): XtreamEpgListing {
  return { id: String(id), title: 't', description: '', start: '', end: '', start_timestamp: 0, stop_timestamp: 0, now_playing: 0 }
}

beforeEach(() => {
  vi.resetModules()
  getShortEpgMock.mockReset()
})

describe('getShortEpgLimited', () => {
  it('never runs more than 4 get_short_epg calls concurrently', async () => {
    const { getShortEpgLimited } = await import('./epgGate')
    let active = 0
    let peak = 0
    getShortEpgMock.mockImplementation(async (_creds: XtreamCredentials, streamId: number) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      return [listing(streamId)]
    })

    const streamIds = Array.from({ length: 20 }, (_, i) => i + 1)
    await Promise.all(streamIds.map((id) => getShortEpgLimited(CREDS, id, 4)))

    expect(peak).toBeLessThanOrEqual(4)
    expect(getShortEpgMock).toHaveBeenCalledTimes(20)
  })

  it('dedupes concurrent in-flight requests for the same stream id', async () => {
    const { getShortEpgLimited } = await import('./epgGate')
    getShortEpgMock.mockImplementation(async (_creds: XtreamCredentials, streamId: number) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return [listing(streamId)]
    })

    await Promise.all([getShortEpgLimited(CREDS, 42, 4), getShortEpgLimited(CREDS, 42, 4), getShortEpgLimited(CREDS, 42, 4)])

    expect(getShortEpgMock).toHaveBeenCalledTimes(1)
  })

  it('serves a repeat lookup from cache without hitting the network again', async () => {
    const { getShortEpgLimited } = await import('./epgGate')
    getShortEpgMock.mockResolvedValue([listing(7)])

    await getShortEpgLimited(CREDS, 7, 4)
    await getShortEpgLimited(CREDS, 7, 4)

    expect(getShortEpgMock).toHaveBeenCalledTimes(1)
  })
})
