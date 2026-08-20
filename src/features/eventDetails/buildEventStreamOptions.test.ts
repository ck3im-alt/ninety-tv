import { describe, expect, it } from 'vitest'
import { buildEventStreamOptions, rankEventStreamOptions, partitionStreamOptions } from './buildEventStreamOptions'
import type { EventStreamOption } from './buildEventStreamOptions'
import type { ChannelMatch } from '../../data/sports/channelMatch'
import type { Channel, ChannelSource } from '../../data/channel'

let channelCounter = 0
function makeChannel(name: string, groupTitle: string, sources: ChannelSource[] = [{ label: 'Default', url: 'http://x/1' }]): Channel {
  channelCounter += 1
  return { id: `ch-${channelCounter}`, name, groupTitle, sources }
}

function ninetyMatch(overrides: Partial<ChannelMatch> & { channel: Channel }): ChannelMatch {
  return { source: 'ninety', label: overrides.channel.name, isExactMatch: false, ...overrides }
}

const NO_FAVORITES = new Set<string>()

describe('buildEventStreamOptions', () => {
  it('resolves country from the playlist groupTitle', () => {
    const channel = makeChannel('TV 2 Sport', 'NO| Sports')
    const [option] = buildEventStreamOptions([ninetyMatch({ channel, isExactMatch: true })], NO_FAVORITES)
    expect(option.countryName).toBe('Norway')
  })

  it('falls back to the ninety-api broadcast country when the playlist category has none', () => {
    const channel = makeChannel('TV 2 Sport', 'Sports')
    const match = ninetyMatch({ channel, isExactMatch: true, broadcastCountry: 'NO' })
    const [option] = buildEventStreamOptions([match], NO_FAVORITES)
    expect(option.countryName).toBe('Norway')
  })

  it('marks a group favorited when any of its channels is favorited', () => {
    const channel = makeChannel('TV 2 Sport', 'NO| Sports')
    const [option] = buildEventStreamOptions([ninetyMatch({ channel, isExactMatch: true })], new Set([channel.id]))
    expect(option.isFavorite).toBe(true)
  })

  it('deduplicates same-tier quality sources down to one entry per tier', () => {
    const sources: ChannelSource[] = [
      { label: 'UHD', url: 'http://x/1' },
      { label: 'UHD', url: 'http://x/2' },
      { label: 'HD', url: 'http://x/3' },
    ]
    const channel = makeChannel('TV 2 Sport', 'NO| Sports', sources)
    const [option] = buildEventStreamOptions([ninetyMatch({ channel, isExactMatch: true })], NO_FAVORITES)
    expect(option.sourceOptions.map((s) => s.qualityLabel)).toEqual(['UHD', '720p'])
  })

  it('does not fabricate a quality label for a group with no recognizable quality hints', () => {
    const channel = makeChannel('TV 2 Sport', 'NO| Sports', [{ label: 'Default', url: 'http://x/1' }])
    const [option] = buildEventStreamOptions([ninetyMatch({ channel, isExactMatch: true })], NO_FAVORITES)
    expect(option.sourceOptions).toHaveLength(1)
    expect(option.sourceOptions[0].qualityLabel).toBeNull()
  })

  it('sorts source options best-quality first, so index 0 is the correct default selection', () => {
    const sources: ChannelSource[] = [
      { label: 'SD', url: 'http://x/1' },
      { label: 'UHD', url: 'http://x/2' },
      { label: 'HD', url: 'http://x/3' },
    ]
    const channel = makeChannel('TV 2 Sport', 'NO| Sports', sources)
    const [option] = buildEventStreamOptions([ninetyMatch({ channel, isExactMatch: true })], NO_FAVORITES)
    expect(option.sourceOptions[0].qualityLabel).toBe('UHD')
    expect(option.bestQualityTier).toBe(4)
  })
})

function makeOption(overrides: Partial<EventStreamOption>): EventStreamOption {
  channelCounter += 1
  return {
    key: `opt-${channelCounter}`,
    displayName: `Option ${channelCounter}`,
    countryName: null,
    matchConfidence: 'likely',
    sourceOptions: [],
    bestQualityTier: 0,
    isFavorite: false,
    ...overrides,
  }
}

describe('rankEventStreamOptions', () => {
  it('lets preferred country win between otherwise comparable trusted streams', () => {
    const norway = makeOption({ key: 'no', matchConfidence: 'confirmed', countryName: 'Norway', bestQualityTier: 3 })
    const sweden = makeOption({ key: 'se', matchConfidence: 'confirmed', countryName: 'Sweden', bestQualityTier: 3 })
    const ranked = rankEventStreamOptions([sweden, norway], ['Norway'])
    expect(ranked.map((o) => o.key)).toEqual(['no', 'se'])
  })

  // Regression for the redesign task's second pass: once both streams have
  // already cleared the trust bar (neither is a loose/fuzzy candidate — see
  // partitionStreamOptions, which is what actually keeps candidates out of
  // Top 3 regardless of this comparator), a minor confirmed-vs-likely
  // difference must not keep a dramatically better-quality stream from
  // ranking first. An event-specific 8K PPV feed beats a stable 720p linear
  // channel in the same preferred country, even though the PPV match is
  // only 'likely' and the linear channel is 'confirmed'.
  it('lets an 8K trusted PPV stream outrank a 720p confirmed stream in the same preferred country', () => {
    const linear720p = makeOption({ key: 'linear', matchConfidence: 'confirmed', countryName: 'Norway', bestQualityTier: 2 })
    const ppv8k = makeOption({ key: 'ppv', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 5 })
    const ranked = rankEventStreamOptions([linear720p, ppv8k], ['Norway'])
    expect(ranked.map((o) => o.key)).toEqual(['ppv', 'linear'])
  })

  it('lets higher quality win within the same trust tier and country relevance', () => {
    const sd = makeOption({ key: 'sd', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 1 })
    const uhd = makeOption({ key: 'uhd', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 4 })
    const ranked = rankEventStreamOptions([sd, uhd], ['Norway'])
    expect(ranked.map((o) => o.key)).toEqual(['uhd', 'sd'])
  })

  it('falls back to confidence as a tie-break once country and quality are equal', () => {
    const confirmed = makeOption({ key: 'confirmed', matchConfidence: 'confirmed', countryName: 'Norway', bestQualityTier: 3 })
    const likely = makeOption({ key: 'likely', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 3 })
    const ranked = rankEventStreamOptions([likely, confirmed], ['Norway'])
    expect(ranked.map((o) => o.key)).toEqual(['confirmed', 'likely'])
  })

  it('uses favorite status as the deciding tie-break when everything else is equal', () => {
    const notFavorite = makeOption({ key: 'not-fav', matchConfidence: 'likely', bestQualityTier: 3, isFavorite: false })
    const favorite = makeOption({ key: 'fav', matchConfidence: 'likely', bestQualityTier: 3, isFavorite: true })
    const ranked = rankEventStreamOptions([notFavorite, favorite], [])
    expect(ranked.map((o) => o.key)).toEqual(['fav', 'not-fav'])
  })

  it('keeps stable incoming order among options that tie on every criterion', () => {
    const a = makeOption({ key: 'a', matchConfidence: 'likely', bestQualityTier: 2 })
    const b = makeOption({ key: 'b', matchConfidence: 'likely', bestQualityTier: 2 })
    const c = makeOption({ key: 'c', matchConfidence: 'likely', bestQualityTier: 2 })
    const ranked = rankEventStreamOptions([a, b, c], [])
    expect(ranked.map((o) => o.key)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input array', () => {
    const a = makeOption({ key: 'a', matchConfidence: 'candidate' })
    const b = makeOption({ key: 'b', matchConfidence: 'confirmed' })
    const input = [a, b]
    const original = [...input]
    rankEventStreamOptions(input, [])
    expect(input).toEqual(original)
  })
})

describe('partitionStreamOptions', () => {
  it('never lets a candidate stream into the top 3, even with a higher quality tier', () => {
    const candidate4k = makeOption({ key: 'candidate-4k', matchConfidence: 'candidate', bestQualityTier: 4 })
    const trusted = makeOption({ key: 'trusted', matchConfidence: 'likely', bestQualityTier: 1 })
    const ranked = rankEventStreamOptions([candidate4k, trusted], [])
    const { top, candidates } = partitionStreamOptions(ranked)
    expect(top.map((o) => o.key)).toEqual(['trusted'])
    expect(candidates.map((o) => o.key)).toEqual(['candidate-4k'])
  })

  it('quality never promotes a candidate into trusted status (fuzzy 8K vs trusted 720p, same country)', () => {
    const fuzzy8k = makeOption({ key: 'fuzzy', matchConfidence: 'candidate', countryName: 'Norway', bestQualityTier: 5 })
    const trusted720p = makeOption({ key: 'trusted', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 2 })
    const ranked = rankEventStreamOptions([fuzzy8k, trusted720p], ['Norway'])
    const { top, candidates } = partitionStreamOptions(ranked)
    expect(top.map((o) => o.key)).toEqual(['trusted'])
    expect(candidates.map((o) => o.key)).toEqual(['fuzzy'])
  })

  it('works with fewer than 3 trusted streams, without padding from candidates', () => {
    const trusted = makeOption({ key: 'trusted', matchConfidence: 'confirmed' })
    const candidate = makeOption({ key: 'candidate', matchConfidence: 'candidate' })
    const { top, rest, candidates } = partitionStreamOptions([trusted, candidate])
    expect(top.map((o) => o.key)).toEqual(['trusted'])
    expect(rest).toEqual([])
    expect(candidates.map((o) => o.key)).toEqual(['candidate'])
  })

  it('caps top at 3 and puts the remainder in rest', () => {
    const options = [1, 2, 3, 4, 5].map((n) => makeOption({ key: `t${n}`, matchConfidence: 'likely' }))
    const { top, rest } = partitionStreamOptions(options)
    expect(top.map((o) => o.key)).toEqual(['t1', 't2', 't3'])
    expect(rest.map((o) => o.key)).toEqual(['t4', 't5'])
  })
})
