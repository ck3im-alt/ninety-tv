// How much football Home has, and what it is allowed to go and get.
//
// Every scenario here is data — a candidate list, a clock, a viewer, a mode
// — with no React and no network, because the density question is a pure
// one: the fetch layer's only job is to act on the number this file
// produces (see useHomeFeed.ts, whose own tests pin the wiring).
//
// The rules the count DELEGATES to (which competitions a mode admits, what
// a broadcast verdict means, when a fixture counts as live) are tested in
// homeContentPolicy.test.ts, homeBroadcastEligibility.test.ts and
// homePersonalization.test.ts. What is tested here is that the count asks
// them at all, and the arithmetic built on top.
import { describe, expect, it } from 'vitest'
import {
  FORWARD_EXPANSION_DAYS,
  MIN_VISIBLE_UPCOMING_FOOTBALL,
  countVisibleUpcomingFootball,
  forwardExpansionShortfall,
  isVisibleUpcomingFootball,
  selectForwardExpansion,
  type HomeDensityInput,
} from './homeFeedDensity'
import { buildPersonalizationContext } from './homePersonalization'
import type { SportEvent } from './types'

const NOW = Date.parse('2026-08-28T19:00:00Z')
const inMinutes = (n: number) => new Date(NOW + n * 60_000).toISOString()
const inDays = (n: number) => new Date(NOW + n * 24 * 60 * 60 * 1000).toISOString()

function event(overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    id: 'evt',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    league: 'Premier League',
    leagueId: 'football_premier_league',
    title: 'Home FC vs Away FC',
    dateTimeUtc: inMinutes(120),
    timeLabel: '21:00',
    isLive: false,
    ...overrides,
  }
}

const followsPremierLeague = buildPersonalizationContext({ favoriteCompetitionIds: ['football_premier_league'] })

const input = (overrides: Partial<HomeDensityInput> = {}): HomeDensityInput => ({
  now: NOW,
  mode: 'favorites_only',
  context: followsPremierLeague,
  ...overrides,
})

describe('isVisibleUpcomingFootball', () => {
  it('counts a followed, televised fixture still to come', () => {
    expect(isVisibleUpcomingFootball(event(), input())).toBe(true)
  })

  it('counts one kicking off within the hour — "starting soon" is still to come', () => {
    expect(isVisibleUpcomingFootball(event({ dateTimeUtc: inMinutes(30) }), input())).toBe(true)
  })

  // The reported case: an F1 card is real content, but it cannot answer a
  // question about a football row.
  it('does not count a non-football event', () => {
    const race = event({ id: 'race', sportKey: 'f1', sportLabel: 'FORMULA 1', leagueId: 'f1', league: 'Formula 1' })
    expect(isVisibleUpcomingFootball(race, input({ mode: 'all' }))).toBe(false)
  })

  it('does not count a live match — it is on now, not still to come', () => {
    expect(isVisibleUpcomingFootball(event({ isLive: true, dateTimeUtc: inMinutes(-30) }), input())).toBe(false)
  })

  // Provider status lags reality on a majority of in-play fixtures (see
  // liveHeuristic.ts), so "kickoff is in the past" is asked through the
  // ranking's own eventTiming rather than re-derived here — a match that
  // started 20 minutes ago is live even while its status still says
  // 'scheduled', and must not pad the count as if it were upcoming.
  it('does not count a fixture whose kickoff has passed but whose status has not caught up', () => {
    const started = event({ dateTimeUtc: inMinutes(-20), status: 'scheduled' })
    expect(isVisibleUpcomingFootball(started, input())).toBe(false)
  })

  it('does not count a finished match', () => {
    expect(isVisibleUpcomingFootball(event({ dateTimeUtc: inMinutes(-200), status: 'complete' }), input())).toBe(false)
  })

  it('does not count one with no kickoff time at all', () => {
    expect(isVisibleUpcomingFootball(event({ dateTimeUtc: null }), input())).toBe(false)
  })

  // THE BUG THIS FILE EXISTS FOR, in its smallest form: a candidate the
  // viewer's own mode removes is not something they can see.
  it("does not count a fixture the viewer's content mode excludes", () => {
    const unrelated = event({ id: 'unrelated', leagueId: 'football_belgian_pro', leagueTier: 2 })
    expect(isVisibleUpcomingFootball(unrelated, input())).toBe(false)
    expect(isVisibleUpcomingFootball(unrelated, input({ mode: 'all' }))).toBe(true)
  })

  // ...and its mirror one layer down: an allowed fixture the feed drops on
  // the broadcast verdict is not a card either.
  it('does not count a fixture nobody is expected to broadcast', () => {
    const untelevised = event({ broadcastAvailability: 'CONFIRMED_NOT_BROADCAST' })
    expect(isVisibleUpcomingFootball(untelevised, input())).toBe(false)
  })

  it('counts one with no broadcast verdict at all — absence of evidence removes nothing', () => {
    expect(isVisibleUpcomingFootball(event({ broadcastAvailability: undefined }), input())).toBe(true)
  })
})

describe('forwardExpansionShortfall', () => {
  const upcoming = (n: number) =>
    Array.from({ length: n }, (_, i) => event({ id: `up${i}`, dateTimeUtc: inMinutes(60 + i * 30) }))

  it('is the full screenful when Home has no football at all', () => {
    expect(forwardExpansionShortfall([], input())).toBe(MIN_VISIBLE_UPCOMING_FOOTBALL)
  })

  // The reported screen: one qualifying match and an F1 card. Not empty,
  // and still four events short of a Home screen.
  it('is four when Home holds one qualifying match plus an unrelated F1 card', () => {
    const race = event({ id: 'race', sportKey: 'f1', sportLabel: 'FORMULA 1', leagueId: 'f1' })
    expect(forwardExpansionShortfall([...upcoming(1), race], input())).toBe(MIN_VISIBLE_UPCOMING_FOOTBALL - 1)
  })

  it('is zero once a full screenful is visible', () => {
    expect(countVisibleUpcomingFootball(upcoming(MIN_VISIBLE_UPCOMING_FOOTBALL), input())).toBe(MIN_VISIBLE_UPCOMING_FOOTBALL)
    expect(forwardExpansionShortfall(upcoming(MIN_VISIBLE_UPCOMING_FOOTBALL), input())).toBe(0)
  })

  it('never goes negative on a busy day', () => {
    expect(forwardExpansionShortfall(upcoming(30), input())).toBe(0)
  })

  // Same fetched candidates, three different answers — which is exactly why
  // the trigger cannot live upstream of the content policy.
  it('depends on the mode, not on the raw candidate count', () => {
    const candidates = [
      ...upcoming(1),
      ...Array.from({ length: 6 }, (_, i) =>
        event({ id: `other${i}`, leagueId: 'football_belgian_pro', leagueTier: 2, dateTimeUtc: inMinutes(90 + i) }),
      ),
    ]
    expect(forwardExpansionShortfall(candidates, input({ mode: 'all' }))).toBe(0)
    expect(forwardExpansionShortfall(candidates, input({ mode: 'favorites_only' }))).toBe(MIN_VISIBLE_UPCOMING_FOOTBALL - 1)
  })
})

describe('selectForwardExpansion', () => {
  const existing = [event({ id: 'today', dateTimeUtc: inMinutes(90) })]
  const incoming = [
    event({ id: 'day6', dateTimeUtc: inDays(6) }),
    event({ id: 'day2', dateTimeUtc: inDays(2) }),
    event({ id: 'day4', dateTimeUtc: inDays(4) }),
    event({ id: 'day1', dateTimeUtc: inDays(1) }),
  ]

  it('adds the nearest fixtures first — this is the "coming up" row', () => {
    const picked = selectForwardExpansion(incoming, existing, input(), 2)
    expect(picked.map((ev) => ev.id)).toEqual(['day1', 'day2'])
  })

  // THE CAP. A week of a followed competition is a Schedule screen; the
  // shortfall is how many cards Home was actually missing.
  it('never returns more than the shortfall it was asked for', () => {
    expect(selectForwardExpansion(incoming, existing, input(), 1)).toHaveLength(1)
    expect(selectForwardExpansion(incoming, existing, input(), 0)).toEqual([])
  })

  it('takes everything it has when the shortfall is larger than the window holds', () => {
    expect(selectForwardExpansion(incoming, existing, input(), 10)).toHaveLength(4)
  })

  it('never re-adds an event today already produced', () => {
    const overlap = [event({ id: 'today', dateTimeUtc: inMinutes(90) }), event({ id: 'day1', dateTimeUtc: inDays(1) })]
    expect(selectForwardExpansion(overlap, existing, input(), 5).map((ev) => ev.id)).toEqual(['day1'])
  })

  it('never adds the same event twice from one payload', () => {
    const duplicated = [event({ id: 'day1', dateTimeUtc: inDays(1) }), event({ id: 'day1', dateTimeUtc: inDays(1) })]
    expect(selectForwardExpansion(duplicated, existing, input(), 5).map((ev) => ev.id)).toEqual(['day1'])
  })

  // The top-up has to deliver CARDS. An event the mode or the broadcast
  // verdict would remove is neither, so it cannot be spent against the
  // shortfall it was fetched to fill.
  it('skips events that would not survive the feed, and tops up with real ones instead', () => {
    const mixed = [
      event({ id: 'untelevised', dateTimeUtc: inDays(1), broadcastAvailability: 'CONFIRMED_NOT_BROADCAST' }),
      event({ id: 'unrelated', dateTimeUtc: inDays(1), leagueId: 'football_belgian_pro', leagueTier: 2 }),
      event({ id: 'day3', dateTimeUtc: inDays(3) }),
    ]
    expect(selectForwardExpansion(mixed, existing, input(), 2).map((ev) => ev.id)).toEqual(['day3'])
  })

  it('is a stable order for two fixtures in the same slot', () => {
    const sameSlot = [event({ id: 'b', dateTimeUtc: inDays(1) }), event({ id: 'a', dateTimeUtc: inDays(1) })]
    expect(selectForwardExpansion(sameSlot, [], input(), 5).map((ev) => ev.id)).toEqual(['a', 'b'])
  })
})

describe('the window', () => {
  // Longer than the three days it replaced (the trigger is now "this
  // viewer's competitions are quiet", and a quiet week answered with a
  // three-day window is the same empty row) — but stopping one day short of
  // a full week, because Home's cards name their day by weekday alone and
  // day seven repeats today's. See FORWARD_EXPANSION_DAYS.
  it('looks a bounded number of days forward, and never far enough to repeat today weekday', () => {
    expect(FORWARD_EXPANSION_DAYS).toBe(6)
    expect(FORWARD_EXPANSION_DAYS).toBeLessThan(7)
  })
})
