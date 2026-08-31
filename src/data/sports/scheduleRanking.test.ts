import { describe, expect, it } from 'vitest'
import { buildScheduleGroups, orderFixturesWithinGroup } from './scheduleRanking'
import type { LeagueDef } from './leagues'
import type { SportEvent } from './types'

// Minimal fixtures — only the fields ranking actually reads. `dateTimeUtc`
// is a real instant so the chronological assertions mean something.
function fixture(overrides: Partial<SportEvent> & Pick<SportEvent, 'id' | 'leagueId'>): SportEvent {
  return {
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    league: overrides.leagueId,
    leagueTier: 1,
    title: `${overrides.id} fixture`,
    homeTeam: 'Home',
    awayTeam: 'Away',
    dateTimeUtc: '2026-08-26T18:00:00Z',
    timeLabel: '',
    isLive: false,
    ...overrides,
  }
}

const ids = (groups: { competitionId: string }[]) => groups.map((g) => g.competitionId)

describe('buildScheduleGroups — the critical rule: ranking changes ORDER ONLY', () => {
  it('keeps every fixture, in exactly one group, no matter how it ranks', () => {
    const fixtures = [
      fixture({ id: 'a', leagueId: 'football_premier_league', leagueTier: 1 }),
      fixture({ id: 'b', leagueId: 'tiny_cup', leagueTier: 3 }),
      fixture({ id: 'c', leagueId: 'tiny_cup', leagueTier: 3 }),
      fixture({ id: 'd', leagueId: 'football_champions_league', leagueTier: 1 }),
      fixture({ id: 'e', leagueId: 'another_small_league', leagueTier: 3 }),
    ]
    const groups = buildScheduleGroups(fixtures, ['football_premier_league'])
    const seen = groups.flatMap((g) => g.fixtures.map((f) => f.id)).sort()
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(groups).toHaveLength(4)
  })

  it("does not drop a competition just because it isn't a favorite", () => {
    const fixtures = [
      fixture({ id: 'a', leagueId: 'favorited', leagueTier: 1 }),
      fixture({ id: 'b', leagueId: 'not_favorited', leagueTier: 3 }),
    ]
    expect(ids(buildScheduleGroups(fixtures, ['favorited']))).toContain('not_favorited')
  })

  it('keeps a fixture whose competition has no tier at all (an unknown/new competition)', () => {
    const fixtures = [fixture({ id: 'a', leagueId: 'brand_new', leagueTier: undefined })]
    const groups = buildScheduleGroups(fixtures, [])
    expect(groups).toHaveLength(1)
    expect(groups[0].fixtures.map((f) => f.id)).toEqual(['a'])
  })
})

describe('buildScheduleGroups — competition ordering', () => {
  it('puts a favorite competition ahead of an unfollowed one of the same size', () => {
    const fixtures = [
      fixture({ id: 'a', leagueId: 'football_premier_league', leagueTier: 1 }),
      fixture({ id: 'b', leagueId: 'football_ligue_1', leagueTier: 1 }),
    ]
    expect(ids(buildScheduleGroups(fixtures, ['football_ligue_1']))[0]).toBe('football_ligue_1')
  })

  it('lifts a favorited mid-size competition above an unfollowed top-tier one', () => {
    const fixtures = [
      fixture({ id: 'a', leagueId: 'football_premier_league', leagueTier: 1 }),
      fixture({ id: 'b', leagueId: 'football_eliteserien', leagueTier: 2 }),
    ]
    expect(ids(buildScheduleGroups(fixtures, ['football_eliteserien']))[0]).toBe('football_eliteserien')
  })

  // REPLACES the old calibration target, which said the opposite: until
  // 2026-08-31 a favorite was a +0.30 WEIGHT and a Champions League
  // semifinal deliberately outranked a favorited tier-3 competition. That
  // was Home's question, not Schedule's — see scheduleRanking.ts's header.
  it('puts a favorited tier-3 competition above a non-favorite Champions League semifinal', () => {
    const fixtures = [
      fixture({ id: 'a', leagueId: 'tiny_cup', leagueTier: 3, round: 'Regular Season' }),
      fixture({ id: 'b', leagueId: 'football_champions_league', leagueTier: 1, round: 'Semi-finals' }),
    ]
    expect(ids(buildScheduleGroups(fixtures, ['tiny_cup']))).toEqual(['tiny_cup', 'football_champions_league'])
  })

  it('still ranks a favorited tier-1 league at the very top of that same day', () => {
    const fixtures = [
      fixture({ id: 'a', leagueId: 'football_ligue_1', leagueTier: 1, round: 'Regular Season' }),
      fixture({ id: 'b', leagueId: 'football_champions_league', leagueTier: 1, round: 'Semi-finals' }),
      fixture({ id: 'c', leagueId: 'tiny_cup', leagueTier: 3 }),
    ]
    expect(ids(buildScheduleGroups(fixtures, ['football_ligue_1']))).toEqual(['football_ligue_1', 'football_champions_league', 'tiny_cup'])
  })

  it('ranks a later knockout stage above an earlier one within the same tier', () => {
    const fixtures = [
      fixture({ id: 'a', leagueId: 'cup_a', leagueTier: 2, round: 'Qualifying Round' }),
      fixture({ id: 'b', leagueId: 'cup_b', leagueTier: 2, round: 'Final' }),
    ]
    expect(ids(buildScheduleGroups(fixtures, []))[0]).toBe('cup_b')
  })

  it("takes a group's MOST significant stage, not an average of its fixtures", () => {
    const fixtures = [
      fixture({ id: 'a1', leagueId: 'cup_a', leagueTier: 2, round: 'Qualifying Round' }),
      fixture({ id: 'a2', leagueId: 'cup_a', leagueTier: 2, round: 'Qualifying Round' }),
      fixture({ id: 'a3', leagueId: 'cup_a', leagueTier: 2, round: 'Final' }),
      fixture({ id: 'b1', leagueId: 'cup_b', leagueTier: 2, round: 'Round of 16' }),
    ]
    expect(ids(buildScheduleGroups(fixtures, []))[0]).toBe('cup_a')
  })

  it('nudges a competition with something live above an otherwise identical one', () => {
    const fixtures = [
      fixture({ id: 'a', leagueId: 'league_a', leagueTier: 2, dateTimeUtc: '2026-08-26T12:00:00Z' }),
      fixture({ id: 'b', leagueId: 'league_b', leagueTier: 2, isLive: true, dateTimeUtc: '2026-08-26T18:00:00Z' }),
    ]
    expect(ids(buildScheduleGroups(fixtures, []))[0]).toBe('league_b')
  })

  it('is deterministic for genuinely tied competitions (earliest kickoff, then name)', () => {
    const fixtures = [
      fixture({ id: 'z', leagueId: 'zeta', league: 'Zeta League', leagueTier: 2, dateTimeUtc: '2026-08-26T18:00:00Z' }),
      fixture({ id: 'a', leagueId: 'alpha', league: 'Alpha League', leagueTier: 2, dateTimeUtc: '2026-08-26T18:00:00Z' }),
      fixture({ id: 'e', leagueId: 'early', league: 'Early League', leagueTier: 2, dateTimeUtc: '2026-08-26T12:00:00Z' }),
    ]
    const once = ids(buildScheduleGroups(fixtures, []))
    const again = ids(buildScheduleGroups([...fixtures].reverse(), []))
    expect(once).toEqual(['early', 'alpha', 'zeta'])
    expect(again).toEqual(once)
  })
})

describe('orderFixturesWithinGroup', () => {
  // Inside one competition, time is the organizing principle — a ranking
  // score must never push a lunchtime kickoff below an evening one.
  it('orders non-live fixtures purely chronologically, ignoring stage importance', () => {
    const fixtures = [
      fixture({ id: 'late', leagueId: 'cup', round: 'Final', dateTimeUtc: '2026-08-26T21:00:00Z' }),
      fixture({ id: 'early', leagueId: 'cup', round: 'Qualifying Round', dateTimeUtc: '2026-08-26T12:30:00Z' }),
    ]
    expect(orderFixturesWithinGroup(fixtures).map((f) => f.id)).toEqual(['early', 'late'])
  })

  it('lifts live fixtures to the top of their group', () => {
    const fixtures = [
      fixture({ id: 'early', leagueId: 'cup', dateTimeUtc: '2026-08-26T12:30:00Z' }),
      fixture({ id: 'live', leagueId: 'cup', isLive: true, dateTimeUtc: '2026-08-26T19:00:00Z' }),
      fixture({ id: 'late', leagueId: 'cup', dateTimeUtc: '2026-08-26T21:00:00Z' }),
    ]
    expect(orderFixturesWithinGroup(fixtures).map((f) => f.id)).toEqual(['live', 'early', 'late'])
  })

  // Deliberate, documented choice: a match already finished earlier today
  // keeps its chronological slot (carrying its final score) rather than being
  // exiled to the bottom.
  it('leaves a completed earlier fixture in chronological position, below live but above later kickoffs', () => {
    const fixtures = [
      fixture({ id: 'later', leagueId: 'cup', dateTimeUtc: '2026-08-26T21:00:00Z' }),
      fixture({ id: 'live', leagueId: 'cup', isLive: true, dateTimeUtc: '2026-08-26T19:00:00Z' }),
      fixture({ id: 'done', leagueId: 'cup', status: 'complete', homeScore: '2', awayScore: '1', dateTimeUtc: '2026-08-26T12:30:00Z' }),
    ]
    expect(orderFixturesWithinGroup(fixtures).map((f) => f.id)).toEqual(['live', 'done', 'later'])
  })

  it('breaks exact-time ties on event id, so the order never depends on API paging', () => {
    const fixtures = [
      fixture({ id: 'b', leagueId: 'cup', dateTimeUtc: '2026-08-26T18:00:00Z' }),
      fixture({ id: 'a', leagueId: 'cup', dateTimeUtc: '2026-08-26T18:00:00Z' }),
    ]
    expect(orderFixturesWithinGroup(fixtures).map((f) => f.id)).toEqual(['a', 'b'])
    expect(orderFixturesWithinGroup([...fixtures].reverse()).map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('sorts a fixture with no kickoff time last rather than dropping it', () => {
    const fixtures = [
      fixture({ id: 'unknown', leagueId: 'cup', dateTimeUtc: null }),
      fixture({ id: 'known', leagueId: 'cup', dateTimeUtc: '2026-08-26T18:00:00Z' }),
    ]
    expect(orderFixturesWithinGroup(fixtures).map((f) => f.id)).toEqual(['known', 'unknown'])
  })
})

// ===========================================================================
// FAVORITES ARE AN ABSOLUTE PARTITION
// ===========================================================================
//
// The behavioural change of the 2026-08-31 redesign, and the reason the
// Champions-League-semifinal test above now asserts the opposite of what it
// used to: EVERY competition the viewer follows and that has a fixture on
// the day comes before EVERY competition they don't. Ordering within each
// partition is unchanged.
describe('buildScheduleGroups — the favorite partition', () => {
  const DAY = [
    fixture({ id: 'cl', leagueId: 'football_champions_league', leagueTier: 1, round: 'Semi-finals' }),
    fixture({ id: 'pl', leagueId: 'football_premier_league', leagueTier: 1 }),
    fixture({ id: 'elite', leagueId: 'norway_eliteserien', leagueTier: 2 }),
    fixture({ id: 'champ', leagueId: 'england_championship', leagueTier: 3 }),
  ]

  it('places every favorite before every non-favorite, whatever their prestige', () => {
    const groups = buildScheduleGroups(DAY, ['norway_eliteserien', 'england_championship'])
    const favorites = groups.filter((g) => g.isFavorite).map((g) => g.competitionId)
    const rest = groups.filter((g) => !g.isFavorite).map((g) => g.competitionId)
    expect(ids(groups).slice(0, favorites.length)).toEqual(favorites)
    expect(favorites.sort()).toEqual(['england_championship', 'norway_eliteserien'])
    expect(rest.sort()).toEqual(['football_champions_league', 'football_premier_league'])
  })

  // The worked example from the redesign brief, stated exactly.
  it('starts the day with Eliteserien and the Championship when those are the favorites', () => {
    expect(ids(buildScheduleGroups(DAY, ['norway_eliteserien', 'england_championship']))).toEqual([
      'norway_eliteserien',
      'england_championship',
      'football_champions_league',
      'football_premier_league',
    ])
  })

  it('orders WITHIN the favorite partition by the same prestige/stage ranking', () => {
    // Both favorited: the tier-1 league still leads the tier-3 one, and a
    // knockout stage still lifts its competition.
    const groups = buildScheduleGroups(DAY, ['football_premier_league', 'england_championship', 'football_champions_league'])
    expect(ids(groups)).toEqual([
      'football_champions_league',
      'football_premier_league',
      'england_championship',
      'norway_eliteserien',
    ])
  })

  it('orders WITHIN the non-favorite partition exactly as it did before', () => {
    expect(ids(buildScheduleGroups(DAY, []))).toEqual([
      'football_champions_league',
      'football_premier_league',
      'norway_eliteserien',
      'england_championship',
    ])
  })

  it('is deterministic for two tied favorites (earliest kickoff, then name)', () => {
    const fixtures = [
      fixture({ id: 'z', leagueId: 'zeta', league: 'Zeta League', leagueTier: 2, dateTimeUtc: '2026-08-26T18:00:00Z' }),
      fixture({ id: 'a', leagueId: 'alpha', league: 'Alpha League', leagueTier: 2, dateTimeUtc: '2026-08-26T18:00:00Z' }),
      fixture({ id: 'e', leagueId: 'early', league: 'Early League', leagueTier: 2, dateTimeUtc: '2026-08-26T12:00:00Z' }),
    ]
    const favorites = ['zeta', 'alpha', 'early']
    const once = ids(buildScheduleGroups(fixtures, favorites))
    const again = ids(buildScheduleGroups([...fixtures].reverse(), favorites))
    expect(once).toEqual(['early', 'alpha', 'zeta'])
    expect(again).toEqual(once)
  })

  // The partition reorders; it must never remove.
  it('keeps every fixture on the page when nothing at all is favorited', () => {
    const groups = buildScheduleGroups(DAY, [])
    expect(groups.flatMap((g) => g.fixtures.map((f) => f.id)).sort()).toEqual(['champ', 'cl', 'elite', 'pl'])
  })

  it('keeps every fixture on the page when EVERYTHING is favorited', () => {
    const all = ['football_champions_league', 'football_premier_league', 'norway_eliteserien', 'england_championship']
    const groups = buildScheduleGroups(DAY, all)
    expect(groups.flatMap((g) => g.fixtures.map((f) => f.id)).sort()).toEqual(['champ', 'cl', 'elite', 'pl'])
    expect(groups.every((g) => g.isFavorite)).toBe(true)
  })

  it('ignores a favorited competition that has no fixture on the day', () => {
    const groups = buildScheduleGroups(DAY, ['a_competition_not_playing_today'])
    expect(groups).toHaveLength(4)
    expect(groups.some((g) => g.isFavorite)).toBe(false)
  })
})

// ===========================================================================
// COMPETITION METADATA TRAVELS WITH THE GROUP, NOT ON THE EVENT
// ===========================================================================
//
// The section header reads "England – Premier League" with a real flag. That
// country is a COMPETITION fact from ninety-api's registry (GET
// /v1/competitions), resolved once by useScheduleDay and handed in here —
// deliberately not copied onto every SportEvent, which would grow the shared
// event model for one screen's header.
describe('buildScheduleGroups — competition metadata', () => {
  function league(id: string, name: string, countryCode: string | null, region: string): LeagueDef {
    return {
      id,
      sportKey: 'football',
      sportLabel: 'FOOTBALL',
      tsdbSport: 'Soccer',
      name,
      region,
      countryCode,
      badge: `https://example.test/${id}.png`,
    }
  }

  const CATALOG = new Map<string, LeagueDef>([
    ['football_premier_league', league('football_premier_league', 'Premier League', 'GB', 'England')],
    ['football_champions_league', league('football_champions_league', 'UEFA Champions League', null, 'Europe')],
  ])

  it('carries the registry region and country code onto the group', () => {
    const groups = buildScheduleGroups([fixture({ id: 'a', leagueId: 'football_premier_league' })], [], CATALOG)
    expect(groups[0].region).toBe('England')
    expect(groups[0].countryCode).toBe('GB')
    expect(groups[0].competitionName).toBe('Premier League')
  })

  it('leaves a supranational competition with no country code, so no flag can be invented for it', () => {
    const groups = buildScheduleGroups([fixture({ id: 'a', leagueId: 'football_champions_league' })], [], CATALOG)
    expect(groups[0].countryCode).toBeNull()
    expect(groups[0].region).toBe('Europe')
  })

  it('prefers the registry name over whatever the event carried', () => {
    const groups = buildScheduleGroups(
      [fixture({ id: 'a', leagueId: 'football_premier_league', league: 'English Premier League 2026/27' })],
      [],
      CATALOG,
    )
    expect(groups[0].competitionName).toBe('Premier League')
  })

  it('still groups a competition the catalog has never heard of, with no metadata', () => {
    const groups = buildScheduleGroups([fixture({ id: 'a', leagueId: 'brand_new', league: 'Brand New Cup' })], [], CATALOG)
    expect(groups).toHaveLength(1)
    expect(groups[0].competitionName).toBe('Brand New Cup')
    expect(groups[0].region).toBeUndefined()
    expect(groups[0].countryCode).toBeUndefined()
  })

  it('works with no catalog at all', () => {
    const groups = buildScheduleGroups([fixture({ id: 'a', leagueId: 'x', league: 'X League' })], [])
    expect(groups[0].competitionName).toBe('X League')
  })
})

// ===========================================================================
// SCHEDULE IS NOT HOME
// ===========================================================================
//
// Home gained an objective broadcast-availability filter (see
// homeBroadcastEligibility.ts). Schedule must never inherit it. Schedule
// answers "what football is on today" — a fixture being untelevised does not
// mean it isn't being played, and a viewer looking up whether their club
// kicks off at 19:45 is asking a sporting question, not a TV one.
//
// Both files consume the same mapNinetyEvent output, which is exactly why
// this is worth a regression test: the event objects Schedule receives now
// carry a broadcastAvailability, and nothing here may start reading it.
describe('buildScheduleGroups — untelevised fixtures stay in the schedule', () => {
  // TEST 13
  it('keeps a LIKELY_NOT_BROADCAST fixture visible', () => {
    const fixtures = [
      fixture({ id: 'longlevens-winslow', leagueId: 'england_fa_cup', broadcastAvailability: 'LIKELY_NOT_BROADCAST' }),
      fixture({ id: 'bootle-northwich', leagueId: 'england_fa_cup', broadcastAvailability: 'LIKELY_NOT_BROADCAST' }),
    ]
    const groups = buildScheduleGroups(fixtures, [])
    expect(groups.flatMap((g) => g.fixtures.map((f) => f.id))).toEqual(['bootle-northwich', 'longlevens-winslow'])
  })

  it('keeps a CONFIRMED_NOT_BROADCAST fixture visible too — Home excludes it, Schedule does not', () => {
    const fixtures = [fixture({ id: 'definitely-not-on-tv', leagueId: 'england_fa_cup', broadcastAvailability: 'CONFIRMED_NOT_BROADCAST' })]
    const groups = buildScheduleGroups(fixtures, [])
    expect(groups).toHaveLength(1)
    expect(groups[0].fixtures.map((f) => f.id)).toEqual(['definitely-not-on-tv'])
  })

  // The exact screenshot scenario: five fixtures in the same 20:45 slot, two
  // of which Home drops. Schedule shows all five.
  it('shows all five fixtures of the observed 20:45 slot regardless of availability', () => {
    const fixtures = [
      fixture({ id: 'tottenham-charlton', leagueId: 'england_efl_cup', broadcastAvailability: 'CONFIRMED_BROADCAST' }),
      fixture({ id: 'newcastle-wba', leagueId: 'england_efl_cup', broadcastAvailability: 'LIKELY_BROADCAST' }),
      fixture({ id: 'longlevens-winslow', leagueId: 'england_fa_cup', broadcastAvailability: 'LIKELY_NOT_BROADCAST' }),
      fixture({ id: 'bootle-northwich', leagueId: 'england_fa_cup', broadcastAvailability: 'LIKELY_NOT_BROADCAST' }),
      fixture({ id: 'bradford-burnley', leagueId: 'england_efl_cup' }),
    ]
    const groups = buildScheduleGroups(fixtures, [])
    expect(groups.flatMap((g) => g.fixtures.map((f) => f.id)).sort()).toEqual([
      'bootle-northwich',
      'bradford-burnley',
      'longlevens-winslow',
      'newcastle-wba',
      'tottenham-charlton',
    ])
  })

  it('does not let availability change the order of a competition group', () => {
    const withVerdicts = buildScheduleGroups(
      [
        fixture({ id: 'a', leagueId: 'cup', dateTimeUtc: '2026-08-26T19:45:00Z', broadcastAvailability: 'CONFIRMED_NOT_BROADCAST' }),
        fixture({ id: 'b', leagueId: 'cup', dateTimeUtc: '2026-08-26T20:45:00Z', broadcastAvailability: 'CONFIRMED_BROADCAST' }),
      ],
      [],
    )
    const withoutVerdicts = buildScheduleGroups(
      [
        fixture({ id: 'a', leagueId: 'cup', dateTimeUtc: '2026-08-26T19:45:00Z' }),
        fixture({ id: 'b', leagueId: 'cup', dateTimeUtc: '2026-08-26T20:45:00Z' }),
      ],
      [],
    )
    // Chronological either way — the untelevised 19:45 fixture stays first.
    expect(withVerdicts[0].fixtures.map((f) => f.id)).toEqual(['a', 'b'])
    expect(withVerdicts[0].fixtures.map((f) => f.id)).toEqual(withoutVerdicts[0].fixtures.map((f) => f.id))
  })
})

// Nothing narrows the day any more — the league-pill filter is gone (see
// this file's header), so "everything is visible" is now a property of
// buildScheduleGroups alone, with no second call to get wrong.
describe('buildScheduleGroups — nothing narrows the day', () => {
  it('returns televised and untelevised fixtures alike, whatever the favorites are', () => {
    const groups = buildScheduleGroups(
      [
        fixture({ id: 'televised', leagueId: 'a_cup', broadcastAvailability: 'CONFIRMED_BROADCAST' }),
        fixture({ id: 'untelevised', leagueId: 'b_cup', broadcastAvailability: 'CONFIRMED_NOT_BROADCAST' }),
      ],
      ['a_cup'],
    )
    expect(groups.flatMap((g) => g.fixtures.map((f) => f.id)).sort()).toEqual(['televised', 'untelevised'])
  })
})
