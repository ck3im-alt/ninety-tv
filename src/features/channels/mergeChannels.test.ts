import { describe, expect, it } from 'vitest'
import { mergeChannelSources } from './mergeChannels'
import type { RawChannel } from '../../data/rawChannel'

function raw(overrides: Partial<RawChannel> & Pick<RawChannel, 'id' | 'name' | 'url'>): RawChannel {
  return overrides
}

describe('mergeChannelSources — identity preservation', () => {
  it('carries an M3U tvg-id through into epgChannelIds and hasEpgChannelId', () => {
    const [channel] = mergeChannelSources([
      raw({ id: '1', name: 'UK | TNT SPORTS 1 FHD', url: 'https://x/1', epgChannelId: 'TNT.Sports.1.uk' }),
    ])
    expect(channel.epgChannelIds).toEqual(['TNT.Sports.1.uk'])
    expect(channel.hasEpgChannelId).toBe(true)
  })

  it('preserves distinct ids across quality variants and dedupes identical ones', () => {
    const channels = mergeChannelSources([
      raw({ id: '1', name: 'UK | TNT SPORTS 1 FHD', url: 'https://x/1', epgChannelId: 'TNT.Sports.1.uk' }),
      raw({ id: '2', name: 'UK | TNT SPORT 1 UHD', url: 'https://x/2', epgChannelId: 'TNT.Sports.1.uk' }),
      raw({ id: '3', name: 'UK | TNT SPORTS 1 HD', url: 'https://x/3', epgChannelId: 'TNT.Sports.1.alt.uk' }),
    ])
    expect(channels).toHaveLength(1)
    const [channel] = channels
    // Identical id appears once; the distinct one from the third source is
    // also retained.
    expect(channel.epgChannelIds).toEqual(['TNT.Sports.1.uk', 'TNT.Sports.1.alt.uk'])
    expect(channel.sources).toHaveLength(3)
  })

  it('retains raw/original provider names for every merged entry', () => {
    const [channel] = mergeChannelSources([
      raw({ id: '1', name: 'UK | TNT SPORTS 1 FHD', url: 'https://x/1', epgChannelId: 'a' }),
      raw({ id: '2', name: 'UK | TNT SPORT 1 UHD', url: 'https://x/2', epgChannelId: 'a' }),
    ])
    expect(channel.rawNames).toEqual(['UK | TNT SPORTS 1 FHD', 'UK | TNT SPORT 1 UHD'])
  })

  it('keeps each source entry\'s own epgChannelId and originalName', () => {
    const [channel] = mergeChannelSources([
      raw({ id: '1', name: 'UK | TNT SPORTS 1 FHD', url: 'https://x/1', epgChannelId: 'a' }),
      raw({ id: '2', name: 'UK | TNT SPORT 1 UHD', url: 'https://x/2', epgChannelId: 'b' }),
    ])
    expect(channel.sources.map((s) => s.epgChannelId)).toEqual(['a', 'b'])
    expect(channel.sources.map((s) => s.originalName)).toEqual(['UK | TNT SPORTS 1 FHD', 'UK | TNT SPORT 1 UHD'])
  })

  it('derives hasEpgChannelId as false and epgChannelIds as empty when no source carried one', () => {
    const [channel] = mergeChannelSources([raw({ id: '1', name: 'Some PPV Stream', url: 'https://x/1' })])
    expect(channel.epgChannelIds).toEqual([])
    expect(channel.hasEpgChannelId).toBe(false)
  })

  it('produces the documented TNT Sports example: one merged channel, one deduped id, both raw names', () => {
    const [channel] = mergeChannelSources([
      raw({ id: '1', name: 'UK | TNT SPORTS 1 FHD', url: 'https://x/1', epgChannelId: 'TNT.Sports.1.uk' }),
      raw({ id: '2', name: 'UK | TNT SPORT 1 UHD', url: 'https://x/2', epgChannelId: 'TNT.Sports.1.uk' }),
    ])
    expect(channel.name).toBe('TNT SPORTS 1')
    expect(channel.epgChannelIds).toEqual(['TNT.Sports.1.uk'])
    expect(channel.rawNames).toContain('UK | TNT SPORTS 1 FHD')
    expect(channel.rawNames).toContain('UK | TNT SPORT 1 UHD')
  })
})
