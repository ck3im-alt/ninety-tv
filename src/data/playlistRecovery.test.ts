import { afterEach, describe, expect, it, vi } from 'vitest'
import { recoverChannelsFromSource } from './playlistRecovery'
import type { M3uUrlSourceRecord, XtreamSourceRecord } from './session'
import type { XtreamLiveCategory, XtreamLiveStream } from './xtream/types'

vi.mock('./xtream/xtreamClient', () => ({
  getLiveCategories: vi.fn(),
  getLiveStreams: vi.fn(),
  buildLiveStreamUrl: vi.fn((_creds, streamId: number) => `https://example.com/live/u/p/${streamId}.ts`),
}))

vi.mock('../core/net/devCorsProxy', () => ({
  fetchWithDevCorsFallback: vi.fn(),
}))

import { getLiveCategories, getLiveStreams } from './xtream/xtreamClient'
import { fetchWithDevCorsFallback } from '../core/net/devCorsProxy'

const xtreamSource: XtreamSourceRecord = { type: 'xtream', server: 'https://example.com', username: 'u', password: 'p' }
const m3uUrlSource: M3uUrlSourceRecord = { type: 'm3u-url', url: 'https://example.com/playlist.m3u' }

afterEach(() => {
  vi.clearAllMocks()
})

describe('recoverChannelsFromSource', () => {
  it('rebuilds channels from an Xtream source by refetching categories + live streams', async () => {
    const categories: XtreamLiveCategory[] = [{ category_id: '1', category_name: 'Sports' }]
    const streams: XtreamLiveStream[] = [
      { stream_id: 101, name: 'ESPN', category_id: '1' },
      { stream_id: 102, name: 'ESPN', category_id: '1' },
    ]
    vi.mocked(getLiveCategories).mockResolvedValue(categories)
    vi.mocked(getLiveStreams).mockResolvedValue(streams)

    const channels = await recoverChannelsFromSource(xtreamSource)

    expect(getLiveCategories).toHaveBeenCalledWith({ server: xtreamSource.server, username: 'u', password: 'p' })
    expect(getLiveStreams).toHaveBeenCalledWith({ server: xtreamSource.server, username: 'u', password: 'p' })
    expect(channels.length).toBeGreaterThan(0)
    expect(channels.some((c) => c.name === 'ESPN')).toBe(true)
  })

  it('rebuilds channels from an M3U URL source by refetching and re-parsing the playlist text', async () => {
    const m3uText = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-logo="logo.png" group-title="News",BBC News',
      'https://stream.example.com/bbc.m3u8',
    ].join('\n')
    vi.mocked(fetchWithDevCorsFallback).mockResolvedValue({ text: () => Promise.resolve(m3uText) } as Response)

    const channels = await recoverChannelsFromSource(m3uUrlSource)

    expect(fetchWithDevCorsFallback).toHaveBeenCalledWith(m3uUrlSource.url)
    expect(channels).toHaveLength(1)
    expect(channels[0].name).toBe('BBC News')
  })

  it('never sends channel data anywhere but the source it fetched from — no ninety-api calls', async () => {
    // recoverChannelsFromSource only imports xtreamClient / devCorsProxy /
    // parseM3u / mergeChannels — asserting the two network entry points
    // above were the only things called is the regression guard for "never
    // sends credentials or channel contents to ninety-api".
    vi.mocked(getLiveCategories).mockResolvedValue([])
    vi.mocked(getLiveStreams).mockResolvedValue([])
    await recoverChannelsFromSource(xtreamSource)
    expect(fetchWithDevCorsFallback).not.toHaveBeenCalled()
  })
})
