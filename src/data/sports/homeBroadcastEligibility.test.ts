// The Home broadcast-eligibility matrix, stated as a table.
//
// Five backend verdicts x three questions (feed / hero / channel matching),
// plus the favorite-club exception that makes one cell of that table depend
// on the viewer. Pure functions, so every case is written as data.
//
// The single rule these tests exist to defend: the DEFAULT IS INCLUSION.
// Only a verdict the backend actually stated can remove anything — absent,
// null and unrecognized all behave exactly as Home behaved before this
// layer existed.
import { describe, expect, it } from 'vitest'
import {
  homeBroadcastEligibility,
  isChannelMatchBroadcastEligible,
  isHeroBroadcastEligible,
  isHomeFeedBroadcastEligible,
} from './homeBroadcastEligibility'
import { buildPersonalizationContext } from './homePersonalization'
import type { BroadcastAvailability } from './broadcastAvailability'
import type { SportEvent } from './types'

function event(overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    id: 'evt',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    league: 'FA Cup',
    leagueId: 'england_fa_cup',
    leagueTier: 2,
    title: 'Bootle vs Northwich Victoria',
    homeTeam: 'Bootle',
    awayTeam: 'Northwich Victoria',
    homeTeamId: 'team_bootle',
    awayTeamId: 'team_northwich',
    dateTimeUtc: '2026-08-26T19:45:00Z',
    timeLabel: '',
    isLive: false,
    ...overrides,
  }
}

const NO_PREFERENCES = buildPersonalizationContext({})
const BOOTLE_FAN = buildPersonalizationContext({ favoriteTeamIds: ['team_bootle'] })
// The competition, NOT the club — the exception must not fire for this.
const FA_CUP_FAN = buildPersonalizationContext({ favoriteCompetitionIds: ['england_fa_cup'] })

const POSITIVE_AND_UNKNOWN: BroadcastAvailability[] = ['CONFIRMED_BROADCAST', 'LIKELY_BROADCAST', 'UNKNOWN']

// ===========================================================================
// TESTS 3, 4, 5 — everything that is not a stated negative behaves as before
// ===========================================================================

describe('positive and unknown verdicts are fully eligible', () => {
  // TEST 3 (CONFIRMED_BROADCAST), TEST 4 (LIKELY_BROADCAST), TEST 5 (UNKNOWN)
  it.each(POSITIVE_AND_UNKNOWN)('%s is eligible for the feed, the hero, and channel matching', (availability) => {
    const ev = event({ broadcastAvailability: availability })
    expect(isHomeFeedBroadcastEligible(ev, NO_PREFERENCES)).toBe(true)
    expect(isHeroBroadcastEligible(ev)).toBe(true)
    expect(isChannelMatchBroadcastEligible(ev)).toBe(true)
  })

  // TEST 1 / TEST 8 backwards-compatibility, at the eligibility layer: an
  // event mapped from a backend that never sent the field is a plain
  // SportEvent with the property absent.
  it('an event with no availability field at all is treated exactly like UNKNOWN', () => {
    const ev = event()
    expect(ev.broadcastAvailability).toBeUndefined()
    expect(isHomeFeedBroadcastEligible(ev, NO_PREFERENCES)).toBe(true)
    expect(isHeroBroadcastEligible(ev)).toBe(true)
    expect(isChannelMatchBroadcastEligible(ev)).toBe(true)
  })

  // TEST 2, at the eligibility layer rather than the mapping one.
  it('an unrecognized status is treated as UNKNOWN, so nothing disappears', () => {
    const ev = event({ broadcastAvailability: 'SOMETHING_NEW' as BroadcastAvailability })
    expect(isHomeFeedBroadcastEligible(ev, NO_PREFERENCES)).toBe(true)
    expect(isHeroBroadcastEligible(ev)).toBe(true)
    expect(isChannelMatchBroadcastEligible(ev)).toBe(true)
  })

  // TEST 14 — an empty broadcasts array is not a negative signal. The TV
  // never infers "not broadcast" for itself.
  it('does not downgrade an event just because its broadcasts array is empty', () => {
    const ev = event({ broadcastAvailability: 'CONFIRMED_BROADCAST', broadcasts: [] })
    expect(isHomeFeedBroadcastEligible(ev, NO_PREFERENCES)).toBe(true)
    expect(isHeroBroadcastEligible(ev)).toBe(true)
    expect(isChannelMatchBroadcastEligible(ev)).toBe(true)
  })

  it('does not upgrade an event just because its broadcasts array is full', () => {
    const ev = event({
      broadcastAvailability: 'CONFIRMED_NOT_BROADCAST',
      broadcasts: [{ logicalChannelId: 'lc1', name: 'Sky Sports', country: 'GB', confidence: 1, classification: 'CONFIRMED' }],
    })
    expect(isHomeFeedBroadcastEligible(ev, NO_PREFERENCES)).toBe(false)
  })
})

// ===========================================================================
// TESTS 6, 7, 8 — LIKELY_NOT_BROADCAST and the favorite-club exception
// ===========================================================================

describe('LIKELY_NOT_BROADCAST', () => {
  const likelyNot = (overrides: Partial<SportEvent> = {}) =>
    event({ broadcastAvailability: 'LIKELY_NOT_BROADCAST', ...overrides })

  // TEST 6
  it('is absent from the Home feed for a viewer with no favorite club in it', () => {
    expect(isHomeFeedBroadcastEligible(likelyNot(), NO_PREFERENCES)).toBe(false)
  })

  // TEST 7
  it('is included in the feed when an explicit favorite club is playing', () => {
    expect(isHomeFeedBroadcastEligible(likelyNot(), BOOTLE_FAN)).toBe(true)
  })

  // The exception is the CLUB, never the competition — "I follow the FA Cup"
  // must not be read as "show me every untelevised preliminary tie in it".
  it('is not rescued by a favorite competition alone', () => {
    expect(isHomeFeedBroadcastEligible(likelyNot(), FA_CUP_FAN)).toBe(false)
  })

  // Canonical ids only. A name match must never stand in for one.
  it('is not rescued by a team NAME matching a favorite', () => {
    const nameOnly = buildPersonalizationContext({ favoriteTeamIds: ['Bootle'] })
    expect(isHomeFeedBroadcastEligible(likelyNot(), nameOnly)).toBe(false)
  })

  it('is rescued by the away side just as much as the home side', () => {
    const northwichFan = buildPersonalizationContext({ favoriteTeamIds: ['team_northwich'] })
    expect(isHomeFeedBroadcastEligible(likelyNot(), northwichFan)).toBe(true)
  })

  // TEST 8 — the exception buys a feed card and nothing more.
  it('can never become the hero, favorite club or not', () => {
    expect(isHeroBroadcastEligible(likelyNot())).toBe(false)
    expect(homeBroadcastEligibility(likelyNot(), BOOTLE_FAN).heroEligible).toBe(false)
  })

  // TEST 9's rule, at the pure layer: the informational card has nothing for
  // a channel match to unlock, so the lookup must not run.
  it('never runs channel matching, favorite club or not', () => {
    expect(isChannelMatchBroadcastEligible(likelyNot())).toBe(false)
    expect(homeBroadcastEligibility(likelyNot(), BOOTLE_FAN).channelMatchingSkipped).toBe(true)
  })
})

// ===========================================================================
// TESTS 10, 11, 12 — CONFIRMED_NOT_BROADCAST is absolute
// ===========================================================================

describe('CONFIRMED_NOT_BROADCAST', () => {
  const confirmedNot = () => event({ broadcastAvailability: 'CONFIRMED_NOT_BROADCAST' })

  // TEST 10
  it('is excluded from Home for a viewer with no favorites', () => {
    expect(isHomeFeedBroadcastEligible(confirmedNot(), NO_PREFERENCES)).toBe(false)
  })

  // TEST 11 — the favorite-club exception deliberately does NOT extend here.
  it('is still excluded from Home when a favorite club is playing', () => {
    expect(isHomeFeedBroadcastEligible(confirmedNot(), BOOTLE_FAN)).toBe(false)
  })

  it('can never become the hero', () => {
    expect(isHeroBroadcastEligible(confirmedNot())).toBe(false)
  })

  // TEST 12
  it('never runs channel matching', () => {
    expect(isChannelMatchBroadcastEligible(confirmedNot())).toBe(false)
  })
})

// ===========================================================================
// The diagnostic descriptor must report what the code path actually did
// ===========================================================================

describe('homeBroadcastEligibility (dev diagnostic)', () => {
  it('agrees with the individual predicates for every verdict', () => {
    const verdicts: BroadcastAvailability[] = [...POSITIVE_AND_UNKNOWN, 'LIKELY_NOT_BROADCAST', 'CONFIRMED_NOT_BROADCAST']
    for (const availability of verdicts) {
      for (const context of [NO_PREFERENCES, BOOTLE_FAN, FA_CUP_FAN]) {
        const ev = event({ broadcastAvailability: availability })
        const described = homeBroadcastEligibility(ev, context)
        expect(described.availability).toBe(availability)
        expect(described.feedEligible).toBe(isHomeFeedBroadcastEligible(ev, context))
        expect(described.heroEligible).toBe(isHeroBroadcastEligible(ev))
        expect(described.channelMatchingSkipped).toBe(!isChannelMatchBroadcastEligible(ev))
      }
    }
  })

  it("carries the backend's own stated reason so an exclusion is explainable", () => {
    const ev = event({
      broadcastAvailability: 'LIKELY_NOT_BROADCAST',
      broadcastAvailabilityReason: 'no listings found in any tracked market',
    })
    const described = homeBroadcastEligibility(ev, NO_PREFERENCES)
    expect(described.reason).toBe('no listings found in any tracked market')
    expect(described.isFavoriteTeam).toBe(false)
  })

  it('normalizes an absent verdict in its report rather than reporting undefined', () => {
    expect(homeBroadcastEligibility(event(), NO_PREFERENCES).availability).toBe('UNKNOWN')
  })
})

// ===========================================================================
// TEST 20 — sports with no broadcast-availability evidence at all
// ===========================================================================
//
// F1 comes from TheSportsDB, which has no such concept, so its events never
// carry the field. That must read as "we don't know", which is what every
// event read as before this layer existed — not as a reason to hide a race.
describe('F1 is untouched by this layer', () => {
  const race = (overrides: Partial<SportEvent> = {}): SportEvent => ({
    id: 'f1-race',
    sportKey: 'f1',
    sportLabel: 'FORMULA 1',
    league: 'Formula 1',
    leagueId: 'f1',
    title: 'Italian Grand Prix',
    dateTimeUtc: '2026-08-26T13:00:00Z',
    timeLabel: '',
    isLive: false,
    ...overrides,
  })

  it('is fully eligible for the feed, the hero and matching, with or without favorites', () => {
    for (const context of [NO_PREFERENCES, BOOTLE_FAN]) {
      expect(isHomeFeedBroadcastEligible(race(), context)).toBe(true)
    }
    expect(isHeroBroadcastEligible(race())).toBe(true)
    expect(isChannelMatchBroadcastEligible(race())).toBe(true)
  })

  it('reports UNKNOWN in the diagnostic rather than an absent verdict', () => {
    const described = homeBroadcastEligibility(race(), NO_PREFERENCES)
    expect(described.availability).toBe('UNKNOWN')
    expect(described.feedEligible).toBe(true)
    expect(described.channelMatchingSkipped).toBe(false)
  })
})
