import { describe, expect, it } from 'vitest'
import {
  buildEventStreamOptions,
  rankEventStreamOptions,
  partitionStreamOptions,
  scoreEventStreamOption,
  countryBucketRank,
  groupOptionsByCountry,
  availableStreamFilters,
  optionsForFilter,
} from './buildEventStreamOptions'
import type { EventStreamOption, RankedEventStreamOption, StreamRankingPreferences } from './buildEventStreamOptions'
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

// Preference-shape helper — most tests only care about one dimension.
function prefs(overrides: Partial<StreamRankingPreferences> = {}): StreamRankingPreferences {
  return { favoriteCountries: [], streamType: 'auto', ...overrides }
}

describe('buildEventStreamOptions', () => {
  it('resolves country name AND code from the playlist groupTitle', () => {
    const channel = makeChannel('TV 2 Sport', 'NO| Sports')
    const [option] = buildEventStreamOptions([ninetyMatch({ channel, isExactMatch: true })], NO_FAVORITES)
    expect(option.countryName).toBe('Norway')
    expect(option.countryCode).toBe('NO')
  })

  it('falls back to the ninety-api broadcast country when the playlist category has none', () => {
    const channel = makeChannel('TV 2 Sport', 'Sports')
    const match = ninetyMatch({ channel, isExactMatch: true, broadcastCountry: 'NO' })
    const [option] = buildEventStreamOptions([match], NO_FAVORITES)
    expect(option.countryName).toBe('Norway')
    expect(option.countryCode).toBe('NO')
  })

  it('classifies a ninety-matched linear channel as sourceType tv', () => {
    const channel = makeChannel('TV 2 Sport', 'NO| Sports')
    const [option] = buildEventStreamOptions([ninetyMatch({ channel, isExactMatch: true })], NO_FAVORITES)
    expect(option.sourceType).toBe('tv')
  })

  it('classifies a ppvName-matched entry as sourceType event', () => {
    const channel = makeChannel('LIVE | A - B | NO: Viaplay PPV 4', 'NO| PPV')
    const [option] = buildEventStreamOptions([{ channel, source: 'ppvName', label: channel.name, isExactMatch: false }], NO_FAVORITES)
    expect(option.sourceType).toBe('event')
  })

  it('classifies a PPV-categorized channel as event even when another stage matched it', () => {
    const channel = makeChannel('Some Feed', 'NO| PPV VIP')
    const [option] = buildEventStreamOptions([ninetyMatch({ channel })], NO_FAVORITES)
    expect(option.sourceType).toBe('event')
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

  // Task section 5/23: quality-variant duplicates must occupy ONE ranking
  // position — grouping collapses them before ranking ever sees them.
  it('three quality variants of the same channel produce exactly one rankable group', () => {
    const matches = ['V SPORT PL 1 FHD', 'V SPORT PL 1 HD', 'V SPORT PL 1 SD'].map((name) =>
      ninetyMatch({ channel: makeChannel(name, 'NO| Sports'), isExactMatch: true }),
    )
    const options = buildEventStreamOptions(matches, NO_FAVORITES)
    expect(options).toHaveLength(1)
    expect(options[0].sourceOptions.map((s) => s.qualityLabel)).toEqual(['1080p', '720p', 'SD'])
  })

  it('two different numbered broadcast channels stay separate (TNT safety)', () => {
    const matches = ['TNT Sports 1', 'TNT Sports 10'].map((name) => ninetyMatch({ channel: makeChannel(name, 'UK| Sports'), isExactMatch: true }))
    const options = buildEventStreamOptions(matches, NO_FAVORITES)
    expect(options).toHaveLength(2)
  })

  it('two different numbered channels (V SPORT PL 1 / V SPORT PL 2) stay separate', () => {
    const matches = ['V SPORT PL 1', 'V SPORT PL 2'].map((name) => ninetyMatch({ channel: makeChannel(name, 'NO| Sports'), isExactMatch: true }))
    const options = buildEventStreamOptions(matches, NO_FAVORITES)
    expect(options).toHaveLength(2)
  })
})

// Task sections 3-8/12-13: correct stream-GROUP identity for event-specific
// (PPV) streams — quality/slot-mirror duplicates of the SAME confidently-
// resolved event must merge into one group with quality as a variant
// underneath, while genuinely different broadcasts (different provider, or
// an event identity that was never actually confirmed) must not.
describe('PPV stream-group identity (task sections 3-8, 12-13)', () => {
  const MALAGA_CONTEXT = { homeTeam: 'Málaga CF', awayTeam: 'Deportivo La Coruña', dateTimeUtc: '2026-08-24T19:25:00.000Z' }

  function ppvNameMatch(name: string, groupTitle: string): ChannelMatch {
    const channel = makeChannel(name, groupTitle)
    return { channel, source: 'ppvName', label: name, isExactMatch: false }
  }

  function candidateMatch(name: string, groupTitle: string): ChannelMatch {
    const channel = makeChannel(name, groupTitle)
    return { channel, source: 'broadcasterMap', label: name, isExactMatch: false }
  }

  // The exact screenshot regression (task section 12): the SAME Norwegian
  // Viaplay stream for the SAME event, published as two raw playlist rows
  // differing only by slot number and quality tag, must become ONE stream
  // group with both qualities as variants underneath — not two rows.
  it('merges duplicate raw entries for the same PPV event/provider into one group (regression: two Viaplay rows)', () => {
    const eightK = ppvNameMatch(
      'LIVE | Málaga CF - Deportivo La Coruña | Sun 24 Aug 21:25 CEST (NO) | 8K EXCLUSIVE | NO: Viaplay PPV 03',
      'NO| PPV',
    )
    const unknown = ppvNameMatch('LIVE | Málaga CF - Deportivo La Coruña | Sun 24 Aug 21:25 CEST (NO) | NO: Viaplay PPV 04', 'NO| PPV')

    const options = buildEventStreamOptions([eightK, unknown], NO_FAVORITES, MALAGA_CONTEXT)

    expect(options).toHaveLength(1)
    expect(options[0].displayName).toBe('Viaplay | Málaga CF - Deportivo La Coruña | 21:25')
    expect(options[0].sourceOptions).toHaveLength(2)
    expect(options[0].sourceOptions[0].qualityLabel).toBe('8K') // the default variant
    expect(options[0].sourceOptions[1].qualityLabel).toBeNull() // retained as an alternate/fallback source, not discarded
  })

  it('same provider/event confirmed via three raw entries at three different qualities — still one group', () => {
    const matches = [
      ppvNameMatch('LIVE | Málaga CF - Deportivo La Coruña | Sun 24 Aug 21:25 CEST (NO) | 8K EXCLUSIVE | NO: Viaplay PPV 03', 'NO| PPV'),
      ppvNameMatch('LIVE | Málaga CF - Deportivo La Coruña | Sun 24 Aug 21:25 CEST (NO) | FHD | NO: Viaplay PPV 04', 'NO| PPV'),
      ppvNameMatch('LIVE | Málaga CF - Deportivo La Coruña | Sun 24 Aug 21:25 CEST (NO) | NO: Viaplay PPV 05', 'NO| PPV'),
    ]
    const options = buildEventStreamOptions(matches, NO_FAVORITES, MALAGA_CONTEXT)
    expect(options).toHaveLength(1)
    expect(options[0].sourceOptions.map((s) => s.qualityLabel)).toEqual(['8K', '1080p', null])
  })

  it('same event, different providers — two groups', () => {
    const viaplay = ppvNameMatch('LIVE | Málaga CF - Deportivo La Coruña | Sun 24 Aug 21:25 CEST (NO) | NO: Viaplay PPV 03', 'NO| PPV')
    const dazn = ppvNameMatch('LIVE | Málaga CF - Deportivo La Coruña | Sun 24 Aug 21:25 CEST (NO) | NO: DAZN PPV 07', 'NO| PPV')
    const options = buildEventStreamOptions([viaplay, dazn], NO_FAVORITES, MALAGA_CONTEXT)
    expect(options).toHaveLength(2)
  })

  // Unresolved/loose (candidate-confidence) event feeds are NOT confirmed
  // to be the current event's own broadcast at all (see
  // groupChannelMatches.ts's verifiedSameEvent — 'candidate' is never
  // verified, regardless of eventContext) — for those, the slot/feed number
  // stays a required discriminator, exactly the "unresolved event feeds"
  // case task section 6 calls out.
  it('same provider, different (unresolved/candidate-confidence) slots stay separate', () => {
    const slot03 = candidateMatch('LIVE | Málaga CF - Deportivo La Coruña | NO: Viaplay PPV 03', 'NO| PPV')
    const slot04 = candidateMatch('LIVE | Arsenal - Liverpool | NO: Viaplay PPV 04', 'NO| PPV')
    const options = buildEventStreamOptions([slot03, slot04], NO_FAVORITES, MALAGA_CONTEXT)
    expect(options).toHaveLength(2)
  })
})

function makeOption(overrides: Partial<EventStreamOption>): EventStreamOption {
  channelCounter += 1
  return {
    key: `opt-${channelCounter}`,
    displayName: `Option ${channelCounter}`,
    countryName: null,
    countryCode: null,
    sourceType: 'tv',
    matchConfidence: 'likely',
    matchSource: 'ninety',
    displayParts: { provider: null, eventTitle: null, startTime: null, quality: null },
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
    const ranked = rankEventStreamOptions([sweden, norway], prefs({ favoriteCountries: ['Norway'] }))
    expect(ranked.map((o) => o.key)).toEqual(['no', 'se'])
  })

  it('ranks the PRIMARY country above another preferred country, all else equal', () => {
    const secondary = makeOption({ key: 'se', matchConfidence: 'confirmed', countryName: 'Sweden', bestQualityTier: 3 })
    const primary = makeOption({ key: 'no', matchConfidence: 'confirmed', countryName: 'Norway', bestQualityTier: 3 })
    const ranked = rankEventStreamOptions([secondary, primary], prefs({ favoriteCountries: ['Norway', 'Sweden'] }))
    expect(ranked.map((o) => o.key)).toEqual(['no', 'se'])
  })

  it('a secondary preferred country still beats a non-preferred one', () => {
    const other = makeOption({ key: 'dk', matchConfidence: 'confirmed', countryName: 'Denmark', bestQualityTier: 3 })
    const secondary = makeOption({ key: 'se', matchConfidence: 'confirmed', countryName: 'Sweden', bestQualityTier: 3 })
    const ranked = rankEventStreamOptions([other, secondary], prefs({ favoriteCountries: ['Norway', 'Sweden'] }))
    expect(ranked.map((o) => o.key)).toEqual(['se', 'dk'])
  })

  // Regression for the redesign task's second pass: once both streams have
  // already cleared the trust bar, a minor confirmed-vs-likely difference
  // must not keep a dramatically better-quality stream from ranking first.
  it('lets an 8K trusted PPV stream outrank a 720p confirmed stream in the same preferred country', () => {
    const linear720p = makeOption({ key: 'linear', matchConfidence: 'confirmed', countryName: 'Norway', bestQualityTier: 2 })
    const ppv8k = makeOption({ key: 'ppv', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 5 })
    const ranked = rankEventStreamOptions([linear720p, ppv8k], prefs({ favoriteCountries: ['Norway'] }))
    expect(ranked.map((o) => o.key)).toEqual(['ppv', 'linear'])
  })

  it('lets higher quality win within the same trust tier and country relevance', () => {
    const sd = makeOption({ key: 'sd', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 1 })
    const uhd = makeOption({ key: 'uhd', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 4 })
    const ranked = rankEventStreamOptions([sd, uhd], prefs({ favoriteCountries: ['Norway'] }))
    expect(ranked.map((o) => o.key)).toEqual(['uhd', 'sd'])
  })

  // Country-grouping redesign (2026-08-24): country is now the OUTER sort
  // key, not one term in a mixed weighted score — a preferred country
  // (primary or secondary) beats a non-preferred one regardless of a
  // quality gap between them, since the old weighted score could bury a
  // primary-country stream under an unrelated market's 8K feed (real user
  // report: a Norwegian Viaplay stream sank below Canada/USA/Germany).
  // Eligibility (isRecommendable/'candidate' exclusion) is a separate,
  // still-untouched gate — this is only about ordering among options that
  // already cleared it.
  it('a secondary preferred country beats a non-preferred one even across a large quality gap (SD vs 8K)', () => {
    const preferredSd = makeOption({ key: 'sd', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 1 })
    const foreign8k = makeOption({ key: '8k', matchConfidence: 'likely', countryName: 'Germany', bestQualityTier: 5 })
    const ranked = rankEventStreamOptions([preferredSd, foreign8k], prefs({ favoriteCountries: ['Sweden', 'Norway'] }))
    expect(ranked.map((o) => o.key)).toEqual(['sd', '8k'])
  })

  // The primary country holds even against a quality + confidence gap
  // together — country bucket is now checked strictly before score, so
  // nothing on the score side (which is where confidence lives) can move an
  // option out of its bucket.
  it('the primary country holds against a pure quality gap, and against quality + confidence together', () => {
    const primarySd = makeOption({ key: 'sd', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 1 })
    const foreign8k = makeOption({ key: '8k', matchConfidence: 'likely', countryName: 'Germany', bestQualityTier: 5 })
    expect(rankEventStreamOptions([foreign8k, primarySd], prefs({ favoriteCountries: ['Norway'] })).map((o) => o.key)).toEqual(['sd', '8k'])

    const foreign8kConfirmed = makeOption({ key: '8k', matchConfidence: 'confirmed', countryName: 'Germany', bestQualityTier: 5 })
    expect(rankEventStreamOptions([primarySd, foreign8kConfirmed], prefs({ favoriteCountries: ['Norway'] })).map((o) => o.key)).toEqual(['sd', '8k'])
  })

  it('but a modest quality edge does NOT overcome a preferred country', () => {
    const preferred720 = makeOption({ key: 'pref', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 2 })
    const foreign1080 = makeOption({ key: 'foreign', matchConfidence: 'likely', countryName: 'Germany', bestQualityTier: 3 })
    const ranked = rankEventStreamOptions([foreign1080, preferred720], prefs({ favoriteCountries: ['Norway'] }))
    expect(ranked.map((o) => o.key)).toEqual(['pref', 'foreign'])
  })

  it('falls back to confidence as a tie-break once country and quality are equal', () => {
    const confirmed = makeOption({ key: 'confirmed', matchConfidence: 'confirmed', countryName: 'Norway', bestQualityTier: 3 })
    const likely = makeOption({ key: 'likely', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 3 })
    const ranked = rankEventStreamOptions([likely, confirmed], prefs({ favoriteCountries: ['Norway'] }))
    expect(ranked.map((o) => o.key)).toEqual(['confirmed', 'likely'])
  })

  it('uses favorite status as the deciding tie-break when everything else is equal', () => {
    const notFavorite = makeOption({ key: 'not-fav', matchConfidence: 'likely', bestQualityTier: 3, isFavorite: false })
    const favorite = makeOption({ key: 'fav', matchConfidence: 'likely', bestQualityTier: 3, isFavorite: true })
    const ranked = rankEventStreamOptions([notFavorite, favorite], prefs())
    expect(ranked.map((o) => o.key)).toEqual(['fav', 'not-fav'])
  })

  it('keeps stable incoming order among options that tie on every criterion', () => {
    const a = makeOption({ key: 'a', matchConfidence: 'likely', bestQualityTier: 2 })
    const b = makeOption({ key: 'b', matchConfidence: 'likely', bestQualityTier: 2 })
    const c = makeOption({ key: 'c', matchConfidence: 'likely', bestQualityTier: 2 })
    const ranked = rankEventStreamOptions([a, b, c], prefs())
    expect(ranked.map((o) => o.key)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input array or its options', () => {
    const a = makeOption({ key: 'a', matchConfidence: 'candidate' })
    const b = makeOption({ key: 'b', matchConfidence: 'confirmed' })
    const input = [a, b]
    const original = [...input]
    rankEventStreamOptions(input, prefs())
    expect(input).toEqual(original)
    expect('rankingScore' in a).toBe(false)
  })

  describe('stream-type preference', () => {
    const tvOption = () => makeOption({ key: 'tv', sourceType: 'tv', matchConfidence: 'likely', bestQualityTier: 3 })
    const eventOption = () => makeOption({ key: 'event', sourceType: 'event', matchConfidence: 'likely', bestQualityTier: 3 })

    it('AUTO is neutral: incoming order preserved for otherwise equal tv/event streams', () => {
      const ranked = rankEventStreamOptions([eventOption(), tvOption()], prefs({ streamType: 'auto' }))
      expect(ranked.map((o) => o.key)).toEqual(['event', 'tv'])
    })

    it('TV preference boosts tv groups over otherwise equal event groups', () => {
      const ranked = rankEventStreamOptions([eventOption(), tvOption()], prefs({ streamType: 'tv' }))
      expect(ranked.map((o) => o.key)).toEqual(['tv', 'event'])
    })

    it('EVENT preference boosts event groups over otherwise equal tv groups', () => {
      const ranked = rankEventStreamOptions([tvOption(), eventOption()], prefs({ streamType: 'event' }))
      expect(ranked.map((o) => o.key)).toEqual(['event', 'tv'])
    })

    it('is a boost, not an exclusion: a clearly better stream of the other type still wins', () => {
      const tv720 = makeOption({ key: 'tv', sourceType: 'tv', matchConfidence: 'likely', bestQualityTier: 2 })
      const event4k = makeOption({ key: 'event', sourceType: 'event', matchConfidence: 'likely', bestQualityTier: 4 })
      const ranked = rankEventStreamOptions([tv720, event4k], prefs({ streamType: 'tv' }))
      expect(ranked.map((o) => o.key)).toEqual(['event', 'tv'])
    })
  })

  it('exposes the score used, matching scoreEventStreamOption', () => {
    const option = makeOption({ matchConfidence: 'confirmed', countryName: 'Norway', bestQualityTier: 3, sourceType: 'event' })
    const p = prefs({ favoriteCountries: ['Norway'], streamType: 'event' })
    const [ranked] = rankEventStreamOptions([option], p)
    expect(ranked.rankingScore).toBe(scoreEventStreamOption(option, p))
    // primary(48) + quality(30) + confirmed(18) + type(12)
    expect(ranked.rankingScore).toBe(108)
  })
})

// Task section 14's exact worked example: primary=NO, secondary=[SE, GB],
// score defines ordering only WITHIN a country bucket — a non-preferred
// country's higher score (DE 170) never lets it jump ahead of a preferred
// country's lower one.
describe('country bucket ordering (task sections 1/9/14)', () => {
  it('country bucket dominates score entirely: NO (primary) < SE < GB < DE, regardless of score', () => {
    const options = [
      makeOption({ key: 'gb-150', matchConfidence: 'confirmed', countryName: 'United Kingdom', bestQualityTier: 5, isFavorite: true }),
      makeOption({ key: 'no-110', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 3 }),
      makeOption({ key: 'se-140', matchConfidence: 'confirmed', countryName: 'Sweden', bestQualityTier: 4, isFavorite: true }),
      makeOption({ key: 'no-95', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 2 }),
      makeOption({ key: 'de-170', matchConfidence: 'confirmed', countryName: 'Germany', bestQualityTier: 5, isFavorite: true }),
    ]
    const p = prefs({ favoriteCountries: ['Norway', 'Sweden', 'United Kingdom'] })
    const ranked = rankEventStreamOptions(options, p)
    // Within Norway, the higher-scoring option (110) still leads the lower
    // one (95) — score is the tie-break INSIDE the bucket.
    expect(ranked.map((o) => o.key)).toEqual(['no-110', 'no-95', 'se-140', 'gb-150', 'de-170'])
  })

  it('countryBucketRank: 0 for primary, 1..N-1 for secondary preferred countries in stored order, one shared bucket beyond that', () => {
    const favoriteCountries = ['Norway', 'Sweden', 'United Kingdom']
    expect(countryBucketRank(makeOption({ countryName: 'Norway' }), favoriteCountries)).toBe(0)
    expect(countryBucketRank(makeOption({ countryName: 'Sweden' }), favoriteCountries)).toBe(1)
    expect(countryBucketRank(makeOption({ countryName: 'United Kingdom' }), favoriteCountries)).toBe(2)
    expect(countryBucketRank(makeOption({ countryName: 'Germany' }), favoriteCountries)).toBe(4)
    expect(countryBucketRank(makeOption({ countryName: null }), favoriteCountries)).toBe(4)
  })

  it('with no country preferences at all, every option shares one bucket — ordering falls through to score', () => {
    const norway = makeOption({ key: 'no', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 2 })
    const germany = makeOption({ key: 'de', matchConfidence: 'likely', countryName: 'Germany', bestQualityTier: 4 })
    const ranked = rankEventStreamOptions([norway, germany], prefs())
    expect(ranked.map((o) => o.key)).toEqual(['de', 'no'])
  })
})

describe('groupOptionsByCountry', () => {
  function rankedFor(options: EventStreamOption[], favoriteCountries: string[]) {
    return rankEventStreamOptions(options, prefs({ favoriteCountries }))
  }

  it('splits into one section per preferred country plus one shared "other" section, in bucket order', () => {
    const options = [
      makeOption({ key: 'gb', matchConfidence: 'confirmed', countryName: 'United Kingdom' }),
      makeOption({ key: 'no1', matchConfidence: 'confirmed', countryName: 'Norway', bestQualityTier: 3 }),
      makeOption({ key: 'no2', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 1 }),
      makeOption({ key: 'de', matchConfidence: 'confirmed', countryName: 'Germany' }),
      makeOption({ key: 'us', matchConfidence: 'confirmed', countryName: 'United States' }),
    ]
    const favoriteCountries = ['Norway', 'United Kingdom']
    const sections = groupOptionsByCountry(rankedFor(options, favoriteCountries), favoriteCountries)

    expect(sections.map((s) => [s.kind, s.countryName, s.options.map((o) => o.key)])).toEqual([
      ['primary', 'Norway', ['no1', 'no2']],
      ['preferred', 'United Kingdom', ['gb']],
      ['other', null, ['de', 'us']],
    ])
  })

  it('collapses to a single section (no headers worth showing) when only one country is present', () => {
    const options = [
      makeOption({ key: 'a', matchConfidence: 'confirmed', countryName: 'Norway' }),
      makeOption({ key: 'b', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 1 }),
    ]
    const favoriteCountries = ['Norway']
    const sections = groupOptionsByCountry(rankedFor(options, favoriteCountries), favoriteCountries)
    expect(sections).toHaveLength(1)
    expect(sections[0].kind).toBe('primary')
  })

  it('collapses to a single "other" section when there are no country preferences at all', () => {
    const options = [
      makeOption({ key: 'a', matchConfidence: 'confirmed', countryName: 'Norway' }),
      makeOption({ key: 'b', matchConfidence: 'confirmed', countryName: 'Germany' }),
    ]
    const sections = groupOptionsByCountry(rankedFor(options, []), [])
    expect(sections).toHaveLength(1)
    expect(sections[0].kind).toBe('other')
  })
})

describe('recommended eligibility (no fixed Top 3)', () => {
  function rankedPartition(options: EventStreamOption[], p: StreamRankingPreferences) {
    return partitionStreamOptions(rankEventStreamOptions(options, p))
  }

  it('every confirmed group is recommended — five of them, not capped at 3', () => {
    const options = [1, 2, 3, 4, 5].map((n) => makeOption({ key: `c${n}`, matchConfidence: 'confirmed' }))
    const { recommended, trusted } = rankedPartition(options, prefs({ favoriteCountries: ['Norway'] }))
    expect(recommended).toHaveLength(5)
    expect(trusted).toHaveLength(5)
  })

  it('a likely group in a preferred country is recommended', () => {
    const option = makeOption({ key: 'l', matchConfidence: 'likely', countryName: 'Norway' })
    const { recommended } = rankedPartition([option], prefs({ favoriteCountries: ['Norway'] }))
    expect(recommended.map((o) => o.key)).toEqual(['l'])
  })

  it('a likely group in a non-preferred country at ordinary quality stays out of Recommended', () => {
    const option = makeOption({ key: 'l', matchConfidence: 'likely', countryName: 'Germany', bestQualityTier: 3 })
    const { recommended, trusted } = rankedPartition([option], prefs({ favoriteCountries: ['Norway'] }))
    expect(recommended).toHaveLength(0)
    expect(trusted.map((o) => o.key)).toEqual(['l'])
  })

  it('a likely group in a non-preferred country IS recommended at standout quality (UHD+)', () => {
    const option = makeOption({ key: 'l', matchConfidence: 'likely', countryName: 'Germany', bestQualityTier: 4 })
    const { recommended } = rankedPartition([option], prefs({ favoriteCountries: ['Norway'] }))
    expect(recommended.map((o) => o.key)).toEqual(['l'])
  })

  it('with no country preferences at all, every trusted group is recommended', () => {
    const options = [
      makeOption({ key: 'a', matchConfidence: 'likely', countryName: 'Germany' }),
      makeOption({ key: 'b', matchConfidence: 'confirmed', countryName: 'France' }),
    ]
    const { recommended } = rankedPartition(options, prefs())
    expect(recommended).toHaveLength(2)
  })

  it('candidates are never recommended, even with preferred country and top quality', () => {
    const fuzzy8k = makeOption({ key: 'fuzzy', matchConfidence: 'candidate', countryName: 'Norway', bestQualityTier: 5 })
    const trusted720p = makeOption({ key: 'trusted', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 2 })
    const { recommended, candidates } = rankedPartition([fuzzy8k, trusted720p], prefs({ favoriteCountries: ['Norway'] }))
    expect(recommended.map((o) => o.key)).toEqual(['trusted'])
    expect(candidates.map((o) => o.key)).toEqual(['fuzzy'])
  })

  it('an exact match still beats a weak preferred-country candidate: the candidate never outranks it into Recommended', () => {
    const exactForeign = makeOption({ key: 'exact', matchConfidence: 'confirmed', countryName: 'Germany', bestQualityTier: 2 })
    const preferredCandidate = makeOption({ key: 'cand', matchConfidence: 'candidate', countryName: 'Norway', bestQualityTier: 5 })
    const { recommended } = rankedPartition([exactForeign, preferredCandidate], prefs({ favoriteCountries: ['Norway'] }))
    expect(recommended.map((o) => o.key)).toEqual(['exact'])
  })

  it('trusted contains recommended as a rank-ordered superset (same objects, no separate models)', () => {
    const options = [
      makeOption({ key: 'a', matchConfidence: 'confirmed', countryName: 'Norway', bestQualityTier: 3 }),
      makeOption({ key: 'b', matchConfidence: 'likely', countryName: 'Germany', bestQualityTier: 1 }),
      makeOption({ key: 'c', matchConfidence: 'likely', countryName: 'Norway', bestQualityTier: 2 }),
    ]
    const { recommended, trusted } = rankedPartition(options, prefs({ favoriteCountries: ['Norway'] }))
    expect(trusted.map((o) => o.key)).toEqual(['a', 'c', 'b'])
    expect(recommended.map((o) => o.key)).toEqual(['a', 'c'])
    for (const r of recommended) expect(trusted).toContain(r)
  })
})

describe('match-view filters', () => {
  function ranked(overrides: Partial<EventStreamOption>, p: StreamRankingPreferences = prefs()): RankedEventStreamOption {
    const [option] = rankEventStreamOptions([makeOption(overrides)], p)
    return option
  }

  function partition(options: RankedEventStreamOption[]) {
    return partitionStreamOptions(options)
  }

  it('a single stream shows no filter pills at all', () => {
    const p = partition([ranked({ matchConfidence: 'confirmed' })])
    expect(availableStreamFilters(p)).toEqual([])
  })

  it('offers tv/event pills only when BOTH types exist among trusted groups', () => {
    const onlyTv = partition([
      ranked({ key: 'a', sourceType: 'tv', matchConfidence: 'confirmed' }),
      ranked({ key: 'b', sourceType: 'tv', matchConfidence: 'likely', countryName: 'Germany', bestQualityTier: 1 }),
    ])
    expect(availableStreamFilters(onlyTv)).not.toContain('tv')
    expect(availableStreamFilters(onlyTv)).not.toContain('event')

    const both = partition([
      ranked({ key: 'a', sourceType: 'tv', matchConfidence: 'confirmed' }),
      ranked({ key: 'b', sourceType: 'event', matchConfidence: 'confirmed' }),
    ])
    expect(availableStreamFilters(both)).toContain('tv')
    expect(availableStreamFilters(both)).toContain('event')
  })

  it('drops the recommended pill when Recommended and All would be identical', () => {
    const p = partition([
      ranked({ key: 'a', sourceType: 'tv', matchConfidence: 'confirmed' }),
      ranked({ key: 'b', sourceType: 'event', matchConfidence: 'confirmed' }),
    ])
    // Everything trusted is recommended and there are no candidates —
    // Recommended would repeat All exactly.
    expect(availableStreamFilters(p)).toEqual(['all', 'tv', 'event'])
  })

  it('keeps the recommended pill when candidates make All a bigger view', () => {
    const p = partition([
      ranked({ key: 'a', matchConfidence: 'confirmed' }),
      ranked({ key: 'b', matchConfidence: 'confirmed' }),
      ranked({ key: 'c', matchConfidence: 'candidate' }),
    ])
    expect(availableStreamFilters(p)).toContain('recommended')
  })

  it('optionsForFilter returns the right groups per filter', () => {
    // With Norway preferred: the confirmed TV group is recommended, the
    // ordinary-quality German event feed is trusted-but-not-recommended.
    const withCountry = prefs({ favoriteCountries: ['Norway'] })
    const tv = ranked({ key: 'tv1', sourceType: 'tv', matchConfidence: 'confirmed' }, withCountry)
    const event = ranked({ key: 'ev1', sourceType: 'event', matchConfidence: 'likely', countryName: 'Germany', bestQualityTier: 1 }, withCountry)
    const candidate = ranked({ key: 'cand', matchConfidence: 'candidate' }, withCountry)
    const p = partition([tv, event, candidate])

    expect(optionsForFilter(p, 'recommended').options.map((o) => o.key)).toEqual(['tv1'])
    expect(optionsForFilter(p, 'all').options.map((o) => o.key)).toEqual(['tv1', 'ev1'])
    expect(optionsForFilter(p, 'all').candidates.map((o) => o.key)).toEqual(['cand'])
    expect(optionsForFilter(p, 'tv').options.map((o) => o.key)).toEqual(['tv1'])
    expect(optionsForFilter(p, 'event').options.map((o) => o.key)).toEqual(['ev1'])
    // Candidates stay confined to the All view.
    expect(optionsForFilter(p, 'recommended').candidates).toEqual([])
    expect(optionsForFilter(p, 'tv').candidates).toEqual([])
  })
})
