// The scoring half of Home's personalization: what ONE event is worth to
// one viewer. Ordering is homeRanking.test.ts's job.
//
// Every test states `now` explicitly — nothing here reads the clock, which
// is what makes "exactly 60 minutes away" a case that can be asserted
// rather than approximated.
import { describe, expect, it } from 'vitest'
import {
  HOME_WEIGHTS,
  NEUTRAL_PROMINENCE,
  buildPersonalizationContext,
  competitionImportance,
  eventTiming,
  getScoreBreakdown,
  matchupProminence,
  scoreEventAffinity,
  scoreFeedCandidate,
  scoreHeroCandidate,
  scoreObjectiveImportance,
  stageImportance,
} from './homePersonalization'
import type { SportEvent } from './types'

const NOW = Date.parse('2026-08-26T20:40:00Z')
const minutes = (n: number) => n * 60_000
const at = (offsetMinutes: number) => new Date(NOW + minutes(offsetMinutes)).toISOString()

function event(overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    id: 'e1',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    league: 'Test League',
    leagueId: 'test_league',
    leagueTier: 2,
    title: 'Home vs Away',
    homeTeam: 'Home',
    awayTeam: 'Away',
    dateTimeUtc: at(120),
    timeLabel: '',
    isLive: false,
    ...overrides,
  }
}

describe('eventTiming — the hero eligibility boundary', () => {
  it('reports a live event as live regardless of its kickoff time', () => {
    expect(eventTiming(event({ isLive: true, dateTimeUtc: at(-45) }), NOW)).toBe('live')
  })

  // TEST 4 (the boundary). Stated in milliseconds because rounding to whole
  // minutes first would make this depend on the seconds component of `now`.
  it('treats EXACTLY 60 minutes away as starting soon', () => {
    expect(eventTiming(event({ dateTimeUtc: at(60) }), NOW)).toBe('starting-soon')
  })

  it('treats 60 minutes plus one millisecond as merely upcoming', () => {
    const justOver = new Date(NOW + minutes(60) + 1).toISOString()
    expect(eventTiming(event({ dateTimeUtc: justOver }), NOW)).toBe('upcoming')
  })

  it('treats 61 minutes away as upcoming, not starting soon', () => {
    expect(eventTiming(event({ dateTimeUtc: at(61) }), NOW)).toBe('upcoming')
  })

  it('treats 59 minutes away as starting soon', () => {
    expect(eventTiming(event({ dateTimeUtc: at(59) }), NOW)).toBe('starting-soon')
  })

  // CHANGED 2026-08-27. This test used to assert that ANY passed kickoff
  // with isLive: false was 'past', which is the bug: a football fixture the
  // provider never advanced out of 'scheduled' (Lillestrøm - Egnatia,
  // observed live) was classified past while being played, and
  // feedGroupFor('past') is null — the match disappeared from Home. The
  // rule it now pins is the corrected one: past kickoff plus a status that
  // permits inference plus inside the in-play window means live. The
  // "kickoff passed therefore past" half survives below, stated against a
  // kickoff outside the window and against terminal statuses, which is
  // where it was always the right answer.
  it('treats a kickoff passed LONG ago with no live signal as past', () => {
    expect(eventTiming(event({ dateTimeUtc: at(-151) }), NOW)).toBe('past')
  })

  it('treats a just-kicked-off scheduled fixture as live, not past — a provider that never says "live" must not erase it', () => {
    expect(eventTiming(event({ dateTimeUtc: at(-1), status: 'scheduled' }), NOW)).toBe('live')
  })

  it('keeps a scheduled fixture live right up to the edge of football\'s in-play window', () => {
    expect(eventTiming(event({ dateTimeUtc: at(-150), status: 'scheduled' }), NOW)).toBe('live')
    expect(eventTiming(event({ dateTimeUtc: at(-151), status: 'scheduled' }), NOW)).toBe('past')
  })

  // The inference is about a MISSING update, never about contradicting one
  // the provider actually made.
  it.each(['complete', 'cancelled', 'postponed', 'abandoned'])(
    'never infers live over the terminal status "%s", even one minute after kickoff',
    (status) => {
      expect(eventTiming(event({ dateTimeUtc: at(-1), status }), NOW)).toBe('past')
    },
  )

  it('reports an event with no kickoff time as unknown rather than guessing', () => {
    expect(eventTiming(event({ dateTimeUtc: null }), NOW)).toBe('unknown')
  })

  it('reports an unparseable kickoff time as unknown rather than NaN-comparing it', () => {
    expect(eventTiming(event({ dateTimeUtc: 'not a date' }), NOW)).toBe('unknown')
  })
})

describe('matchupProminence', () => {
  it('ranks two giants above a giant and a small club, even though the giant is equally big in both', () => {
    const clasico = matchupProminence({ homeTeamProminence: 0.95, awayTeamProminence: 0.95 })
    const mismatch = matchupProminence({ homeTeamProminence: 0.95, awayTeamProminence: 0.2 })
    expect(clasico).toBeGreaterThan(mismatch)
  })

  it('still ranks a giant-vs-small fixture above a mid-vs-mid one — the bigger side carries more weight', () => {
    const mismatch = matchupProminence({ homeTeamProminence: 0.95, awayTeamProminence: 0.2 })
    const midTable = matchupProminence({ homeTeamProminence: 0.5, awayTeamProminence: 0.5 })
    expect(mismatch).toBeGreaterThan(midTable)
  })

  it('is symmetric — which side is at home cannot change how big the matchup is', () => {
    expect(matchupProminence({ homeTeamProminence: 0.9, awayTeamProminence: 0.3 })).toBe(
      matchupProminence({ homeTeamProminence: 0.3, awayTeamProminence: 0.9 }),
    )
  })

  // TEST 17.
  it('falls back to a neutral, finite value when prominence is unknown — never NaN', () => {
    const unknown = matchupProminence({})
    expect(Number.isFinite(unknown)).toBe(true)
    expect(unknown).toBe(NEUTRAL_PROMINENCE)
  })

  it('treats one known side and one unknown side as a partial signal, not as a missing event', () => {
    const half = matchupProminence({ homeTeamProminence: 1 })
    expect(Number.isFinite(half)).toBe(true)
    expect(half).toBeGreaterThan(NEUTRAL_PROMINENCE)
  })
})

describe('competitionImportance', () => {
  it('ranks the tiers in order, with the Champions League above every tier-1 league', () => {
    const cl = competitionImportance({ leagueId: 'football_champions_league', leagueTier: 1 })
    const tier1 = competitionImportance({ leagueId: 'football_premier_league', leagueTier: 1 })
    const tier2 = competitionImportance({ leagueId: 'x', leagueTier: 2 })
    const tier3 = competitionImportance({ leagueId: 'y', leagueTier: 3 })
    expect(cl).toBeGreaterThan(tier1)
    expect(tier1).toBeGreaterThan(tier2)
    expect(tier2).toBeGreaterThan(tier3)
  })

  it('never goes negative, and is finite for a competition with no tier at all', () => {
    const untiered = competitionImportance({ leagueId: 'unknown' })
    expect(Number.isFinite(untiered)).toBe(true)
    expect(untiered).toBeGreaterThanOrEqual(0)
  })
})

// TEST 12 — the substring bug this pass fixed. The weights differ; what
// matters is that the three stages resolve DISTINCTLY and in order.
describe('stageImportance', () => {
  it('ranks final > semi-final > quarter-final', () => {
    expect(stageImportance('Final')).toBeGreaterThan(stageImportance('Semi-final'))
    expect(stageImportance('Semi-final')).toBeGreaterThan(stageImportance('Quarter-final'))
  })

  it('does not score a semi-final or a quarter-final as a final', () => {
    expect(stageImportance('Semi-final')).not.toBe(stageImportance('Final'))
    expect(stageImportance('Quarter-final')).not.toBe(stageImportance('Final'))
  })

  it('scores an ordinary league round at nothing — stage is a bonus, not a baseline', () => {
    expect(stageImportance('Matchweek 12')).toBe(0)
    expect(stageImportance(undefined)).toBe(0)
  })

  it('ranks a knockout round above the group stage it follows', () => {
    expect(stageImportance('Round of 16')).toBeGreaterThan(stageImportance('Group Stage'))
  })
})

describe('scoreEventAffinity — what the viewer told us', () => {
  const brighton = 'team_brighton'
  const context = buildPersonalizationContext({
    favoriteTeamIds: [brighton],
    favoriteCompetitionIds: ['football_premier_league'],
  })

  it('scores a favorite team more highly than a favorite competition', () => {
    const withTeam = scoreEventAffinity(event({ leagueId: 'other', homeTeamId: brighton }), context)
    const withCompetition = scoreEventAffinity(event({ leagueId: 'football_premier_league' }), context)
    expect(withTeam).toBeGreaterThan(withCompetition)
  })

  it('matches a favorite team on EITHER side', () => {
    const home = scoreEventAffinity(event({ homeTeamId: brighton }), context)
    const away = scoreEventAffinity(event({ awayTeamId: brighton }), context)
    expect(home).toBe(away)
    expect(home).toBeGreaterThan(0)
  })

  // Names are not identity, ever.
  it('never matches a favorite by team NAME', () => {
    const byName = scoreEventAffinity(event({ homeTeam: brighton, awayTeam: 'Newcastle' }), context)
    expect(getScoreBreakdown(event({ homeTeam: brighton }), context).favoriteTeam).toBe(0)
    expect(byName).toBe(scoreEventAffinity(event(), context))
  })

  // TEST 8 — the domestic-league relationship.
  it('boosts a club playing OUTSIDE its own league when that league is followed', () => {
    const eliteserien = buildPersonalizationContext({ favoriteCompetitionIds: ['norway_eliteserien'] })
    const glimtInEurope = event({
      leagueId: 'football_champions_league',
      homeTeamId: 'team_glimt',
      homeDomesticCompetitionId: 'norway_eliteserien',
      awayDomesticCompetitionId: 'portugal_primeira',
    })
    const breakdown = getScoreBreakdown(glimtInEurope, eliteserien)
    expect(breakdown.domesticAffinity).toBe(HOME_WEIGHTS.domesticAffinity)
    expect(breakdown.favoriteCompetition).toBe(0)
  })

  // No double counting: a Premier League fixture between two Premier League
  // clubs is ONE expressed interest, not two.
  it('does not add a domestic boost on top of the competition already being a favorite', () => {
    const pl = buildPersonalizationContext({ favoriteCompetitionIds: ['football_premier_league'] })
    const breakdown = getScoreBreakdown(
      event({
        leagueId: 'football_premier_league',
        homeDomesticCompetitionId: 'football_premier_league',
        awayDomesticCompetitionId: 'football_premier_league',
      }),
      pl,
    )
    expect(breakdown.favoriteCompetition).toBe(HOME_WEIGHTS.favoriteCompetition)
    expect(breakdown.domesticAffinity).toBe(0)
  })

  // TEST 9 — favoriting the club itself is stronger still.
  it('scores an explicitly followed club above the same event reached only through its domestic league', () => {
    const leagueOnly = buildPersonalizationContext({ favoriteCompetitionIds: ['norway_eliteserien'] })
    const alsoTheClub = buildPersonalizationContext({
      favoriteCompetitionIds: ['norway_eliteserien'],
      favoriteTeamIds: ['team_glimt'],
    })
    const glimt = event({
      leagueId: 'football_champions_league',
      homeTeamId: 'team_glimt',
      homeDomesticCompetitionId: 'norway_eliteserien',
    })
    expect(scoreEventAffinity(glimt, alsoTheClub)).toBeGreaterThan(scoreEventAffinity(glimt, leagueOnly))
  })

  it('scores nothing at all for a viewer who has expressed no preferences', () => {
    const none = buildPersonalizationContext({})
    expect(scoreEventAffinity(event({ homeTeamId: brighton }), none)).toBe(0)
  })
})

describe('learned affinity stays below explicit choice', () => {
  it('never lets a heavily-watched team outweigh an explicitly followed one', () => {
    const watched = buildPersonalizationContext({
      teamAffinity: new Map([['team_watched', 1]]),
    })
    const followed = buildPersonalizationContext({ favoriteTeamIds: ['team_followed'] })
    const watchedEvent = event({ homeTeamId: 'team_watched' })
    const followedEvent = event({ homeTeamId: 'team_followed' })
    expect(scoreEventAffinity(watchedEvent, watched)).toBeLessThan(scoreEventAffinity(followedEvent, followed))
  })

  it('takes the stronger of the two sides rather than summing them', () => {
    const context = buildPersonalizationContext({
      teamAffinity: new Map([
        ['a', 0.5],
        ['b', 0.5],
      ]),
    })
    const both = getScoreBreakdown(event({ homeTeamId: 'a', awayTeamId: 'b' }), context)
    const one = getScoreBreakdown(event({ homeTeamId: 'a' }), context)
    expect(both.learnedTeam).toBe(one.learnedTeam)
  })

  it('applies the continuity boost only while the match is still live', () => {
    const context = buildPersonalizationContext({ continuityEventId: 'e1' })
    expect(getScoreBreakdown(event({ id: 'e1', isLive: true }), context).continuity).toBe(HOME_WEIGHTS.continuity)
    expect(getScoreBreakdown(event({ id: 'e1', isLive: false }), context).continuity).toBe(0)
  })
})

// TEST 16 — MANDATORY. favoriteCountries is a BROADCAST preference (which
// market to take a stream from), not a statement about sporting interest.
// It is not an input to this module at all, which is what this asserts.
describe('favoriteCountries never reaches event scoring', () => {
  it('has no way of entering a personalization context', () => {
    const context = buildPersonalizationContext({ favoriteCompetitionIds: [], favoriteTeamIds: [] })
    expect(Object.keys(context)).not.toContain('favoriteCountries')
  })

  it('produces an identical score for a Norwegian and an English fixture with no other difference', () => {
    const context = buildPersonalizationContext({})
    const norwegian = event({ id: 'no', leagueId: 'l', homeTeamId: 'a', awayTeamId: 'b' })
    const english = event({ id: 'gb', leagueId: 'l', homeTeamId: 'c', awayTeamId: 'd' })
    expect(scoreFeedCandidate(norwegian, context)).toBe(scoreFeedCandidate(english, context))
  })
})

// TEST 14 — an events payload from a ninety-api build that predates the
// personalization block.
describe('an old backend payload (no team ids, prominence or rivalry)', () => {
  const context = buildPersonalizationContext({
    favoriteTeamIds: ['team_x'],
    favoriteCompetitionIds: ['football_premier_league'],
  })
  const bare = event({ leagueId: 'football_premier_league' })

  it('produces a finite score with no NaN anywhere in the breakdown', () => {
    const breakdown = getScoreBreakdown(bare, context, { now: NOW })
    for (const [key, value] of Object.entries(breakdown)) {
      expect(Number.isFinite(value), `${key} should be finite`).toBe(true)
    }
  })

  it('contributes nothing from the missing signals rather than guessing', () => {
    const breakdown = getScoreBreakdown(bare, context)
    expect(breakdown.favoriteTeam).toBe(0)
    expect(breakdown.domesticAffinity).toBe(0)
    expect(breakdown.rivalry).toBe(0)
  })

  it('still ranks on the signals it does have — the followed competition still counts', () => {
    const followed = scoreFeedCandidate(bare, context)
    const notFollowed = scoreFeedCandidate(event({ leagueId: 'some_other_league', leagueTier: 1 }), context)
    expect(followed).toBeGreaterThan(notFollowed)
  })
})

describe('hero vs feed scoring differ only in whether time earns points', () => {
  const context = buildPersonalizationContext({})

  it('gives a live event temporal points for the hero', () => {
    const liveEvent = event({ isLive: true })
    expect(scoreHeroCandidate(liveEvent, context, NOW)).toBe(scoreFeedCandidate(liveEvent, context) + HOME_WEIGHTS.temporalLive)
  })

  it('gives the FEED no temporal points at all — the feed states time through its groups', () => {
    const liveEvent = event({ isLive: true })
    const distant = event({ dateTimeUtc: at(600) })
    expect(getScoreBreakdown(liveEvent, context).temporal).toBe(0)
    expect(getScoreBreakdown(distant, context).temporal).toBe(0)
  })

  it('decreases the hero temporal bonus as kickoff gets further away, within the window', () => {
    const soonest = scoreHeroCandidate(event({ dateTimeUtc: at(10) }), context, NOW)
    const middle = scoreHeroCandidate(event({ dateTimeUtc: at(35) }), context, NOW)
    const edge = scoreHeroCandidate(event({ dateTimeUtc: at(55) }), context, NOW)
    expect(soonest).toBeGreaterThan(middle)
    expect(middle).toBeGreaterThan(edge)
  })

  it('gives an event beyond the window no temporal points, so it cannot buy its way toward the hero', () => {
    expect(getScoreBreakdown(event({ dateTimeUtc: at(90) }), context, { now: NOW }).temporal).toBe(0)
  })
})

describe('scoreObjectiveImportance — Home works with no preferences at all', () => {
  it('ranks a big-club final above a small-club league game', () => {
    const final = event({
      leagueId: 'football_champions_league',
      leagueTier: 1,
      round: 'Final',
      homeTeamProminence: 0.95,
      awayTeamProminence: 0.9,
      rivalryImportance: 0.5,
    })
    const ordinary = event({ leagueId: 'small', leagueTier: 3, round: 'Matchweek 4', homeTeamProminence: 0.2, awayTeamProminence: 0.2 })
    expect(scoreObjectiveImportance(final)).toBeGreaterThan(scoreObjectiveImportance(ordinary))
  })

  it('separates a derby from the same two clubs meeting anyone else', () => {
    const base = { homeTeamProminence: 0.6, awayTeamProminence: 0.6 }
    expect(scoreObjectiveImportance(event({ ...base, rivalryImportance: 1 }))).toBeGreaterThan(
      scoreObjectiveImportance(event({ ...base, rivalryImportance: 0 })),
    )
  })
})
