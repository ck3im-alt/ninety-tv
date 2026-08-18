import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  namesOverlap,
  namesExactMatch,
  textMatchesTeam,
  STALE_STATUS_WORDS,
  extractCandidateDates,
  isPlausibleEventDate,
  normalizeCountryKey,
} from './channelMatchCore'
import { foldForMatching } from '../fancyUnicode'
import { matchChannelsForEvent } from './channelMatch'
import { ChannelIdentityIndex } from './channelIdentityIndex'
import type { SportEvent } from './types'
import type { Channel } from '../channel'
import type { XtreamCredentials } from '../xtream/types'
import type { NinetyLogicalChannel } from './ninetyApiClient'

const getShortEpgMock = vi.fn()
vi.mock('../xtream/xtreamClient', () => ({ getShortEpg: (...args: unknown[]) => getShortEpgMock(...args) }))

beforeEach(() => {
  getShortEpgMock.mockReset()
})

const CREDS: XtreamCredentials = { server: 'https://panel.example', username: 'u', password: 'p' }

function unmatchedEvent(): SportEvent {
  return {
    id: 'evt-1',
    sportKey: 'football',
    sportLabel: 'Football',
    league: 'Test League',
    leagueId: 'test-league',
    title: 'Home vs Away',
    homeTeam: 'Home',
    awayTeam: 'Away',
    dateTimeUtc: '2026-08-18T20:00:00Z',
    timeLabel: '20:00',
    isLive: true,
  }
}

function ppvChannel(): Channel {
  return {
    id: 'ch-1',
    name: 'PPV Sports Channel',
    groupTitle: 'PPV',
    sources: [{ label: 'Default', url: 'http://example.com/live/u/p/123.ts' }],
  }
}

describe('matchChannelsForEvent network fallback gating', () => {
  it('does not hit the EPG network fallback by default (home/live-row usage)', async () => {
    const result = await matchChannelsForEvent(unmatchedEvent(), [ppvChannel()], CREDS, null)
    expect(result.matches).toEqual([])
    expect(getShortEpgMock).not.toHaveBeenCalled()
  })

  it('only hits the EPG network fallback when explicitly allowed (Event Details usage)', async () => {
    getShortEpgMock.mockResolvedValue([])
    await matchChannelsForEvent(unmatchedEvent(), [ppvChannel()], CREDS, null, { allowNetworkFallback: true })
    expect(getShortEpgMock).toHaveBeenCalled()
  })

  it('runs the normal and widened PPV EPG stages sequentially, never simultaneously', async () => {
    // 40 unique non-PPV "sport" channels fill MAX_EPG_CANDIDATE_CHANNELS
    // for the normal stage; the PPV channel appended after them gets
    // sliced out of that stage's candidate list (it's isLikelySportChannel
    // too, via its PPV category, but ranks 41st) yet is still picked up by
    // the widened stage, which scans PPV channels independently. That gives
    // a call this test can attribute to the widened stage alone.
    const normalChannels: Channel[] = Array.from({ length: 40 }, (_, i) => ({
      id: `sport-${i}`,
      name: `Sport Channel ${i}`,
      groupTitle: 'Sport',
      sources: [{ label: 'Default', url: `http://example.com/live/u/p/${i + 1}.ts` }],
    }))
    const widenedOnlyChannel: Channel = {
      id: 'ppv-only',
      name: 'PPV Widened Channel',
      groupTitle: 'PPV',
      sources: [{ label: 'Default', url: 'http://example.com/live/u/p/999.ts' }],
    }

    const normalStageEnd = { t: 0 }
    let widenedStageStart = -1
    getShortEpgMock.mockImplementation(async (_creds: XtreamCredentials, streamId: number) => {
      if (streamId === 999) {
        widenedStageStart = Date.now()
        return []
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
      normalStageEnd.t = Math.max(normalStageEnd.t, Date.now())
      return []
    })

    await matchChannelsForEvent(unmatchedEvent(), [...normalChannels, widenedOnlyChannel], CREDS, null, {
      allowNetworkFallback: true,
    })

    expect(widenedStageStart).toBeGreaterThanOrEqual(normalStageEnd.t)
  })
})

describe('namesOverlap', () => {
  // "TV3", "TV3 Sport", and "TV3+" are three distinct real channels — see
  // BRAND_QUALIFIER_WORDS in channelMatchCore.ts.
  it('does not match TV3+ against TV3', () => {
    expect(namesOverlap('TV3+', 'TV3')).toBe(false)
    expect(namesOverlap('TV3', 'TV3+')).toBe(false)
  })

  it('does not match TV3 Sport against TV3+', () => {
    expect(namesOverlap('TV3 Sport', 'TV3+')).toBe(false)
  })

  it('matches TV3 Plus against TV3+ (spelled-out Plus == + marker)', () => {
    expect(namesOverlap('TV3 Plus', 'TV3+')).toBe(true)
  })

  // Real-world false positive: "Arena Sport Premium 1" matching "Arena
  // Fight" purely off the shared root word "Arena".
  it('does not match Arena Sport Premium 1 against Arena Fight', () => {
    expect(namesOverlap('Arena Sport Premium 1', 'Arena Fight')).toBe(false)
  })

  it('does not match Arena Sport Premium 1 against unrelated Arena siblings', () => {
    expect(namesOverlap('Arena Sport Premium 1', 'Arena eSport')).toBe(false)
    expect(namesOverlap('Arena Sport Premium 1', 'Arena 1X2')).toBe(false)
    expect(namesOverlap('Arena Sport Premium 1', 'NTV Arena')).toBe(false)
    expect(namesOverlap('Arena Sport Premium 1', 'Arena Cloud')).toBe(false)
  })

  it('does not match Arena Sport 1 against Arena Sport 2 (mandatory channel number)', () => {
    expect(namesOverlap('Arena Sport 1', 'Arena Sport 2')).toBe(false)
  })

  it('matches Arena Sport Premium 1 against the same numbered channel with an extra quality tag', () => {
    expect(namesOverlap('Arena Sport Premium 1', 'Arena Sport Premium 1 HD')).toBe(true)
  })

  // Real-world false positive: "V Sport Premium"/"V Film Premium"/"TV2
  // Sport Premium"/"Viaplay Sport Premium" all sharing only "PREMIUM".
  it('does not match unrelated brands sharing only a marketing suffix', () => {
    expect(namesOverlap('Arena Sport Premium 1', 'V Sport Premium')).toBe(false)
    expect(namesOverlap('Arena Sport Premium 1', 'TV2 Sport Premium')).toBe(false)
  })

  // Single-brand-word station ("beIN" reduces to just "BEIN") is trusted on
  // a shared word alone, unlike a multi-word station like "Arena Cloud".
  it('trusts a single-word broadcaster identity as a whole-name match', () => {
    expect(namesOverlap('beIN Sports', 'beIN Sports 1')).toBe(true)
  })

  // Real-world false positive: "TVP Sport"/"TVP 2" matching every unrelated
  // "TVP ..." sibling channel (Historia, ABC, ...).
  it('does not match an umbrella broadcaster against unrelated numbered siblings', () => {
    expect(namesOverlap('TVP 2', 'TVP Historia 2')).toBe(false)
    expect(namesOverlap('TVP 2', 'TVP ABC 2')).toBe(false)
  })

  it('tolerates naming drift via shared meaningful words', () => {
    expect(namesOverlap('TV3 Sport HD', 'SE: TV3 Sport 1')).toBe(false) // station has no number, channel adds one -> extra word
    expect(namesOverlap('TV 2 Sport 1', 'TV2 Sport 1')).toBe(true) // space-separated brand token merges the same as no space
  })
})

describe('namesExactMatch (exact vs fuzzy broadcaster match)', () => {
  it('is true only for the identical word sequence, quality tags aside', () => {
    expect(namesExactMatch('Arena Sport Premium 1', 'Arena Sport Premium 1')).toBe(true)
    expect(namesExactMatch('Arena Sport Premium 1', 'Arena Sport Premium 1 HD')).toBe(true)
  })

  it('is false for a fuzzy/overlap-only match that is not the same sequence', () => {
    expect(namesExactMatch('Arena Sport Premium 1', 'Arena Sport 1')).toBe(false)
    expect(namesExactMatch('Arena Sport Premium 1', 'Arena Sport 1 Premium')).toBe(false)
  })
})

describe('textMatchesTeam (Manchester City vs Coventry City)', () => {
  it('does not match Manchester City text against Coventry City merely via the generic word City', () => {
    const foldedCoventry = foldForMatching('Coventry City vs Sunderland')
    expect(textMatchesTeam(foldedCoventry, 'Manchester City')).toBe(false)
  })

  it('does match when the distinctive club word is actually present', () => {
    const foldedManchester = foldForMatching('Manchester City vs Arsenal')
    expect(textMatchesTeam(foldedManchester, 'Manchester City')).toBe(true)
  })

  it('still matches a genuine Coventry City mention (generic word not stripped from searched text)', () => {
    const foldedCoventry = foldForMatching('Coventry City vs Sunderland')
    expect(textMatchesTeam(foldedCoventry, 'Coventry City')).toBe(true)
  })
})

describe('PPV title containing both teams', () => {
  it('matches a PPV channel name that mentions both home and away teams', () => {
    const folded = foldForMatching('LIVE | Arsenal vs Manchester City | Mon 17 Aug 20:55 CEST')
    expect(textMatchesTeam(folded, 'Arsenal')).toBe(true)
    expect(textMatchesTeam(folded, 'Manchester City')).toBe(true)
  })

  it('does not match when only one of the two teams is present', () => {
    const folded = foldForMatching('LIVE | Arsenal vs Everton | Mon 17 Aug 20:55 CEST')
    expect(textMatchesTeam(folded, 'Arsenal')).toBe(true)
    expect(textMatchesTeam(folded, 'Manchester City')).toBe(false)
  })
})

describe('STALE_STATUS_WORDS (rejecting finished PPV listings)', () => {
  it('flags ENDED / FT / POSTPONED / CANCELLED / ABANDONED as stale', () => {
    for (const status of ['ENDE', 'ENDED', 'FT', 'POSTPONED', 'CANCELLED', 'CANCELED', 'ABANDONED']) {
      expect(STALE_STATUS_WORDS.test(`${status} | DEPORTIVO VS ELCHE`)).toBe(true)
    }
  })

  it('does not flag a live/unstarted listing', () => {
    expect(STALE_STATUS_WORDS.test('LIVE | DEPORTIVO VS ELCHE | MON 17 AUG 20:55')).toBe(false)
  })

  it('does not misfire on an unrelated word merely containing the same letters', () => {
    expect(STALE_STATUS_WORDS.test('ENDEAVOUR SPORTS NETWORK')).toBe(false)
  })
})

describe('extractCandidateDates / isPlausibleEventDate (PPV date rejection)', () => {
  const kickoff = new Date('2026-08-17T20:55:00Z')

  it('accepts a listing dated the same day as kickoff', () => {
    const dates = extractCandidateDates('LIVE | DEPORTIVO VS ELCHE | MON 17 AUG 20:55 CEST')
    expect(dates.length).toBeGreaterThan(0)
    expect(dates.some((d) => isPlausibleEventDate(d, kickoff))).toBe(true)
  })

  it('accepts an ISO-dated listing within tolerance', () => {
    const dates = extractCandidateDates('(STAN 14) | ... (2026-08-18 04:00:29)')
    expect(dates.some((d) => isPlausibleEventDate(d, kickoff))).toBe(true)
  })

  it('rejects a listing dated months away from the real fixture', () => {
    // extractCandidateDates matches month-name text uppercased, mirroring the
    // already-folded text it's actually called with in matchViaPpvChannelName.
    const namedDates = extractCandidateDates('ARSENAL VS MANCHESTER CITY | 17 NOV 20:37 (GMT)')
    expect(namedDates.length).toBeGreaterThan(0)
    expect(namedDates.some((d) => isPlausibleEventDate(d, kickoff))).toBe(false)
  })
})

describe('normalizeCountryKey (UK/GB country normalization)', () => {
  it('normalizes both UK and GB to the same United Kingdom key', () => {
    expect(normalizeCountryKey('GB')).toBe(normalizeCountryKey('UK'))
    expect(normalizeCountryKey('GB')).toBe('UNITED KINGDOM')
  })

  it('is case-insensitive on the input code', () => {
    expect(normalizeCountryKey('gb')).toBe('UNITED KINGDOM')
  })

  it('falls back to the raw (uppercased) value for an unrecognized code', () => {
    expect(normalizeCountryKey('zz')).toBe('ZZ')
  })
})

// ---------------------------------------------------------------------
// Channel Identity Resolver v2 integration (resolver-integration task,
// Part 12) — matchViaNinetyApi now looks up a precomputed
// ChannelIdentityIndex by event.broadcast.logicalChannelId instead of
// scanning every playlist channel with namesOverlap(broadcast.name,
// channel.name). Every index below is built directly via the real
// ChannelIdentityIndex/resolveChannelIdentities — no mocking of the
// resolver itself, so these tests exercise the actual scoring/
// classification logic, not a stand-in for it.
// ---------------------------------------------------------------------

function logicalChannel(overrides: Partial<NinetyLogicalChannel> & Pick<NinetyLogicalChannel, 'id' | 'name'>): NinetyLogicalChannel {
  return {
    country: null,
    broadcast_type: 'LINEAR',
    network_name: null,
    channel_number: null,
    channel_variant: null,
    aliases: [],
    external_ids: [],
    source_names: [],
    ...overrides,
  }
}

function testChannel(overrides: Partial<Channel> & Pick<Channel, 'id' | 'name'>): Channel {
  return {
    sources: [{ label: 'Default', url: 'http://example.invalid/stream' }],
    ...overrides,
  }
}

function buildIndex(catalog: NinetyLogicalChannel[], playlist: Channel[]): ChannelIdentityIndex {
  return new ChannelIdentityIndex('test-version', catalog, playlist)
}

function eventWithBroadcasts(broadcasts: SportEvent['broadcasts'], overrides: Partial<SportEvent> = {}): SportEvent {
  return { ...unmatchedEvent(), homeTeam: undefined, awayTeam: undefined, broadcasts, ...overrides }
}

describe('matchChannelsForEvent Ninety-stage identity resolution', () => {
  it('resolves a CONFIRMED logical channel to its playlist channel, labeled with the canonical broadcast name', async () => {
    const catalog = [logicalChannel({ id: 'gb_tnt_sports_1', name: 'TNT Sports 1', country: 'GB', network_name: 'TNT Sports' })]
    const playlist = [testChannel({ id: 'p1', name: 'TNT SPORTS 1', groupTitle: 'UK| SPORT' })]
    const index = buildIndex(catalog, playlist)
    const event = eventWithBroadcasts([{ logicalChannelId: 'gb_tnt_sports_1', name: 'TNT Sports 1', country: 'GB', confidence: 1, classification: 'CONFIRMED' }])

    const result = await matchChannelsForEvent(event, playlist, null, index)

    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toMatchObject({ channel: playlist[0], source: 'ninety', label: 'TNT Sports 1', isExactMatch: true, identityClassification: 'CONFIRMED' })
  })

  it('resolves a STRONG logical channel as watchable, but never marks it isExactMatch', async () => {
    const catalog = [logicalChannel({ id: 'gb_sky_sports_main_event', name: 'Sky Sports Main Event', country: 'GB', network_name: 'Sky' })]
    const playlist = [testChannel({ id: 'p1', name: 'NOW: SKY SPORTS MAIN EVENT', groupTitle: 'UK| NOW TV SPORT' })]
    const index = buildIndex(catalog, playlist)
    expect(index.getResolution('gb_sky_sports_main_event')?.classification).toBe('STRONG') // sanity-check the fixture itself
    const event = eventWithBroadcasts([{ logicalChannelId: 'gb_sky_sports_main_event', name: 'Sky Sports Main Event', country: 'GB', confidence: 1, classification: 'CONFIRMED' }])

    const result = await matchChannelsForEvent(event, playlist, null, index)

    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toMatchObject({ channel: playlist[0], source: 'ninety', identityClassification: 'STRONG', isExactMatch: false })
  })

  it('does not fall back to namesOverlap when the identity resolver says NONE, even though the old text match would have hit', async () => {
    // p1's external id deterministically identifies it as TNT Sports 2 (a
    // DIFFERENT logical channel) even though its visible NAME says "TNT
    // Sports 1" -- namesOverlap('TNT Sports 1', 'TNT SPORTS 1') is true, so
    // the old matcher would have matched it; the resolver correctly rejects
    // it for gb_tnt_sports_1 (an id-vs-name contradiction against a
    // DIFFERENT channel is a hard reject here, not just a low score).
    expect(namesOverlap('TNT Sports 1', 'TNT SPORTS 1')).toBe(true)
    const catalog = [
      logicalChannel({ id: 'gb_tnt_sports_1', name: 'TNT Sports 1', country: 'GB' }),
      logicalChannel({ id: 'gb_tnt_sports_2', name: 'TNT Sports 2', country: 'GB', external_ids: [{ source_id: 'epgshare01_uk', source_channel_id: 'tnt2.uk' }] }),
    ]
    const playlist = [testChannel({ id: 'p1', name: 'TNT SPORTS 1', groupTitle: 'UK| SPORT', epgChannelIds: ['tnt2.uk'], hasEpgChannelId: true })]
    const index = buildIndex(catalog, playlist)
    expect(index.getResolution('gb_tnt_sports_1')?.classification).toBe('NONE') // sanity-check the fixture
    const event = eventWithBroadcasts([{ logicalChannelId: 'gb_tnt_sports_1', name: 'TNT Sports 1', country: 'GB', confidence: 1, classification: 'CONFIRMED' }])

    const result = await matchChannelsForEvent(event, playlist, null, index)

    expect(result.matches).toEqual([])
    expect(result.apiHasData).toBe(true)
  })

  it('never surfaces an AMBIGUOUS resolution as a watchable match', async () => {
    const catalog = [
      logicalChannel({ id: 'gb_tnt_sports_1', name: 'TNT Sports 1', country: 'GB' }),
      logicalChannel({ id: 'gb_tnt_sports_2', name: 'TNT Sports 2', country: 'GB', external_ids: [{ source_id: 'epgshare01_uk', source_channel_id: 'tnt2.uk' }] }),
    ]
    const playlist = [testChannel({ id: 'p1', name: 'TNT SPORTS 1', groupTitle: 'UK| SPORT', epgChannelIds: ['tnt2.uk'], hasEpgChannelId: true })]
    const index = buildIndex(catalog, playlist)
    expect(index.getResolution('gb_tnt_sports_2')?.classification).toBe('AMBIGUOUS') // sanity-check the fixture
    const event = eventWithBroadcasts([{ logicalChannelId: 'gb_tnt_sports_2', name: 'TNT Sports 2', country: 'GB', confidence: 1, classification: 'CONFIRMED' }])

    const result = await matchChannelsForEvent(event, playlist, null, index)

    expect(result.matches).toEqual([])
    // Diagnostic info is retained (Part 10), not thrown away.
    expect(result.apiStations[0]).toMatchObject({ identityClassification: 'AMBIGUOUS', ambiguousPlaylistChannelNames: ['TNT SPORTS 1'] })
  })

  it('keeps every legitimate playlist duplicate for one logical channel (regional/quality variants)', async () => {
    const catalog = [logicalChannel({ id: 'gb_bbc_one', name: 'BBC One', country: 'GB', network_name: 'BBC' })]
    const playlist = [
      testChannel({ id: 'p1', name: 'BBC ONE HD', groupTitle: 'UK| GENERAL HD' }),
      testChannel({ id: 'p2', name: 'BBC ONE RAW', groupTitle: 'UK| GENERAL RAW' }),
    ]
    const index = buildIndex(catalog, playlist)
    const event = eventWithBroadcasts([{ logicalChannelId: 'gb_bbc_one', name: 'BBC One', country: 'GB', confidence: 1, classification: 'CONFIRMED' }])

    const result = await matchChannelsForEvent(event, playlist, null, index)

    expect(result.matches.map((m) => m.channel.id).sort()).toEqual(['p1', 'p2'])
    expect(result.matches.every((m) => m.source === 'ninety' && m.identityClassification === 'CONFIRMED')).toBe(true)
  })

  it('never lets the same playlist channel surface under two different logical broadcasts', async () => {
    // Both logical channels independently clear the auto-match bar for the
    // SAME playlist channel p1, with a decisive score gap -- the resolver's
    // Part 6 reverse-collision guard demotes the loser to AMBIGUOUS rather
    // than letting both claim it.
    const catalog = [
      logicalChannel({ id: 'gb_sky_sports_1', name: 'Sky Sports 1', country: 'GB', network_name: 'Sky' }),
      logicalChannel({ id: 'gb_sky_sports_1_dup', name: 'Sky Sports Extra Feed', country: null, aliases: ['Sky Sports 1'] }),
    ]
    const playlist = [testChannel({ id: 'p1', name: 'SKY SPORTS 1', groupTitle: 'UK| SPORT' })]
    const index = buildIndex(catalog, playlist)
    expect(index.getResolution('gb_sky_sports_1')?.classification).toBe('CONFIRMED') // sanity-check the fixture
    expect(index.getResolution('gb_sky_sports_1_dup')?.classification).toBe('AMBIGUOUS')
    const event = eventWithBroadcasts([
      { logicalChannelId: 'gb_sky_sports_1', name: 'Sky Sports 1', country: 'GB', confidence: 1, classification: 'CONFIRMED' },
      { logicalChannelId: 'gb_sky_sports_1_dup', name: 'Sky Sports Extra Feed', country: null, confidence: 1, classification: 'CONFIRMED' },
    ])

    const result = await matchChannelsForEvent(event, playlist, null, index)

    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toMatchObject({ channel: playlist[0], identityClassification: 'CONFIRMED' })
  })

  it('reports apiHasData=true and the full apiStations list even when the reported broadcaster is not found in the playlist', async () => {
    const catalog = [logicalChannel({ id: 'gb_tnt_sports_1', name: 'TNT Sports 1', country: 'GB' })]
    const playlist: Channel[] = [] // nothing in the playlist at all
    const index = buildIndex(catalog, playlist)
    const event = eventWithBroadcasts([{ logicalChannelId: 'gb_tnt_sports_1', name: 'TNT Sports 1', country: 'GB', confidence: 1, classification: 'CONFIRMED' }])

    const result = await matchChannelsForEvent(event, playlist, null, index)

    expect(result.matches).toEqual([])
    expect(result.apiHasData).toBe(true)
    expect(result.apiStations).toEqual([{ name: 'TNT Sports 1', country: 'GB', identityClassification: 'NONE', ambiguousPlaylistChannelNames: undefined }])
  })

  it('reports one apiStations entry per broadcast regardless of match outcome', async () => {
    const catalog = [logicalChannel({ id: 'gb_tnt_sports_1', name: 'TNT Sports 1', country: 'GB' })]
    const playlist = [testChannel({ id: 'p1', name: 'TNT SPORTS 1', groupTitle: 'UK| SPORT' })]
    const index = buildIndex(catalog, playlist)
    const event = eventWithBroadcasts([
      { logicalChannelId: 'gb_tnt_sports_1', name: 'TNT Sports 1', country: 'GB', confidence: 1, classification: 'CONFIRMED' },
      { logicalChannelId: 'unknown_logical_channel', name: 'Some Other Station', country: 'FR', confidence: 1, classification: 'CONFIRMED' },
    ])

    const result = await matchChannelsForEvent(event, playlist, null, index)

    expect(result.apiStations.map((s) => s.name)).toEqual(['TNT Sports 1', 'Some Other Station'])
    expect(result.apiStations.map((s) => s.country)).toEqual(['GB', 'FR'])
  })

  it('combines a Ninety identity match with a PPV-name match for a different channel', async () => {
    const catalog = [logicalChannel({ id: 'gb_tnt_sports_1', name: 'TNT Sports 1', country: 'GB' })]
    const linear = testChannel({ id: 'p1', name: 'TNT SPORTS 1', groupTitle: 'UK| SPORT' })
    const ppv = testChannel({ id: 'p2', name: 'LIVE | Home vs Away | Mon 18 Aug', groupTitle: 'PPV' })
    const playlist = [linear, ppv]
    const index = buildIndex(catalog, playlist)
    const event = eventWithBroadcasts(
      [{ logicalChannelId: 'gb_tnt_sports_1', name: 'TNT Sports 1', country: 'GB', confidence: 1, classification: 'CONFIRMED' }],
      { homeTeam: 'Home', awayTeam: 'Away' },
    )

    const result = await matchChannelsForEvent(event, playlist, null, index)

    expect(result.matches.map((m) => ({ id: m.channel.id, source: m.source })).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'p1', source: 'ninety' },
      { id: 'p2', source: 'ppvName' },
    ])
  })

  it('combines a Ninety identity match with a broadcasterMap match for a different channel', async () => {
    const catalog = [logicalChannel({ id: 'gb_tnt_sports_1', name: 'TNT Sports 1', country: 'GB' })]
    const linear = testChannel({ id: 'p1', name: 'TNT SPORTS 1', groupTitle: 'UK| SPORT' })
    const f1 = testChannel({ id: 'p3', name: 'SKY SPORTS F1 HD', groupTitle: 'UK| SPORT' })
    const playlist = [linear, f1]
    const index = buildIndex(catalog, playlist)
    const event = eventWithBroadcasts([{ logicalChannelId: 'gb_tnt_sports_1', name: 'TNT Sports 1', country: 'GB', confidence: 1, classification: 'CONFIRMED' }], {
      sportKey: 'f1',
      leagueId: 'f1-generic',
    })

    const result = await matchChannelsForEvent(event, playlist, null, index)

    expect(result.matches.map((m) => ({ id: m.channel.id, source: m.source })).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'p1', source: 'ninety' },
      { id: 'p3', source: 'broadcasterMap' },
    ])
  })

  it('never calls the EPG fallback when the Ninety identity stage already found a free match', async () => {
    const catalog = [logicalChannel({ id: 'gb_tnt_sports_1', name: 'TNT Sports 1', country: 'GB' })]
    const playlist = [testChannel({ id: 'p1', name: 'TNT SPORTS 1', groupTitle: 'UK| SPORT' })]
    const index = buildIndex(catalog, playlist)
    const event = eventWithBroadcasts([{ logicalChannelId: 'gb_tnt_sports_1', name: 'TNT Sports 1', country: 'GB', confidence: 1, classification: 'CONFIRMED' }], {
      homeTeam: 'Home',
      awayTeam: 'Away',
    })

    const result = await matchChannelsForEvent(event, playlist, CREDS, index, { allowNetworkFallback: true })

    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].source).toBe('ninety')
    expect(getShortEpgMock).not.toHaveBeenCalled()
  })

  it('degrades gracefully with a null identityIndex — no crash, no Ninety matches, apiHasData still reflects the event', async () => {
    const playlist = [testChannel({ id: 'p1', name: 'TNT SPORTS 1', groupTitle: 'UK| SPORT' })]
    const event = eventWithBroadcasts([{ logicalChannelId: 'gb_tnt_sports_1', name: 'TNT Sports 1', country: 'GB', confidence: 1, classification: 'CONFIRMED' }])

    const result = await matchChannelsForEvent(event, playlist, null, null)

    expect(result.matches).toEqual([])
    expect(result.apiHasData).toBe(true)
    expect(result.apiStations).toEqual([{ name: 'TNT Sports 1', country: 'GB' }])
  })
})
