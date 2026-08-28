// Home's two rankings, and the fact that they are deliberately different.
//
// Every scenario is written as the product spec states it: a wall-clock
// time, a handful of fixtures, and one expected answer. `now` is a
// parameter throughout, so these are ordinary pure-function tests — no fake
// timers, no clock mocking, and the 60-minute boundary can be asserted to
// the millisecond.
import { describe, expect, it } from 'vitest'
import {
  SAME_SLOT_TOLERANCE_MS,
  applyDiversity,
  describeRanking,
  getWatchableNowCandidates,
  rankHomeFeed,
  selectHero,
} from './homeRanking'
import { buildPersonalizationContext, scoreFeedCandidate } from './homePersonalization'
import type { SportEvent } from './types'

// 20:40 — the exact scenario the spec is written around.
const NOW = Date.parse('2026-08-26T20:40:00Z')
const minutes = (n: number) => n * 60_000
const at = (offsetMinutes: number) => new Date(NOW + minutes(offsetMinutes)).toISOString()
// Absolute wall-clock kickoffs, for the scenarios stated that way.
const clock = (hhmm: string) => `2026-08-26T${hhmm}:00Z`

function event(id: string, overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    id,
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    league: 'League',
    leagueId: 'generic_league',
    leagueTier: 2,
    title: id,
    homeTeam: 'Home',
    awayTeam: 'Away',
    dateTimeUtc: at(120),
    timeLabel: '',
    isLive: false,
    ...overrides,
  }
}

// --- The cast the spec's own examples use -------------------------------

const TROMSO_MOLDE = (overrides: Partial<SportEvent> = {}) =>
  event('tromso-molde', {
    title: 'Tromsø vs Molde',
    league: 'Eliteserien',
    leagueId: 'norway_eliteserien',
    leagueTier: 3,
    homeTeamId: 'team_tromso',
    awayTeamId: 'team_molde',
    homeDomesticCompetitionId: 'norway_eliteserien',
    awayDomesticCompetitionId: 'norway_eliteserien',
    homeTeamProminence: 0.2,
    awayTeamProminence: 0.25,
    isLive: true,
    dateTimeUtc: at(-35),
    ...overrides,
  })

const MU_LIVERPOOL = (overrides: Partial<SportEvent> = {}) =>
  event('mu-liverpool', {
    title: 'Manchester United vs Liverpool',
    league: 'Premier League',
    leagueId: 'football_premier_league',
    leagueTier: 1,
    homeTeamId: 'team_manutd',
    awayTeamId: 'team_liverpool',
    homeDomesticCompetitionId: 'football_premier_league',
    awayDomesticCompetitionId: 'football_premier_league',
    homeTeamProminence: 0.97,
    awayTeamProminence: 0.95,
    rivalryImportance: 0.95,
    dateTimeUtc: clock('21:00'),
    ...overrides,
  })

const BRIGHTON_FULHAM = (overrides: Partial<SportEvent> = {}) =>
  event('brighton-fulham', {
    title: 'Brighton vs Fulham',
    league: 'Premier League',
    leagueId: 'football_premier_league',
    leagueTier: 1,
    homeTeamId: 'team_brighton',
    awayTeamId: 'team_fulham',
    homeDomesticCompetitionId: 'football_premier_league',
    awayDomesticCompetitionId: 'football_premier_league',
    homeTeamProminence: 0.55,
    awayTeamProminence: 0.5,
    dateTimeUtc: clock('21:00'),
    ...overrides,
  })

const BRIGHTON_NEWCASTLE = (overrides: Partial<SportEvent> = {}) =>
  event('brighton-newcastle', {
    title: 'Brighton vs Newcastle',
    league: 'Premier League',
    leagueId: 'football_premier_league',
    leagueTier: 1,
    homeTeamId: 'team_brighton',
    awayTeamId: 'team_newcastle',
    homeDomesticCompetitionId: 'football_premier_league',
    awayDomesticCompetitionId: 'football_premier_league',
    homeTeamProminence: 0.55,
    awayTeamProminence: 0.6,
    ...overrides,
  })

const NO_PREFERENCES = buildPersonalizationContext({})
const PL_FAN = buildPersonalizationContext({ favoriteCompetitionIds: ['football_premier_league'] })
const MU_FAN = buildPersonalizationContext({
  favoriteCompetitionIds: ['football_premier_league'],
  favoriteTeamIds: ['team_manutd'],
})

// ===========================================================================
// HERO — the eligibility wall
// ===========================================================================

describe('getWatchableNowCandidates', () => {
  it('admits live events and events kicking off within the hour, and nothing else', () => {
    const ids = getWatchableNowCandidates(
      [
        event('live', { isLive: true, dateTimeUtc: at(-20) }),
        event('soon', { dateTimeUtc: at(30) }),
        event('later', { dateTimeUtc: at(90) }),
        event('finished', { dateTimeUtc: at(-200) }),
        event('undated', { dateTimeUtc: null }),
      ],
      NOW,
    ).map((e) => e.id)
    expect(ids).toEqual(['live', 'soon'])
  })
})

// The other half of the provider-status-lag fix (see mapEvent.test.ts's own
// suite for the mapping side). The hero gate reads eventTiming, so a match
// the provider left on 'scheduled' has to be admitted to the watchable-now
// pool too — otherwise Home would show it in the row while refusing to ever
// feature it, and `isWatchableNow` would be wrong about a match that is on.
describe('getWatchableNowCandidates — a provider that never says "live"', () => {
  it('admits a scheduled football fixture that has kicked off and is still inside the in-play window', () => {
    const ids = getWatchableNowCandidates(
      [
        event('stale-scheduled', { status: 'scheduled', dateTimeUtc: at(-45) }),
        event('really-over', { status: 'complete', dateTimeUtc: at(-45) }),
        event('called-off', { status: 'postponed', dateTimeUtc: at(-45) }),
        event('long-gone', { status: 'scheduled', dateTimeUtc: at(-200) }),
      ],
      NOW,
    ).map((e) => e.id)
    expect(ids).toEqual(['stale-scheduled'])
  })
})

describe('selectHero — the 60-minute wall', () => {
  // TEST 1.
  it('keeps a live non-favorite as hero over a favorite match more than an hour away', () => {
    const live = TROMSO_MOLDE()
    const favorite = MU_LIVERPOOL({ dateTimeUtc: at(180) })
    expect(selectHero([live, favorite], MU_FAN, NOW).hero?.id).toBe('tromso-molde')
  })

  // TEST 3 — the 19:59 case, stated as the spec does. Manchester United -
  // Liverpool at 21:00 is 61 minutes away and must not even be a candidate.
  it('excludes a 61-minutes-away match from the hero pool entirely', () => {
    const nineteenFiftyNine = Date.parse('2026-08-26T19:59:00Z')
    const live = TROMSO_MOLDE({ dateTimeUtc: clock('19:30') })
    const big = MU_LIVERPOOL()
    expect(getWatchableNowCandidates([live, big], nineteenFiftyNine).map((e) => e.id)).toEqual(['tromso-molde'])
    expect(selectHero([live, big], MU_FAN, nineteenFiftyNine).hero?.id).toBe('tromso-molde')
  })

  // TEST 4 — two minutes later, the same fixture is 59 minutes away and CAN
  // win. Nothing about the two matches changed; only the clock did.
  it('lets the same match win the hero two minutes later, at 59 minutes away', () => {
    const twentyOhOne = Date.parse('2026-08-26T20:01:00Z')
    const live = TROMSO_MOLDE({ dateTimeUtc: clock('19:30') })
    const big = MU_LIVERPOOL()
    expect(selectHero([live, big], MU_FAN, twentyOhOne).hero?.id).toBe('mu-liverpool')
  })

  it('admits a match exactly 60 minutes away, and rejects it one millisecond later', () => {
    const live = TROMSO_MOLDE()
    const exactly = MU_LIVERPOOL({ dateTimeUtc: new Date(NOW + minutes(60)).toISOString() })
    const justOver = MU_LIVERPOOL({ dateTimeUtc: new Date(NOW + minutes(60) + 1).toISOString() })
    expect(selectHero([live, exactly], MU_FAN, NOW).hero?.id).toBe('mu-liverpool')
    expect(selectHero([live, justOver], MU_FAN, NOW).hero?.id).toBe('tromso-molde')
  })
})

describe('selectHero — inside the watchable-now pool, relevance decides', () => {
  // TEST 2, and the spec's headline scenario (SCENARIO A).
  it('picks Manchester United - Liverpool at 21:00 over a live Tromsø - Molde at 20:40', () => {
    const selection = selectHero([TROMSO_MOLDE(), MU_LIVERPOOL(), BRIGHTON_FULHAM()], MU_FAN, NOW)
    expect(selection.hero?.id).toBe('mu-liverpool')
    expect(selection.isWatchableNow).toBe(true)
  })

  // The other half of the same rule: live is NOT automatically beaten. A
  // merely-adequate upcoming match does not displace a live one.
  it('keeps the live match as hero when the starting-soon alternative is unremarkable', () => {
    const dull = event('dull', {
      leagueId: 'small_league',
      leagueTier: 3,
      homeTeamProminence: 0.2,
      awayTeamProminence: 0.2,
      dateTimeUtc: at(55),
    })
    const live = TROMSO_MOLDE()
    expect(selectHero([live, dull], NO_PREFERENCES, NOW).hero?.id).toBe('tromso-molde')
  })

  // TEST 6 — explicit choice beats generic popularity.
  it('puts a followed club ahead of a much bigger fixture at the same kickoff', () => {
    const brightonFan = buildPersonalizationContext({ favoriteTeamIds: ['team_brighton'] })
    const brighton = BRIGHTON_NEWCASTLE({ dateTimeUtc: clock('21:00') })
    const united = MU_LIVERPOOL()
    expect(selectHero([brighton, united], brightonFan, NOW).hero?.id).toBe('brighton-newcastle')
  })

  // TEST 7 — the same two matches, for someone who follows the league but no
  // club. Now prominence and rivalry are the only things talking.
  it('puts the bigger fixture first for a league follower with no club of their own', () => {
    const brighton = BRIGHTON_NEWCASTLE({ dateTimeUtc: clock('21:00') })
    const united = MU_LIVERPOOL()
    expect(selectHero([brighton, united], PL_FAN, NOW).hero?.id).toBe('mu-liverpool')
  })
})

// TEST 5 / SCENARIO B.
describe('selectHero — nothing watchable yet, so time leads', () => {
  const seventeen = Date.parse('2026-08-26T17:00:00Z')

  it('picks the earliest kickoff, not the biggest match of the evening', () => {
    const early = BRIGHTON_NEWCASTLE({ dateTimeUtc: clock('18:30') })
    const huge = MU_LIVERPOOL({ dateTimeUtc: clock('21:30') })
    const selection = selectHero([early, huge], MU_FAN, seventeen)
    expect(selection.hero?.id).toBe('brighton-newcastle')
    // Shown for awareness, not as something to start watching.
    expect(selection.isWatchableNow).toBe(false)
  })

  it('personalizes WITHIN the earliest slot rather than across the evening', () => {
    const smallAt1830 = event('small-1830', { leagueId: 'small', leagueTier: 3, dateTimeUtc: clock('18:30') })
    const bigAt1830 = MU_LIVERPOOL({ dateTimeUtc: clock('18:30') })
    const hugeAt2130 = MU_LIVERPOOL({ id: 'later-huge', dateTimeUtc: clock('21:30') })
    expect(selectHero([smallAt1830, bigAt1830, hugeAt2130], MU_FAN, seventeen).hero?.id).toBe('mu-liverpool')
  })

  it('treats near-simultaneous kickoffs as one slot, within the stated tolerance', () => {
    const first = event('first', { leagueId: 'small', leagueTier: 3, dateTimeUtc: clock('18:30') })
    const fourMinutesLater = MU_LIVERPOOL({ dateTimeUtc: new Date(Date.parse(clock('18:30')) + minutes(4)).toISOString() })
    expect(SAME_SLOT_TOLERANCE_MS).toBe(minutes(5))
    expect(selectHero([first, fourMinutesLater], MU_FAN, seventeen).hero?.id).toBe('mu-liverpool')
  })

  it('returns no hero at all when there is genuinely nothing on', () => {
    expect(selectHero([], MU_FAN, NOW)).toEqual({ hero: null, isWatchableNow: false })
  })

  it('ignores finished matches when falling back to the next kickoff', () => {
    const finished = event('finished', { dateTimeUtc: clock('14:00') })
    const next = BRIGHTON_NEWCASTLE({ dateTimeUtc: clock('18:30') })
    expect(selectHero([finished, next], NO_PREFERENCES, seventeen).hero?.id).toBe('brighton-newcastle')
  })
})

// TEST 15 — "Watch Now" must never lead nowhere.
describe('selectHero — playability', () => {
  it('prefers a playable candidate over a more relevant one with no stream', () => {
    const unplayable = MU_LIVERPOOL()
    const playable = BRIGHTON_FULHAM()
    const selection = selectHero([unplayable, playable], MU_FAN, NOW, (e) => e.id === 'brighton-fulham')
    expect(selection.hero?.id).toBe('brighton-fulham')
    expect(selection.isWatchableNow).toBe(true)
  })

  it('still features the most relevant event, as a preview, when nothing is playable', () => {
    const selection = selectHero([TROMSO_MOLDE(), MU_LIVERPOOL()], MU_FAN, NOW, () => false)
    expect(selection.hero?.id).toBe('mu-liverpool')
    // The CTA has to say "Event Preview" — there is no stream behind it.
    expect(selection.isWatchableNow).toBe(false)
  })

  it('does not demand playability of a time-led fallback hero, which is a preview anyway', () => {
    const seventeen = Date.parse('2026-08-26T17:00:00Z')
    const next = BRIGHTON_NEWCASTLE({ dateTimeUtc: clock('18:30') })
    const selection = selectHero([next], NO_PREFERENCES, seventeen, () => false)
    expect(selection.hero?.id).toBe('brighton-newcastle')
    expect(selection.isWatchableNow).toBe(false)
  })
})

// ===========================================================================
// FEED — chronology first
// ===========================================================================

describe('rankHomeFeed — groups are chronological and absolute', () => {
  // TEST 10.
  it('orders live, then starting soon, then later — whatever the scores say', () => {
    const live = TROMSO_MOLDE()
    const soon = MU_LIVERPOOL()
    const later = MU_LIVERPOOL({ id: 'later-huge', dateTimeUtc: at(120) })
    const feed = rankHomeFeed([later, soon, live], MU_FAN, NOW)
    expect(feed.map((item) => item.event.id)).toEqual(['tromso-molde', 'mu-liverpool', 'later-huge'])
    expect(feed.map((item) => item.group)).toEqual(['live', 'starting-soon', 'coming-up'])
  })

  // TEST 19.
  it('keeps an earlier kickoff ahead of a later one with a far larger score', () => {
    const seventeen = Date.parse('2026-08-26T17:00:00Z')
    const early = event('early', { leagueId: 'small', leagueTier: 3, dateTimeUtc: clock('18:30') })
    const huge = MU_LIVERPOOL({ dateTimeUtc: clock('21:30') })
    const feed = rankHomeFeed([huge, early], MU_FAN, seventeen)
    expect(feed.map((item) => item.event.id)).toEqual(['early', 'mu-liverpool'])
  })

  // TEST 18.
  it('personalizes inside one kickoff slot', () => {
    const feed = rankHomeFeed([BRIGHTON_FULHAM(), MU_LIVERPOOL()], MU_FAN, NOW)
    expect(feed.map((item) => item.event.id)).toEqual(['mu-liverpool', 'brighton-fulham'])
  })

  it('reverses that same slot for a viewer who follows Brighton instead', () => {
    const brightonFan = buildPersonalizationContext({ favoriteTeamIds: ['team_brighton'] })
    const feed = rankHomeFeed([MU_LIVERPOOL(), BRIGHTON_FULHAM()], brightonFan, NOW)
    expect(feed.map((item) => item.event.id)).toEqual(['brighton-fulham', 'mu-liverpool'])
  })

  it('orders live events by relevance, since a live match has no useful kickoff time left', () => {
    const dullLive = event('dull-live', { isLive: true, leagueId: 'small', leagueTier: 3, dateTimeUtc: at(-70) })
    const bigLive = MU_LIVERPOOL({ isLive: true, dateTimeUtc: at(-10) })
    const feed = rankHomeFeed([dullLive, bigLive], MU_FAN, NOW)
    expect(feed.map((item) => item.event.id)).toEqual(['mu-liverpool', 'dull-live'])
  })

  it('leaves out finished and undated events — a "what is on" row cannot show either', () => {
    const feed = rankHomeFeed(
      [event('finished', { dateTimeUtc: at(-300) }), event('undated', { dateTimeUtc: null }), TROMSO_MOLDE()],
      NO_PREFERENCES,
      NOW,
    )
    expect(feed.map((item) => item.event.id)).toEqual(['tromso-molde'])
  })

  it('de-duplicates by id — the candidate pool is assembled from overlapping fetches', () => {
    const feed = rankHomeFeed([TROMSO_MOLDE(), TROMSO_MOLDE()], NO_PREFERENCES, NOW)
    expect(feed).toHaveLength(1)
  })

  it('is deterministic for two events that tie on everything', () => {
    const a = event('a', { dateTimeUtc: at(30) })
    const b = event('b', { dateTimeUtc: at(30) })
    const first = rankHomeFeed([a, b], NO_PREFERENCES, NOW).map((i) => i.event.id)
    const second = rankHomeFeed([b, a], NO_PREFERENCES, NOW).map((i) => i.event.id)
    expect(first).toEqual(second)
  })
})

// TEST 11 — the single most important property of this design: the hero and
// the feed disagree ON PURPOSE, and neither is wrong.
describe('the hero and the feed answer different questions', () => {
  it('features a starting-soon match while the feed still leads with the live one', () => {
    const events = [TROMSO_MOLDE(), MU_LIVERPOOL(), BRIGHTON_FULHAM()]
    const hero = selectHero(events, MU_FAN, NOW)
    const feed = rankHomeFeed(events, MU_FAN, NOW)

    expect(hero.hero?.id).toBe('mu-liverpool')
    expect(feed.map((item) => item.event.id)).toEqual(['tromso-molde', 'mu-liverpool', 'brighton-fulham'])
    expect(feed.map((item) => item.group)).toEqual(['live', 'starting-soon', 'starting-soon'])
    // And the hero is still IN the feed — it is not hidden from the row just
    // because it is featured above it.
    expect(feed.some((item) => item.event.id === hero.hero?.id)).toBe(true)
  })
})

// TEST 20 — F1 has no teams, no prominence and no broadcast data, and must
// keep working anyway.
describe('non-football events keep working', () => {
  const race = (overrides: Partial<SportEvent> = {}) =>
    event('f1-race', {
      sportKey: 'f1',
      sportLabel: 'F1',
      league: 'Formula 1',
      leagueId: '4370',
      leagueTier: undefined,
      title: 'Italian Grand Prix',
      homeTeam: undefined,
      awayTeam: undefined,
      ...overrides,
    })

  it('ranks a race with no team data at all, without crashing or scoring NaN', () => {
    const feed = rankHomeFeed([race({ dateTimeUtc: at(30) })], NO_PREFERENCES, NOW)
    expect(feed.map((item) => item.event.id)).toEqual(['f1-race'])
    expect(feed[0].group).toBe('starting-soon')
  })

  it('lets a race become the hero when it is the only thing on', () => {
    expect(selectHero([race({ isLive: true })], MU_FAN, NOW).hero?.id).toBe('f1-race')
  })

  it('applies the same time rules to a race as to a match', () => {
    expect(getWatchableNowCandidates([race({ dateTimeUtc: at(90) })], NOW)).toHaveLength(0)
    expect(getWatchableNowCandidates([race({ dateTimeUtc: at(45) })], NOW)).toHaveLength(1)
  })

  it('never invents a favorite-team match for a single-entrant event', () => {
    const anyTeamFan = buildPersonalizationContext({ favoriteTeamIds: ['team_manutd', 'team_brighton'] })
    const feed = rankHomeFeed([race({ dateTimeUtc: at(20) }), MU_LIVERPOOL()], anyTeamFan, NOW)
    // The followed club's match outranks the race — but the race is still
    // there, ranked, not dropped.
    expect(feed.map((item) => item.event.id)).toEqual(['mu-liverpool', 'f1-race'])
  })
})

// SCENARIO C — the domestic-league relationship, at the level where it
// changes what the viewer sees. Eliteserien is followed; the Champions
// League is not, and neither is Bodø/Glimt.
describe('a followed league reaching its clubs European nights', () => {
  const eliteserienFan = buildPersonalizationContext({ favoriteCompetitionIds: ['norway_eliteserien'] })
  const glimtInEurope = event('glimt-benfica', {
    title: 'Bodø/Glimt vs Benfica',
    league: 'UEFA Champions League',
    leagueId: 'football_champions_league',
    leagueTier: 1,
    homeTeamId: 'team_glimt',
    awayTeamId: 'team_benfica',
    homeDomesticCompetitionId: 'norway_eliteserien',
    awayDomesticCompetitionId: 'portugal_primeira',
    homeTeamProminence: 0.4,
    awayTeamProminence: 0.7,
    dateTimeUtc: at(30),
  })
  const unrelated = event('unrelated', {
    league: 'UEFA Champions League',
    leagueId: 'football_champions_league',
    leagueTier: 1,
    homeTeamId: 'team_x',
    awayTeamId: 'team_y',
    homeDomesticCompetitionId: 'spain_la_liga',
    awayDomesticCompetitionId: 'germany_bundesliga',
    homeTeamProminence: 0.4,
    awayTeamProminence: 0.7,
    dateTimeUtc: at(30),
  })

  it('lifts the fixture with a Norwegian club above an identical one without', () => {
    expect(rankHomeFeed([unrelated, glimtInEurope], eliteserienFan, NOW).map((i) => i.event.id)).toEqual([
      'glimt-benfica',
      'unrelated',
    ])
  })

  it('makes it the hero over an otherwise equal Champions League tie', () => {
    expect(selectHero([unrelated, glimtInEurope], eliteserienFan, NOW).hero?.id).toBe('glimt-benfica')
  })

  // For a Premier League follower the two fixtures are genuinely equivalent
  // — asserted as equal SCORES rather than as a particular order, because
  // the order between two exact ties is only the id tiebreak talking.
  it('gives no boost at all to someone who follows a different league', () => {
    expect(scoreFeedCandidate(glimtInEurope, PL_FAN)).toBe(scoreFeedCandidate(unrelated, PL_FAN))
  })

  it('goes further still once the club itself is followed', () => {
    const glimtFan = buildPersonalizationContext({ favoriteTeamIds: ['team_glimt'] })
    const bigger = MU_LIVERPOOL({ dateTimeUtc: at(30) })
    expect(selectHero([bigger, glimtInEurope], glimtFan, NOW).hero?.id).toBe('glimt-benfica')
  })
})

// ===========================================================================
// DIVERSITY
// ===========================================================================

describe('applyDiversity', () => {
  const sameSlot = (id: string, leagueId: string, prominence: number) =>
    event(id, { leagueId, homeTeamProminence: prominence, awayTeamProminence: prominence, dateTimeUtc: at(30) })

  it('breaks up a long single-competition run when a comparable alternative exists', () => {
    const ordered = [
      sameSlot('pl-1', 'football_premier_league', 0.6),
      sameSlot('pl-2', 'football_premier_league', 0.59),
      sameSlot('pl-3', 'football_premier_league', 0.58),
      sameSlot('sa-1', 'italy_serie_a', 0.57),
    ]
    const result = applyDiversity(ordered, NO_PREFERENCES).map((e) => e.id)
    expect(result[0]).toBe('pl-1')
    expect(result[2]).toBe('sa-1')
  })

  it('never moves the top result', () => {
    const ordered = [
      sameSlot('pl-1', 'football_premier_league', 0.9),
      sameSlot('pl-2', 'football_premier_league', 0.6),
      sameSlot('pl-3', 'football_premier_league', 0.59),
      sameSlot('sa-1', 'italy_serie_a', 0.58),
    ]
    expect(applyDiversity(ordered, NO_PREFERENCES)[0].id).toBe('pl-1')
  })

  it('leaves a genuinely dominant run alone — that is the right answer, not a bug', () => {
    const ordered = [
      sameSlot('pl-1', 'football_premier_league', 1),
      sameSlot('pl-2', 'football_premier_league', 1),
      sameSlot('pl-3', 'football_premier_league', 1),
      sameSlot('tiny', 'tiny_league', 0),
    ]
    expect(applyDiversity(ordered, NO_PREFERENCES).map((e) => e.id)).toEqual(['pl-1', 'pl-2', 'pl-3', 'tiny'])
  })

  it('keeps every event it was given, in the same multiset', () => {
    const ordered = [
      sameSlot('a', 'l1', 0.5),
      sameSlot('b', 'l1', 0.5),
      sameSlot('c', 'l1', 0.5),
      sameSlot('d', 'l2', 0.5),
    ]
    expect(applyDiversity(ordered, NO_PREFERENCES).map((e) => e.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('never reorders across a chronological group — the feed applies it per group', () => {
    const live = TROMSO_MOLDE()
    const soonA = BRIGHTON_FULHAM()
    const soonB = MU_LIVERPOOL()
    const feed = rankHomeFeed([live, soonA, soonB], NO_PREFERENCES, NOW)
    expect(feed[0].group).toBe('live')
    expect(feed.slice(1).every((item) => item.group === 'starting-soon')).toBe(true)
  })
})

// ===========================================================================
// DIAGNOSTICS
// ===========================================================================

describe('describeRanking', () => {
  it('itemizes every term, and the totals agree with the order', () => {
    const rows = describeRanking([TROMSO_MOLDE(), MU_LIVERPOOL()], MU_FAN, NOW)
    expect(rows[0].id).toBe('mu-liverpool')
    expect(rows[0].breakdown.favoriteTeam).toBeGreaterThan(0)
    expect(rows[0].breakdown.total).toBeGreaterThan(rows[1].breakdown.total)
    expect(rows[1].timing).toBe('live')
  })
})

// SCENARIO D — a brand-new install that has answered nothing.
describe('a viewer with no preferences at all', () => {
  it('still gets a hero and a populated feed, ranked on time and objective importance', () => {
    const events = [TROMSO_MOLDE(), MU_LIVERPOOL(), BRIGHTON_FULHAM()]
    const feed = rankHomeFeed(events, NO_PREFERENCES, NOW)
    expect(feed).toHaveLength(3)
    expect(selectHero(events, NO_PREFERENCES, NOW).hero).not.toBeNull()
  })

  it('surfaces a globally huge match it was never told to care about', () => {
    const clFinal = event('cl-final', {
      league: 'UEFA Champions League',
      leagueId: 'football_champions_league',
      leagueTier: 1,
      round: 'Final',
      homeTeamProminence: 0.98,
      awayTeamProminence: 0.96,
      rivalryImportance: 0.6,
      dateTimeUtc: at(30),
    })
    const ordinary = event('ordinary', { leagueId: 'small', leagueTier: 3, dateTimeUtc: at(30) })
    // Even for someone who follows only the Premier League — favorites are a
    // signal, never a filter.
    expect(selectHero([ordinary, clFinal], PL_FAN, NOW).hero?.id).toBe('cl-final')
  })
})

// ===========================================================================
// HERO — the second gate: objective broadcast availability
// ===========================================================================
//
// Structural, exactly like the 60-minute wall above it: an event the backend
// does not expect to be televised is not in the pool, so no score can lift
// it in. These tests are deliberately written against the SAME scenario as
// the time-wall tests, so what changes between them is only the verdict.
describe('selectHero — the broadcast wall', () => {
  // TEST 16 — the accepted hero behaviour, restated with explicit positive
  // verdicts so the next test isolates one variable.
  it('still lets a 20-minutes-away Manchester United - Liverpool beat a mediocre live match', () => {
    const live = TROMSO_MOLDE({ broadcastAvailability: 'CONFIRMED_BROADCAST' })
    const big = MU_LIVERPOOL({ broadcastAvailability: 'CONFIRMED_BROADCAST' })
    expect(selectHero([live, big], MU_FAN, NOW).hero?.id).toBe('mu-liverpool')
  })

  // TEST 17 — the same fixture, the same favorite club, the same +100. It
  // cannot buy its way past a verdict; the mediocre live match wins.
  it('cannot make that same fixture the hero once it is LIKELY_NOT_BROADCAST', () => {
    const live = TROMSO_MOLDE({ broadcastAvailability: 'CONFIRMED_BROADCAST' })
    const big = MU_LIVERPOOL({ broadcastAvailability: 'LIKELY_NOT_BROADCAST' })
    expect(selectHero([live, big], MU_FAN, NOW).hero?.id).toBe('tromso-molde')
  })

  it('cannot make it the hero when it is CONFIRMED_NOT_BROADCAST either', () => {
    const live = TROMSO_MOLDE({ broadcastAvailability: 'CONFIRMED_BROADCAST' })
    const big = MU_LIVERPOOL({ broadcastAvailability: 'CONFIRMED_NOT_BROADCAST' })
    expect(selectHero([live, big], MU_FAN, NOW).hero?.id).toBe('tromso-molde')
  })

  it('leaves the hero empty rather than featuring an untelevised match when nothing else is on', () => {
    const only = MU_LIVERPOOL({ broadcastAvailability: 'CONFIRMED_NOT_BROADCAST' })
    expect(selectHero([only], MU_FAN, NOW)).toEqual({ hero: null, isWatchableNow: false })
  })

  // UNKNOWN is not a negative — this is the case that keeps the whole feature
  // safe to ship before the backend does.
  it('happily makes an UNKNOWN event the hero, and an event with no verdict at all', () => {
    expect(selectHero([MU_LIVERPOOL({ broadcastAvailability: 'UNKNOWN' })], MU_FAN, NOW).hero?.id).toBe('mu-liverpool')
    expect(selectHero([MU_LIVERPOOL()], MU_FAN, NOW).hero?.id).toBe('mu-liverpool')
  })

  // TEST 18 — the time wall is untouched by any of this. Both events carry
  // the same positive verdict, so only the clock can decide.
  it('leaves the 60/61-minute boundary exactly where it was', () => {
    const live = TROMSO_MOLDE({ broadcastAvailability: 'CONFIRMED_BROADCAST' })
    const exactly = MU_LIVERPOOL({ dateTimeUtc: at(60), broadcastAvailability: 'CONFIRMED_BROADCAST' })
    const justOver = MU_LIVERPOOL({
      dateTimeUtc: new Date(NOW + minutes(60) + 1).toISOString(),
      broadcastAvailability: 'CONFIRMED_BROADCAST',
    })
    expect(selectHero([live, exactly], MU_FAN, NOW).hero?.id).toBe('mu-liverpool')
    expect(selectHero([live, justOver], MU_FAN, NOW).hero?.id).toBe('tromso-molde')
  })

  // The gate has to cover BOTH hero paths. This is the "nothing is watchable
  // yet, so the earliest kickoff leads" fallback (which Home's density
  // expansion can now reach with a later day's fixture — see
  // homeFeedDensity.ts): a small untelevised cup tie must not become the hero
  // purely by being chronologically next.
  it('does not let an untelevised fixture win the earliest-kickoff fallback', () => {
    const seventeen = Date.parse('2026-08-26T17:00:00Z')
    const smallCupTie = event('bootle-northwich', {
      league: 'FA Cup',
      leagueId: 'england_fa_cup',
      dateTimeUtc: clock('19:45'),
      broadcastAvailability: 'LIKELY_NOT_BROADCAST',
    })
    const later = MU_LIVERPOOL({ broadcastAvailability: 'CONFIRMED_BROADCAST' })
    expect(selectHero([smallCupTie, later], NO_PREFERENCES, seventeen).hero?.id).toBe('mu-liverpool')
  })

  it('still lets an UNKNOWN fixture win that same fallback', () => {
    const seventeen = Date.parse('2026-08-26T17:00:00Z')
    const early = event('bootle-northwich', { dateTimeUtc: clock('19:45'), broadcastAvailability: 'UNKNOWN' })
    const later = MU_LIVERPOOL({ broadcastAvailability: 'CONFIRMED_BROADCAST' })
    expect(selectHero([early, later], NO_PREFERENCES, seventeen).hero?.id).toBe('bootle-northwich')
  })
})

// The feed's ORDER is a chronological statement and must stay one. Broadcast
// availability decides what reaches rankHomeFeed (in useHomeFeed), never how
// what reaches it is sorted.
describe('rankHomeFeed — broadcast availability is not a ranking input', () => {
  it('does not reorder live / starting soon / coming up by availability', () => {
    const live = TROMSO_MOLDE({ broadcastAvailability: 'LIKELY_NOT_BROADCAST' })
    const soon = MU_LIVERPOOL({ broadcastAvailability: 'CONFIRMED_BROADCAST' })
    const later = BRIGHTON_NEWCASTLE({ dateTimeUtc: at(180), broadcastAvailability: 'CONFIRMED_BROADCAST' })
    const feed = rankHomeFeed([later, soon, live], MU_FAN, NOW)
    expect(feed.map((i) => i.event.id)).toEqual(['tromso-molde', 'mu-liverpool', 'brighton-newcastle'])
    expect(feed.map((i) => i.group)).toEqual(['live', 'starting-soon', 'coming-up'])
  })

  it('scores an event identically no matter what its availability says', () => {
    const base = MU_LIVERPOOL({ broadcastAvailability: 'CONFIRMED_BROADCAST' })
    const negative = MU_LIVERPOOL({ broadcastAvailability: 'CONFIRMED_NOT_BROADCAST' })
    expect(scoreFeedCandidate(negative, MU_FAN)).toBe(scoreFeedCandidate(base, MU_FAN))
  })
})

describe('describeRanking — broadcast diagnostics', () => {
  it('reports each event’s verdict alongside its score breakdown', () => {
    const rows = describeRanking(
      [TROMSO_MOLDE({ broadcastAvailability: 'LIKELY_NOT_BROADCAST' }), MU_LIVERPOOL()],
      MU_FAN,
      NOW,
    )
    const byId = new Map(rows.map((row) => [row.id, row]))
    expect(byId.get('tromso-molde')?.broadcastAvailability).toBe('LIKELY_NOT_BROADCAST')
    // Absent on the event -> reported as UNKNOWN, never as undefined.
    expect(byId.get('mu-liverpool')?.broadcastAvailability).toBe('UNKNOWN')
  })
})
