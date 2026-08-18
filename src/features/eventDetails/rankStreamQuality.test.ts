import { describe, expect, it } from 'vitest'
import { bestQualityTier, estimateQualityTier, qualityTierLabel, sortGroupsByQuality } from './rankStreamQuality'
import type { MatchGroup, SourceOption } from './groupChannelMatches'
import type { Channel, ChannelSource } from '../../data/channel'

function makeChannel(name: string): Channel {
  return { id: name, name, sources: [] }
}

function makeSourceOption(label: string, name = 'Channel'): SourceOption {
  const source: ChannelSource = { label, url: `http://example.com/${label}` }
  return { channel: makeChannel(name), source }
}

function makeGroup(key: string, labels: string[]): MatchGroup {
  return {
    key,
    name: key,
    isExactMatch: true,
    label: key,
    sourceOptions: labels.map((label) => makeSourceOption(label)),
  }
}

describe('estimateQualityTier', () => {
  it('ranks UHD/4K highest', () => {
    expect(estimateQualityTier(makeSourceOption('UHD'))).toBe(4)
    expect(estimateQualityTier(makeSourceOption('4K'))).toBe(4)
  })

  it('ranks FHD/1080 below UHD', () => {
    expect(estimateQualityTier(makeSourceOption('FHD'))).toBe(3)
    expect(estimateQualityTier(makeSourceOption('RAW HD'))).toBe(3)
  })

  it('ranks HD/720 below FHD', () => {
    expect(estimateQualityTier(makeSourceOption('HD'))).toBe(2)
  })

  it('ranks SD lowest of the known tiers', () => {
    expect(estimateQualityTier(makeSourceOption('SD'))).toBe(1)
  })

  it('falls back to 0 for unrecognized labels', () => {
    expect(estimateQualityTier(makeSourceOption('RAW'))).toBe(0)
    expect(estimateQualityTier(makeSourceOption('Default'))).toBe(0)
  })

  it('detects a hint from the channel name when the label has none', () => {
    expect(estimateQualityTier(makeSourceOption('Default', 'Sky Sports UHD'))).toBe(4)
  })
})

describe('bestQualityTier', () => {
  it('takes the best tier across a group of source options', () => {
    const group = makeGroup('g', ['SD', 'UHD', 'HD'])
    expect(bestQualityTier(group)).toBe(4)
  })

  it('is 0 for a group with no recognizable quality hints', () => {
    const group = makeGroup('g', ['RAW', 'Default'])
    expect(bestQualityTier(group)).toBe(0)
  })
})

describe('qualityTierLabel', () => {
  it('maps tiers to display labels, and 0 to no badge', () => {
    expect(qualityTierLabel(4)).toBe('UHD')
    expect(qualityTierLabel(3)).toBe('1080p')
    expect(qualityTierLabel(2)).toBe('720p')
    expect(qualityTierLabel(1)).toBe('SD')
    expect(qualityTierLabel(0)).toBeNull()
  })
})

describe('sortGroupsByQuality', () => {
  it('sorts best quality first', () => {
    const groups = [makeGroup('sd', ['SD']), makeGroup('uhd', ['UHD']), makeGroup('hd', ['HD'])]
    expect(sortGroupsByQuality(groups).map((g) => g.key)).toEqual(['uhd', 'hd', 'sd'])
  })

  it('preserves incoming order among groups that tie (including all-unknown)', () => {
    const groups = [makeGroup('a', ['RAW']), makeGroup('b', ['Default']), makeGroup('c', ['VIP'])]
    expect(sortGroupsByQuality(groups).map((g) => g.key)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input array', () => {
    const groups = [makeGroup('sd', ['SD']), makeGroup('uhd', ['UHD'])]
    const original = [...groups]
    sortGroupsByQuality(groups)
    expect(groups).toEqual(original)
  })
})
