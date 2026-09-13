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
  dedupeSourcesByTier,
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
    expect(option.qualityVariants.map((s) => s.qualityLabel)).toEqual(['UHD', '720p'])
  })

  it('does not fabricate a quality label for a group with no recognizable quality hints', () => {
    const channel = makeChannel('TV 2 Sport', 'NO| Sports', [{ label: 'Default', url: 'http://x/1' }])
    const [option] = buildEventStreamOptions([ninetyMatch({ channel, isExactMatch: true })], NO_FAVORITES)
    expect(option.qualityVariants).toHaveLength(1)
    expect(option.qualityVariants[0].qualityLabel).toBeNull()
  })

  it('sorts source options best-quality first, so index 0 is the correct default selection', () => {
    const sources: ChannelSource[] = [
      { label: 'SD', url: 'http://x/1' },
      { label: 'UHD', url: 'http://x/2' },
      { label: 'HD', url: 'http://x/3' },
    ]
    const channel = makeChannel('TV 2 Sport', 'NO| Sports', sources)
    const [option] = buildEventStreamOptions([ninetyMatch({ channel, isExactMatch: true })], NO_FAVORITES)
    expect(option.qualityVariants[0].qualityLabel).toBe('UHD')
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
    expect(options[0].qualityVariants.map((s) => s.qualityLabel)).toEqual(['1080p', '720p', 'SD'])
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
    expect(options[0].qualityVariants).toHaveLength(2)
    expect(options[0].qualityVariants[0].qualityLabel).toBe('8K') // the default variant
    expect(options[0].qualityVariants[1].qualityLabel).toBeNull() // retained as an alternate/fallback source, not discarded
  })

  it('merges verified Norwegian Viaplay event aliases outside a PPV-named category', () => {
    const context = { homeTeam: 'Coventry City', awayTeam: 'Brighton & Hove Albion', dateTimeUtc: '2026-09-13T13:00:00.000Z' }
    const direct = ppvNameMatch('VIAPLAY | Coventry City - Brighton & Hove Albion | 14:50', 'NO| Sports')
    const numberedSlot = ppvNameMatch('Viaplay 22 | Coventry City - Brighton & Hove Albion | 14:50', 'NO| Events')

    const options = buildEventStreamOptions([direct, numberedSlot], NO_FAVORITES, context)

    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({
      displayName: 'VIAPLAY | Coventry City - Brighton & Hove Albion | 14:50',
      countryName: 'Norway',
      sourceType: 'event',
    })
    expect(options[0].qualityVariants).toHaveLength(1)
    expect(options[0].qualityVariants[0].candidates).toHaveLength(2)
  })

  it('same provider/event confirmed via three raw entries at three different qualities — still one group', () => {
    const matches = [
      ppvNameMatch('LIVE | Málaga CF - Deportivo La Coruña | Sun 24 Aug 21:25 CEST (NO) | 8K EXCLUSIVE | NO: Viaplay PPV 03', 'NO| PPV'),
      ppvNameMatch('LIVE | Málaga CF - Deportivo La Coruña | Sun 24 Aug 21:25 CEST (NO) | FHD | NO: Viaplay PPV 04', 'NO| PPV'),
      ppvNameMatch('LIVE | Málaga CF - Deportivo La Coruña | Sun 24 Aug 21:25 CEST (NO) | NO: Viaplay PPV 05', 'NO| PPV'),
    ]
    const options = buildEventStreamOptions(matches, NO_FAVORITES, MALAGA_CONTEXT)
    expect(options).toHaveLength(1)
    expect(options[0].qualityVariants.map((s) => s.qualityLabel)).toEqual(['8K', '1080p', null])
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

// ---------------------------------------------------------------------
// Logical-broadcaster rows (stream-dedupe task, Parts 1/3/4): one resolved
// broadcaster = one row = one automatically-chosen best quality, with every
// other variant kept behind it for the player.
// ---------------------------------------------------------------------
describe('buildEventStreamOptions logical-broadcaster rows', () => {
  function resolvedMatch(name: string, groupTitle: string, logicalChannelId: string, sources: ChannelSource[] = [{ label: 'Default', url: 'http://x/1' }]): ChannelMatch {
    return {
      channel: makeChannel(name, groupTitle, sources),
      source: 'ninety',
      label: 'TV 2 Sport 1',
      isExactMatch: true,
      identityClassification: 'CONFIRMED',
      logicalChannelId,
    }
  }

  it('shows ONE row for two differently-spelled playlist channels resolved to the same logical channel', () => {
    const options = buildEventStreamOptions(
      [
        resolvedMatch('TV2 SPORT 1', 'NO| Sports', 'no_tv2_sport_1', [{ label: 'HD', url: 'http://x/a' }]),
        resolvedMatch('TV 2 SPORT 1', 'NOR | Sports', 'no_tv2_sport_1', [{ label: 'HD', url: 'http://x/b' }]),
      ],
      NO_FAVORITES,
    )

    expect(options).toHaveLength(1)
    expect(options[0].displayName).toBe('TV 2 Sport 1')
    expect(options[0].countryName).toBe('Norway')
    // The 2-letter spelling is preferred so the country header keeps a flag.
    expect(options[0].countryCode).toBe('NO')
    expect(options[0].channelIds).toHaveLength(2)
  })

  it('defaults the merged row to the best quality across BOTH playlist channels', () => {
    const options = buildEventStreamOptions(
      [
        resolvedMatch('TNT SPORTS 1 UHD', 'UK| Sports', 'gb_tnt_sports_1', [{ label: 'UHD', url: 'http://x/uhd' }]),
        resolvedMatch('TNT Sport 1 HD', 'UK| Sports', 'gb_tnt_sports_1', [{ label: 'HD', url: 'http://x/hd' }]),
      ],
      NO_FAVORITES,
    )

    expect(options).toHaveLength(1)
    expect(options[0].qualityVariants[0].qualityLabel).toBe('UHD')
    expect(options[0].qualityVariants[0].candidates[0].source.url).toBe('http://x/uhd')
    expect(options[0].bestQualityTier).toBe(4)
  })

  it('keeps every quality variant of one logical channel, best-first, with 8K as the default', () => {
    const options = buildEventStreamOptions(
      [
        resolvedMatch('TV 2 SPORT 1', 'NO| Sports', 'no_tv2_sport_1', [
          { label: 'HD', url: 'http://x/hd' },
          { label: '8K', url: 'http://x/8k' },
          { label: 'SD', url: 'http://x/sd' },
        ]),
        resolvedMatch('TV2 SPORT 1', 'NO| Sports', 'no_tv2_sport_1', [
          { label: 'UHD', url: 'http://x/uhd' },
          { label: 'FHD', url: 'http://x/fhd' },
        ]),
      ],
      NO_FAVORITES,
    )

    expect(options).toHaveLength(1)
    expect(options[0].qualityVariants.map((s) => s.qualityLabel)).toEqual(['8K', 'UHD', '1080p', '720p', 'SD'])
    expect(options[0].qualityVariants[0].candidates[0].source.url).toBe('http://x/8k')
  })

  it('keeps one entry per tier, so identical tiers never produce a duplicate quality choice', () => {
    const options = buildEventStreamOptions(
      [
        resolvedMatch('TV2 SPORT 1', 'NO| Sports', 'no_tv2_sport_1', [{ label: 'UHD', url: 'http://x/uhd-a' }]),
        resolvedMatch('TV 2 SPORT 1', 'NO| Sports', 'no_tv2_sport_1', [{ label: 'UHD', url: 'http://x/uhd-b' }]),
      ],
      NO_FAVORITES,
    )

    expect(options[0].qualityVariants).toHaveLength(1)
    expect(options[0].qualityVariants[0].candidates[0].source.url).toBe('http://x/uhd-a')
  })

  it('splits a merged channel\'s own SD/UHD sources into two real variants (no shared-rawNames upgrade)', () => {
    const channel = makeChannel('TNT Sports 1', 'UK| Sports', [
      { label: 'SD', url: 'http://x/sd', originalName: 'UK: TNT SPORTS 1 SD' },
      { label: 'UHD', url: 'http://x/uhd', originalName: 'UK: TNT SPORTS 1 UHD' },
    ])
    channel.rawNames = ['UK: TNT SPORTS 1 SD', 'UK: TNT SPORTS 1 UHD']
    const [option] = buildEventStreamOptions([ninetyMatch({ channel, isExactMatch: true })], NO_FAVORITES)

    expect(option.qualityVariants.map((s) => s.qualityLabel)).toEqual(['UHD', 'SD'])
    expect(option.qualityVariants[0].candidates[0].source.url).toBe('http://x/uhd')
  })

  it('keeps two rows for different logical channels (TNT Sports 1 vs TNT Sports 2)', () => {
    const options = buildEventStreamOptions(
      [
        resolvedMatch('TNT SPORTS 1', 'UK| Sports', 'gb_tnt_sports_1'),
        resolvedMatch('TNT SPORTS 2', 'UK| Sports', 'gb_tnt_sports_2'),
      ],
      NO_FAVORITES,
    )

    expect(options).toHaveLength(2)
  })

  it('keeps two rows for the same broadcaster text in two genuinely different countries', () => {
    const options = buildEventStreamOptions(
      [
        resolvedMatch('EUROSPORT 1', 'NO| Sports', 'eurosport_1'),
        resolvedMatch('EUROSPORT 1', 'SE| Sports', 'eurosport_1'),
      ],
      NO_FAVORITES,
    )

    expect(options).toHaveLength(2)
    expect(options.map((o) => o.countryName)).toEqual(['Norway', 'Sweden'])
  })

  it('reports the merged row as favorited when ANY of its playlist channels is', () => {
    const a = resolvedMatch('TV2 SPORT 1', 'NO| Sports', 'no_tv2_sport_1')
    const b = resolvedMatch('TV 2 SPORT 1', 'NO| Sports', 'no_tv2_sport_1')
    const [option] = buildEventStreamOptions([a, b], new Set([b.channel.id]))

    expect(option.isFavorite).toBe(true)
    expect(option.channelIds).toContain(b.channel.id)
  })

  // Same-quality mirrors are a PLAYBACK asset, not a viewing choice: the
  // user-facing list stays one entry per tier, while every playable source
  // at that tier survives behind it for failover.
  it('keeps two same-tier sources as ONE user-facing quality with TWO playback candidates', () => {
    const options = buildEventStreamOptions(
      [
        resolvedMatch('TV2 SPORT 1', 'NO| Sports', 'no_tv2_sport_1', [
          { label: 'UHD', url: 'http://x/uhd-a' },
          { label: 'FHD', url: 'http://x/fhd-a' },
        ]),
        resolvedMatch('TV 2 SPORT 1', 'NO| Sports', 'no_tv2_sport_1', [{ label: 'UHD', url: 'http://x/uhd-b' }]),
      ],
      NO_FAVORITES,
    )

    expect(options).toHaveLength(1)
    // What the viewer is offered: two qualities, no duplicate rows.
    expect(options[0].qualityVariants.map((v) => v.qualityLabel)).toEqual(['UHD', '1080p'])
    // What playback can actually use: both UHD feeds, primary first.
    expect(options[0].qualityVariants[0].candidates.map((c) => c.source.url)).toEqual(['http://x/uhd-a', 'http://x/uhd-b'])
    expect(options[0].qualityVariants[1].candidates.map((c) => c.source.url)).toEqual(['http://x/fhd-a'])
  })

  it('keeps same-tier mirrors that came from different playlist channels', () => {
    const options = buildEventStreamOptions(
      [
        resolvedMatch('TNT SPORTS 1', 'UK| Sports', 'gb_tnt_sports_1', [{ label: 'FHD', url: 'http://x/fhd-a' }]),
        resolvedMatch('TNT SPORTS 1 HD ◉', 'UK| Sports', 'gb_tnt_sports_1', [{ label: 'FHD', url: 'http://x/fhd-b' }]),
      ],
      NO_FAVORITES,
    )

    expect(options[0].qualityVariants).toHaveLength(1)
    expect(options[0].qualityVariants[0].candidates.map((c) => c.channel.id)).toHaveLength(2)
  })

  // Multiview deliberately wants the flat one-per-tier view (it picks by a
  // quality ceiling across broadcasters) — that projection must not start
  // emitting mirror duplicates now that the candidates are retained.
  it('still exposes exactly one flat source per tier for the tier-ceiling consumers', () => {
    const flat = dedupeSourcesByTier([
      { channel: makeChannel('A', 'NO| Sports'), source: { label: 'UHD', url: 'http://x/uhd-a' } },
      { channel: makeChannel('B', 'NO| Sports'), source: { label: 'UHD', url: 'http://x/uhd-b' } },
      { channel: makeChannel('C', 'NO| Sports'), source: { label: 'HD', url: 'http://x/hd' } },
    ])

    expect(flat.map((s) => s.qualityLabel)).toEqual(['UHD', '720p'])
    expect(flat[0].source.url).toBe('http://x/uhd-a')
  })

  // Part 2 protection, end to end through the option builder: same provider
  // + same fixture collapses; same provider + different fixture, and
  // different provider + same fixture, both stay separate.
  it('collapses same-provider quality mirrors of one fixture but keeps different providers and different fixtures apart', () => {
    const context = { homeTeam: 'Valencia CF', awayTeam: 'Real Betis' }
    const ppv = (raw: string): ChannelMatch => ({ channel: makeChannel(raw, 'NO| PPV'), source: 'ppvName', label: raw, isExactMatch: false })
    const matches = [
      ppv('NEXT | VALENCIA - REAL BETIS | Tue 25 Aug 20:55 CEST (NO) | 8K EXCLUSIVE | NO: VIAPLAY PPV 13'),
      ppv('NEXT | VALENCIA - REAL BETIS | Tue 25 Aug 20:55 CEST (NO) | FHD | NO: VIAPLAY PPV 14'),
      ppv('NEXT | VALENCIA - REAL BETIS | Tue 25 Aug 20:55 CEST (NO) | 8K EXCLUSIVE | NO: TV2 PLAY PPV 13'),
      ppv('NEXT | ARSENAL - COVENTRY | Tue 25 Aug 20:55 CEST (NO) | 8K EXCLUSIVE | NO: VIAPLAY PPV 15'),
    ]

    const options = buildEventStreamOptions(matches, NO_FAVORITES, context)

    expect(options).toHaveLength(3)
    expect(options[0].qualityVariants.map((s) => s.qualityLabel)).toEqual(['8K', '1080p'])
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
    qualityVariants: [],
    bestQualityTier: 0,
    channelIds: [],
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
