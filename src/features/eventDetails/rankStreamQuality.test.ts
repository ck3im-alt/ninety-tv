import { describe, expect, it } from 'vitest'
import { bestQualityTier, estimateQualityTier, qualityTierLabel, sortGroupsByQuality } from './rankStreamQuality'
import type { MatchGroup, SourceOption } from './groupChannelMatches'
import type { Channel, ChannelSource } from '../../data/channel'

function makeChannel(name: string, rawNames?: string[]): Channel {
  return { id: name, name, sources: [], rawNames }
}

function makeSourceOption(label: string, name = 'Channel', originalName?: string, rawNames?: string[]): SourceOption {
  const source: ChannelSource = { label, url: `http://example.com/${label}`, originalName }
  return { channel: makeChannel(name, rawNames), source }
}

function makeGroup(key: string, labels: string[]): MatchGroup {
  return {
    key,
    name: key,
    isExactMatch: true,
    confidence: 'confirmed',
    label: key,
    sourceOptions: labels.map((label) => makeSourceOption(label)),
  }
}

describe('estimateQualityTier', () => {
  it('ranks 8K highest, above UHD/4K', () => {
    expect(estimateQualityTier(makeSourceOption('8K'))).toBe(5)
    expect(estimateQualityTier(makeSourceOption('UHD'))).toBe(4)
  })

  it('ranks UHD/4K below 8K', () => {
    expect(estimateQualityTier(makeSourceOption('UHD'))).toBe(4)
    expect(estimateQualityTier(makeSourceOption('4K'))).toBe(4)
  })

  it('ranks FHD/1080/FULL HD below UHD', () => {
    expect(estimateQualityTier(makeSourceOption('FHD'))).toBe(3)
    expect(estimateQualityTier(makeSourceOption('RAW HD'))).toBe(3)
    expect(estimateQualityTier(makeSourceOption('FULL HD'))).toBe(3)
    expect(estimateQualityTier(makeSourceOption('1080'))).toBe(3)
    expect(estimateQualityTier(makeSourceOption('1080p'))).toBe(3)
  })

  it('ranks HD/720 below FHD', () => {
    expect(estimateQualityTier(makeSourceOption('HD'))).toBe(2)
    expect(estimateQualityTier(makeSourceOption('720p'))).toBe(2)
  })

  it('does not let UHD false-match as plain HD via substring', () => {
    expect(estimateQualityTier(makeSourceOption('UHD'))).toBe(4)
  })

  it('ranks SD lowest of the known tiers', () => {
    expect(estimateQualityTier(makeSourceOption('SD'))).toBe(1)
  })

  it('falls back to 0 for unrecognized labels', () => {
    expect(estimateQualityTier(makeSourceOption('RAW'))).toBe(0)
    expect(estimateQualityTier(makeSourceOption('Default'))).toBe(0)
  })

  it('does not treat codec/marketing words as a resolution', () => {
    expect(estimateQualityTier(makeSourceOption('HEVC'))).toBe(0)
    expect(estimateQualityTier(makeSourceOption('H265'))).toBe(0)
    expect(estimateQualityTier(makeSourceOption('H264'))).toBe(0)
    expect(estimateQualityTier(makeSourceOption('VIP'))).toBe(0)
  })

  it('still finds the real tier when a codec word is combined with it', () => {
    expect(estimateQualityTier(makeSourceOption('8K HEVC'))).toBe(5)
  })

  it('detects a hint from the channel name when the label has none', () => {
    expect(estimateQualityTier(makeSourceOption('Default', 'Sky Sports UHD'))).toBe(4)
  })

  it('falls back to source.originalName when label/channel name carry no tag', () => {
    // Mirrors a real PPV entry: the cleaned label/channel name have already
    // had the quality tag stripped, but the pre-normalization raw text
    // (originalName) still has it -- see rankStreamQuality.ts's evidenceText.
    const option = makeSourceOption('Default', 'TV2 Play PPV 9', 'LIVE | TEAM A - TEAM B | 8K EXCLUSIVE | NO: TV2 PLAY PPV 9')
    expect(estimateQualityTier(option)).toBe(5)
  })

  it('falls back to channel.rawNames when no other field carries a tag', () => {
    const option = makeSourceOption('Default', 'TV2 Play PPV 9', undefined, ['NO| 4K | TV2 PLAY PPV 9'])
    expect(estimateQualityTier(option)).toBe(4)
  })

  it('is fancy-Unicode safe (superscript/modifier-letter quality glyphs)', () => {
    // ᵁᴴᴰ folds to UHD (modifier-letter glyphs, see fancyUnicode.ts)
    expect(estimateQualityTier(makeSourceOption('ᵁᴴᴰ'))).toBe(4)
  })

  // Real-sanitized playlist names from fixtures/channel-identity/cases.json
  // — confirms detection still works against actual observed provider
  // naming, not just synthetic strings.
  it('detects UHD in real provider naming with an unrecognized trailing resolution token', () => {
    expect(estimateQualityTier(makeSourceOption('Default', 'NOW: SKY SPORTS MAIN EVENT UHD 3840P'))).toBe(4)
    expect(estimateQualityTier(makeSourceOption('Default', 'TNT SPORTS ULTIMATE 4K & 3840P'))).toBe(4)
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
    expect(qualityTierLabel(5)).toBe('8K')
    expect(qualityTierLabel(4)).toBe('UHD')
    expect(qualityTierLabel(3)).toBe('1080p')
    expect(qualityTierLabel(2)).toBe('720p')
    expect(qualityTierLabel(1)).toBe('SD')
    expect(qualityTierLabel(0)).toBeNull()
  })
})

describe('sortGroupsByQuality', () => {
  it('sorts best quality first, 8K above UHD', () => {
    const groups = [makeGroup('sd', ['SD']), makeGroup('8k', ['8K']), makeGroup('uhd', ['UHD']), makeGroup('hd', ['HD'])]
    expect(sortGroupsByQuality(groups).map((g) => g.key)).toEqual(['8k', 'uhd', 'hd', 'sd'])
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
