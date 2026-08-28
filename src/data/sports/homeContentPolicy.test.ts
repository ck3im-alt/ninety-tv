// What each Home content mode actually admits, stated case by case.
//
// Every scenario is data — a fixture, a mode, a viewer — with no clock and
// no React, because inclusion is deliberately time-independent: "being live"
// decides ranking among allowed candidates and is never a way past this
// gate. The Home-level consequences of that (hero and feed sharing one pool,
// an excluded live match staying out) are pinned in useHomeFeed.test.ts.
import { describe, expect, it } from 'vitest'
import {
  MARQUEE_CLUB_PROMINENCE,
  OUTSIDE_HIGHLIGHT_IMPORTANCE,
  describeHomeContentDecision,
  filterHomeEventsByMode,
  isHomeEventIncluded,
  isMarqueeBigFiveFixture,
  isOutsideHighlight,
} from './homeContentPolicy'
import { buildPersonalizationContext, scoreObjectiveImportance } from './homePersonalization'
import { BIG_FIVE_COMPETITION_IDS } from './editorialCompetitions'
import type { SportEvent } from './types'

function event(overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    id: 'evt',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    league: 'Test League',
    leagueId: 'football_test',
    title: 'Home FC vs Away FC',
    dateTimeUtc: '2026-08-28T19:00:00Z',
    timeLabel: '21:00',
    isLive: false,
    ...overrides,
  }
}

// Real values from ninety-api's own prominence seeds (sports/
// teamProminence.ts, read 2026-08-28) rather than invented numbers, so the
// thresholds here are calibrated against the data the app actually receives.
const PROMINENCE = {
  barcelona: 0.99,
  bayern: 0.96,
  liverpool: 0.97,
  arsenal: 0.94,
  dortmund: 0.89,
  celtic: 0.76,
  rangers: 0.745,
  bodoGlimt: 0.5,
  viking: 0.415,
  brentford: 0.44,
  burnley: 0.42,
  // An uncurated club in a tier-1 league — LEAGUE_TIER_BASELINE[1].
  uncuratedTopFlight: 0.38,
}

const followsPremierLeague = buildPersonalizationContext({ favoriteCompetitionIds: ['football_premier_league'] })
const followsEliteserien = buildPersonalizationContext({ favoriteCompetitionIds: ['football_eliteserien'] })

describe("mode 'all' — today's behaviour, unchanged", () => {
  it('admits an unrelated competition', () => {
    const belgian = event({ leagueId: 'football_belgian_pro', leagueTier: 2 })
    expect(isHomeEventIncluded(belgian, 'all', followsPremierLeague)).toBe(true)
  })

  it('admits a fixture from a followed competition too — favourites decide order, not inclusion', () => {
    const pl = event({ leagueId: 'football_premier_league', leagueTier: 1 })
    expect(isHomeEventIncluded(pl, 'all', followsPremierLeague)).toBe(true)
  })

  it('admits everything even for a viewer who follows nothing at all', () => {
    const nobody = buildPersonalizationContext({})
    expect(isHomeEventIncluded(event({ leagueId: 'football_obscure' }), 'all', nobody)).toBe(true)
  })

  it('removes nothing from a mixed pool', () => {
    const pool = [
      event({ id: 'a', leagueId: 'football_premier_league' }),
      event({ id: 'b', leagueId: 'football_belgian_pro' }),
      event({ id: 'c', leagueId: 'football_second_tier' }),
    ]
    expect(filterHomeEventsByMode(pool, 'all', followsPremierLeague).map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })
})

describe("mode 'highlights' — what you follow, plus real occasions", () => {
  it('admits the viewer\'s own competition', () => {
    const pl = event({ leagueId: 'football_premier_league', leagueTier: 1, round: 'Matchweek 4' })
    expect(isHomeEventIncluded(pl, 'highlights', followsPremierLeague)).toBe(true)
  })

  it('admits an ORDINARY fixture in a followed competition — following a league means following its whole season', () => {
    const dullPl = event({
      leagueId: 'football_premier_league',
      leagueTier: 1,
      round: 'Matchweek 4',
      homeTeamProminence: PROMINENCE.brentford,
      awayTeamProminence: PROMINENCE.burnley,
    })
    expect(isHomeEventIncluded(dullPl, 'highlights', followsPremierLeague)).toBe(true)
  })

  it('admits a favourite CLUB playing outside every followed competition', () => {
    const context = buildPersonalizationContext({
      favoriteCompetitionIds: ['football_premier_league'],
      favoriteTeamIds: ['team_glimt'],
    })
    const cupTie = event({
      leagueId: 'football_norwegian_cup',
      leagueTier: 3,
      homeTeamId: 'team_glimt',
      homeTeamProminence: PROMINENCE.bodoGlimt,
      awayTeamProminence: 0.3,
    })
    expect(isHomeEventIncluded(cupTie, 'highlights', context)).toBe(true)
  })

  // THE BODØ/GLIMT CASE. "I follow Eliteserien" has to reach a Norwegian
  // club's European nights without the viewer also following the Champions
  // League — the whole reason the domestic-membership fields exist.
  it('admits a domestic-affinity European fixture', () => {
    const european = event({
      leagueId: 'football_champions_league',
      leagueTier: 1,
      round: 'Group Stage',
      homeDomesticCompetitionId: 'football_eliteserien',
      homeTeamProminence: PROMINENCE.bodoGlimt,
      awayTeamProminence: 0.45,
    })
    expect(isHomeEventIncluded(european, 'highlights', followsEliteserien)).toBe(true)
  })

  it('admits it through the AWAY side\'s domestic membership just the same', () => {
    const european = event({
      leagueId: 'football_champions_league',
      awayDomesticCompetitionId: 'football_eliteserien',
      homeTeamProminence: 0.45,
      awayTeamProminence: PROMINENCE.bodoGlimt,
    })
    expect(isHomeEventIncluded(european, 'highlights', followsEliteserien)).toBe(true)
  })

  it('admits a marquee Big Five fixture the viewer follows nothing about', () => {
    const clasico = event({
      leagueId: 'football_la_liga',
      leagueTier: 1,
      round: 'Matchweek 9',
      homeTeamProminence: PROMINENCE.barcelona,
      awayTeamProminence: 0.6,
    })
    expect(isHomeEventIncluded(clasico, 'highlights', followsPremierLeague)).toBe(true)
    expect(isHomeEventIncluded(clasico, 'highlights', followsEliteserien)).toBe(true)
  })

  it('admits a marquee club regardless of which side of the fixture it is on', () => {
    const away = event({
      leagueId: 'football_bundesliga',
      leagueTier: 1,
      homeTeamProminence: 0.42,
      awayTeamProminence: PROMINENCE.bayern,
    })
    expect(isHomeEventIncluded(away, 'highlights', followsPremierLeague)).toBe(true)
  })

  it('admits a Champions League final as a genuine occasion, even between unremarkable clubs', () => {
    const final = event({
      leagueId: 'football_champions_league',
      leagueTier: 1,
      round: 'Final',
      homeTeamProminence: PROMINENCE.uncuratedTopFlight,
      awayTeamProminence: PROMINENCE.uncuratedTopFlight,
    })
    expect(isHomeEventIncluded(final, 'highlights', followsEliteserien)).toBe(true)
  })

  it('admits a major derby on rivalry plus real clubs', () => {
    const oldFirm = event({
      leagueId: 'football_scottish_premiership',
      leagueTier: 2,
      round: 'Matchweek 12',
      homeTeamProminence: PROMINENCE.celtic,
      awayTeamProminence: PROMINENCE.rangers,
      rivalryImportance: 1,
    })
    expect(isHomeEventIncluded(oldFirm, 'highlights', followsPremierLeague)).toBe(true)
  })

  // --- and now everything it must NOT admit -------------------------------

  it('rejects an ordinary mid-table fixture from an unrelated league', () => {
    const belgian = event({
      leagueId: 'football_belgian_pro',
      leagueTier: 2,
      round: 'Matchweek 7',
      homeTeamProminence: 0.42,
      awayTeamProminence: 0.4,
    })
    expect(isHomeEventIncluded(belgian, 'highlights', followsPremierLeague)).toBe(false)
  })

  it('rejects a second-tier fixture', () => {
    const secondTier = event({
      leagueId: 'football_championship',
      leagueTier: 2,
      round: 'Matchweek 14',
      homeTeamProminence: 0.41,
      awayTeamProminence: 0.4,
    })
    expect(isHomeEventIncluded(secondTier, 'highlights', followsPremierLeague)).toBe(false)
  })

  // The mode has to stay meaningfully narrower than 'all'. An ordinary
  // Premier League game is exactly the "unrelated league" case for someone
  // who follows Eliteserien, and admitting it on Big Five membership alone
  // would make this mode 'all' with extra steps.
  it('rejects an ordinary Big Five fixture with no marquee club in it', () => {
    const dullPl = event({
      leagueId: 'football_premier_league',
      leagueTier: 1,
      round: 'Matchweek 4',
      homeTeamProminence: PROMINENCE.brentford,
      awayTeamProminence: PROMINENCE.burnley,
    })
    expect(isHomeEventIncluded(dullPl, 'highlights', followsEliteserien)).toBe(false)
  })

  it('rejects an early-round tie in an elite competition between small clubs', () => {
    const qualifier = event({
      leagueId: 'football_champions_league',
      leagueTier: 1,
      round: 'Second Qualifying Round',
      homeTeamProminence: 0.42,
      awayTeamProminence: 0.4,
    })
    expect(isHomeEventIncluded(qualifier, 'highlights', followsPremierLeague)).toBe(false)
  })

  it('rejects a marquee club playing OUTSIDE the Big Five leagues on prominence alone', () => {
    const friendly = event({
      leagueId: 'football_club_friendly',
      leagueTier: 3,
      homeTeamProminence: PROMINENCE.barcelona,
      awayTeamProminence: 0.3,
    })
    expect(isMarqueeBigFiveFixture(friendly)).toBe(false)
    expect(isHomeEventIncluded(friendly, 'highlights', followsEliteserien)).toBe(false)
  })

  // LEARNED AFFINITY MUST NOT UNLOCK ANYTHING. It may reorder what is
  // already included; letting it also admit competitions would mean a
  // content-breadth setting the app quietly erodes the more you watch.
  it('is not unlocked by learned watch affinity', () => {
    const context = buildPersonalizationContext({
      favoriteCompetitionIds: ['football_premier_league'],
      teamAffinity: new Map([['team_anderlecht', 1]]),
      competitionAffinity: new Map([['football_belgian_pro', 1]]),
    })
    const belgian = event({
      leagueId: 'football_belgian_pro',
      leagueTier: 2,
      homeTeamId: 'team_anderlecht',
      homeTeamProminence: 0.535,
      awayTeamProminence: 0.4,
    })
    expect(isHomeEventIncluded(belgian, 'highlights', context)).toBe(false)
  })

  // A pre-personalization ninety-api sends no prominence at all. A gate must
  // read that as "no evidence", never as the mid-scale value scoring uses.
  it('does not treat a missing prominence as marquee', () => {
    const noMetadata = event({ leagueId: 'football_la_liga', leagueTier: 1, round: 'Matchweek 3' })
    expect(isMarqueeBigFiveFixture(noMetadata)).toBe(false)
    expect(isHomeEventIncluded(noMetadata, 'highlights', followsEliteserien)).toBe(false)
  })

  it('still lets a genuinely major occasion through against a backend that sends no prominence', () => {
    const final = event({ leagueId: 'football_champions_league', leagueTier: 1, round: 'Final' })
    expect(isHomeEventIncluded(final, 'highlights', followsEliteserien)).toBe(true)
  })
})

describe("mode 'favorites_only' — strict means strict", () => {
  it('admits a fixture whose own competition is followed', () => {
    const eliteserien = event({ leagueId: 'football_eliteserien', leagueTier: 3 })
    expect(isHomeEventIncluded(eliteserien, 'favorites_only', followsEliteserien)).toBe(true)
  })

  it('rejects a fixture from a competition that is not followed', () => {
    const laLiga = event({ leagueId: 'football_la_liga', leagueTier: 1 })
    expect(isHomeEventIncluded(laLiga, 'favorites_only', followsEliteserien)).toBe(false)
  })

  it('is NOT overridden by a favourite club playing elsewhere', () => {
    const context = buildPersonalizationContext({
      favoriteCompetitionIds: ['football_eliteserien'],
      favoriteTeamIds: ['team_glimt'],
    })
    const european = event({
      leagueId: 'football_champions_league',
      homeTeamId: 'team_glimt',
      homeTeamProminence: PROMINENCE.bodoGlimt,
    })
    expect(isHomeEventIncluded(european, 'favorites_only', context)).toBe(false)
    // ...and the same club's own league match is still perfectly welcome.
    expect(
      isHomeEventIncluded(event({ leagueId: 'football_eliteserien', homeTeamId: 'team_glimt' }), 'favorites_only', context),
    ).toBe(true)
  })

  // THE BODØ/GLIMT CASE AGAIN, and the answer is the opposite one. The
  // viewer said "my leagues only"; reading that as "my interests only" is
  // answering a question they did not ask.
  it('is NOT overridden by domestic affinity', () => {
    const european = event({
      leagueId: 'football_champions_league',
      homeDomesticCompetitionId: 'football_eliteserien',
    })
    expect(isHomeEventIncluded(european, 'favorites_only', followsEliteserien)).toBe(false)
  })

  it('IS satisfied once the viewer also follows that competition', () => {
    const context = buildPersonalizationContext({
      favoriteCompetitionIds: ['football_eliteserien', 'football_champions_league'],
    })
    const european = event({ leagueId: 'football_champions_league', homeDomesticCompetitionId: 'football_eliteserien' })
    expect(isHomeEventIncluded(european, 'favorites_only', context)).toBe(true)
  })

  it('is NOT overridden by prominence', () => {
    const clasico = event({
      leagueId: 'football_la_liga',
      leagueTier: 1,
      homeTeamProminence: PROMINENCE.barcelona,
      awayTeamProminence: PROMINENCE.liverpool,
    })
    expect(isHomeEventIncluded(clasico, 'favorites_only', followsEliteserien)).toBe(false)
  })

  // The mirror of the highlights 'major derby' case above. Rivalry is the
  // one remaining term in scoreObjectiveImportance that can carry a fixture
  // over the outside-highlight bar on its own, so it gets its own strict
  // case rather than being assumed covered by the prominence one.
  it('is NOT overridden by a maximum-rivalry derby', () => {
    const oldFirm = event({
      leagueId: 'football_scottish_premiership',
      leagueTier: 2,
      round: 'Matchweek 12',
      homeTeamProminence: PROMINENCE.celtic,
      awayTeamProminence: PROMINENCE.rangers,
      rivalryImportance: 1,
    })
    // It really is an outside highlight — this is not a case that fails the
    // bar and would therefore be excluded anyway.
    expect(isOutsideHighlight(oldFirm)).toBe(true)
    expect(isHomeEventIncluded(oldFirm, 'favorites_only', followsEliteserien)).toBe(false)
  })

  it('is NOT overridden by a Champions League final', () => {
    const final = event({
      leagueId: 'football_champions_league',
      leagueTier: 1,
      round: 'Final',
      homeTeamProminence: PROMINENCE.barcelona,
      awayTeamProminence: PROMINENCE.liverpool,
      rivalryImportance: 1,
    })
    expect(isOutsideHighlight(final)).toBe(true)
    expect(isHomeEventIncluded(final, 'favorites_only', followsEliteserien)).toBe(false)
  })

  it('admits nothing football-shaped when the viewer follows no competitions', () => {
    const nobody = buildPersonalizationContext({})
    const pool = [event({ id: 'a' }), event({ id: 'b', leagueId: 'football_la_liga' })]
    expect(filterHomeEventsByMode(pool, 'favorites_only', nobody)).toEqual([])
  })
})

// This preference is about football LEAGUE breadth, because football is the
// only sport with per-competition selections. Whether F1 appears is decided
// by whether the sport itself is enabled, and a stricter football mode must
// not quietly take the race weekend away with it.
describe('non-football sports', () => {
  const race = event({
    id: 'f1',
    sportKey: 'f1',
    sportLabel: 'F1',
    league: 'Formula 1',
    leagueId: '4370',
    title: 'Belgian Grand Prix',
  })

  it.each(['all', 'highlights', 'favorites_only'] as const)('is untouched by mode %s', (mode) => {
    expect(isHomeEventIncluded(race, mode, followsPremierLeague)).toBe(true)
    expect(isHomeEventIncluded(race, mode, buildPersonalizationContext({}))).toBe(true)
  })

  it('survives a filter pass that removes every football candidate', () => {
    const pool = [event({ id: 'football', leagueId: 'football_la_liga' }), race]
    expect(filterHomeEventsByMode(pool, 'favorites_only', followsEliteserien).map((e) => e.id)).toEqual(['f1'])
  })
})

// The thresholds are an editorial calibration, so pin the anchors they were
// chosen against rather than only their consequences — a retune should have
// to look at these numbers deliberately.
describe('marquee thresholds', () => {
  it('sits the club threshold at the top prominence band ninety-api documents', () => {
    expect(MARQUEE_CLUB_PROMINENCE).toBe(0.9)
    expect(PROMINENCE.barcelona).toBeGreaterThanOrEqual(MARQUEE_CLUB_PROMINENCE)
    expect(PROMINENCE.bayern).toBeGreaterThanOrEqual(MARQUEE_CLUB_PROMINENCE)
    expect(PROMINENCE.arsenal).toBeGreaterThanOrEqual(MARQUEE_CLUB_PROMINENCE)
    // The band's own boundary: a continental heavyweight is not a global
    // megaclub, and its ordinary league game is not an outside highlight.
    expect(PROMINENCE.dortmund).toBeLessThan(MARQUEE_CLUB_PROMINENCE)
  })

  it('separates real occasions from ordinary fixtures at the importance threshold', () => {
    const importanceOf = (overrides: Partial<SportEvent>) => scoreObjectiveImportance(event(overrides))

    const clFinal = importanceOf({ leagueId: 'football_champions_league', leagueTier: 1, round: 'Final' })
    const ordinaryPl = importanceOf({
      leagueId: 'football_premier_league',
      leagueTier: 1,
      round: 'Matchweek 4',
      homeTeamProminence: PROMINENCE.brentford,
      awayTeamProminence: PROMINENCE.burnley,
    })

    expect(clFinal).toBeGreaterThanOrEqual(OUTSIDE_HIGHLIGHT_IMPORTANCE)
    expect(ordinaryPl).toBeLessThan(OUTSIDE_HIGHLIGHT_IMPORTANCE)
  })

  it('uses the app\'s one shared Big Five definition, not a second list', () => {
    for (const id of BIG_FIVE_COMPETITION_IDS) {
      const fixture = event({ leagueId: id, homeTeamProminence: PROMINENCE.barcelona })
      expect(isMarqueeBigFiveFixture(fixture)).toBe(true)
    }
  })
})

describe('describeHomeContentDecision', () => {
  it('reports the same verdict the real path takes, with the rule that produced it', () => {
    const european = event({
      leagueId: 'football_champions_league',
      leagueTier: 1,
      round: 'Group Stage',
      homeDomesticCompetitionId: 'football_eliteserien',
      homeTeamProminence: PROMINENCE.bodoGlimt,
      awayTeamProminence: PROMINENCE.viking,
    })
    const decision = describeHomeContentDecision(european, 'highlights', followsEliteserien)

    expect(decision.included).toBe(isHomeEventIncluded(european, 'highlights', followsEliteserien))
    expect(decision.included).toBe(true)
    expect(decision.domesticMembership).toBe(true)
    expect(decision.favoriteCompetition).toBe(false)
    expect(decision.marqueeBigFive).toBe(false)
    expect(decision.mode).toBe('highlights')
  })

  it('explains a removal too', () => {
    const belgian = event({ leagueId: 'football_belgian_pro', leagueTier: 2, homeTeamProminence: 0.4, awayTeamProminence: 0.4 })
    const decision = describeHomeContentDecision(belgian, 'favorites_only', followsEliteserien)
    expect(decision.included).toBe(false)
    expect(decision.favoriteCompetition).toBe(false)
    expect(decision.domesticMembership).toBe(false)
    expect(decision.exceptionalOccasion).toBe(false)
  })
})
