import { describe, expect, it } from 'vitest'
import { applyScheduleFilter, buildScheduleGroups, orderFixturesWithinGroup, scheduleFilterOptions } from './scheduleRanking'
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
  it('gives a favorite competition a meaningful boost over an unfollowed one of the same size', () => {
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

  // The explicit calibration target: a favorite checkbox must not become an
  // absolute monopoly. A Champions League knockout tie has to stay above a
  // tiny competition the user happens to follow.
  it('keeps a Champions League semifinal above a favorited tier-3 competition', () => {
    const fixtures = [
      fixture({ id: 'a', leagueId: 'tiny_cup', leagueTier: 3, round: 'Regular Season' }),
      fixture({ id: 'b', leagueId: 'football_champions_league', leagueTier: 1, round: 'Semi-finals' }),
    ]
    expect(ids(buildScheduleGroups(fixtures, ['tiny_cup']))[0]).toBe('football_champions_league')
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

describe('league filter', () => {
  const fixtures = [
    fixture({ id: 'a', leagueId: 'football_premier_league', league: 'Premier League', leagueTier: 1 }),
    fixture({ id: 'b', leagueId: 'tiny_cup', league: 'Tiny Cup', leagueTier: 3 }),
  ]
  const groups = buildScheduleGroups(fixtures, [])

  it('offers a pill for every competition with a fixture today, in the same order as the sections', () => {
    expect(scheduleFilterOptions(groups).map((o) => o.competitionId)).toEqual(ids(groups))
  })

  it('shows everything until a league is explicitly selected (the "All" default)', () => {
    expect(applyScheduleFilter(groups, null)).toHaveLength(2)
  })

  it('narrows to exactly one competition once one is selected', () => {
    const filtered = applyScheduleFilter(groups, 'tiny_cup')
    expect(ids(filtered)).toEqual(['tiny_cup'])
    expect(filtered[0].fixtures.map((f) => f.id)).toEqual(['b'])
  })

  it('never mutates the groups it filters', () => {
    applyScheduleFilter(groups, 'tiny_cup')
    expect(groups).toHaveLength(2)
  })
})
