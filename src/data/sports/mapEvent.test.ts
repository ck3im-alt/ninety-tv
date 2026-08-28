import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { mapEvent, mapNinetyEvent } from './mapEvent'
import { EMPTY_PERSONALIZATION_CONTEXT, eventTiming } from './homePersonalization'
import { rankHomeFeed } from './homeRanking'
import type { RawSportsDbEvent } from './theSportsDbClient'
import type { NinetyEvent, NinetyBroadcast } from './ninetyApiClient'
import type { LeagueDef } from './leagues'

const league: LeagueDef = {
  id: 'premier-league',
  sportKey: 'football',
  sportLabel: 'Premier League',
  tsdbSport: 'Soccer',
  name: 'Premier League',
}

function broadcast(overrides: Partial<NinetyBroadcast>): NinetyBroadcast {
  return {
    logical_channel_id: 'lc1',
    name: 'Test Channel',
    country: 'GB',
    confidence: 1,
    classification: 'CONFIRMED',
    broadcast_type: 'LINEAR',
    ...overrides,
  }
}

function event(broadcasts: NinetyBroadcast[]): NinetyEvent {
  return {
    id: 'evt1',
    start_time_utc: '2026-08-18T18:00:00Z',
    status: null,
    home_score: null,
    away_score: null,
    round_code: null,
    competition_id: null,
    competition_name: 'Premier League',
    home_team_name: 'Home FC',
    home_team_logo: null,
    home_team_form: null,
    away_team_name: 'Away FC',
    away_team_logo: null,
    away_team_form: null,
    venue_name: null,
    broadcasts,
  }
}

describe('mapNinetyEvent broadcasts filtering', () => {
  it('keeps LINEAR broadcasts', () => {
    const result = mapNinetyEvent(event([broadcast({ name: 'Sky Sports', broadcast_type: 'LINEAR' })]), league)
    expect(result.broadcasts?.map((b) => b.name)).toEqual(['Sky Sports'])
  })

  // BOTH means the logical channel is available as linear AND streaming —
  // it must still count as a valid linear-playlist match, not be dropped.
  it('keeps BOTH broadcasts', () => {
    const result = mapNinetyEvent(event([broadcast({ name: 'TV3 Plus', broadcast_type: 'BOTH' })]), league)
    expect(result.broadcasts?.map((b) => b.name)).toEqual(['TV3 Plus'])
  })

  it('drops STREAMING-only broadcasts', () => {
    const result = mapNinetyEvent(event([broadcast({ name: 'Viaplay', broadcast_type: 'STREAMING' })]), league)
    expect(result.broadcasts).toEqual([])
  })

  it('drops UNKNOWN broadcasts', () => {
    const result = mapNinetyEvent(event([broadcast({ name: 'Mystery Channel', broadcast_type: 'UNKNOWN' })]), league)
    expect(result.broadcasts).toEqual([])
  })

  it('keeps LINEAR and BOTH while dropping STREAMING and UNKNOWN in a mixed set', () => {
    const result = mapNinetyEvent(
      event([
        broadcast({ name: 'Sky Sports', broadcast_type: 'LINEAR' }),
        broadcast({ name: 'TV3 Plus', broadcast_type: 'BOTH' }),
        broadcast({ name: 'Viaplay', broadcast_type: 'STREAMING' }),
        broadcast({ name: 'Mystery Channel', broadcast_type: 'UNKNOWN' }),
      ]),
      league,
    )
    expect(result.broadcasts?.map((b) => b.name).sort()).toEqual(['Sky Sports', 'TV3 Plus'])
  })
})

describe('mapNinetyEvent venue mapping', () => {
  it('maps venue_name onto SportEvent.venue', () => {
    const result = mapNinetyEvent({ ...event([]), venue_name: 'Estadio de Vallecas' }, league)
    expect(result.venue).toBe('Estadio de Vallecas')
  })

  it('leaves venue undefined (not a placeholder) when venue_name is null', () => {
    const result = mapNinetyEvent(event([]), league)
    expect(result.venue).toBeUndefined()
  })
})

describe('mapNinetyEvent form mapping', () => {
  it('maps home_team_form/away_team_form onto homeForm/awayForm', () => {
    const result = mapNinetyEvent(
      { ...event([]), home_team_form: ['W', 'W', 'L', 'D', 'L'], away_team_form: ['L', 'D', 'W', 'L', 'L'] },
      league,
    )
    expect(result.homeForm).toEqual(['W', 'W', 'L', 'D', 'L'])
    expect(result.awayForm).toEqual(['L', 'D', 'W', 'L', 'L'])
  })

  it('leaves form undefined (not a placeholder) when ninety-api has no form yet', () => {
    const result = mapNinetyEvent(event([]), league)
    expect(result.homeForm).toBeUndefined()
    expect(result.awayForm).toBeUndefined()
  })

  it('does not pad a short form array', () => {
    const result = mapNinetyEvent({ ...event([]), home_team_form: ['W', 'D', 'L'] }, league)
    expect(result.homeForm).toEqual(['W', 'D', 'L'])
  })
})

describe('mapNinetyEvent live status/score mapping (ninety-api liveScoreScheduler)', () => {
  // CHANGED 2026-08-27 (was `toBeUndefined()`): isLiveHeuristic is now a
  // plain boolean off effectiveLiveState rather than an undefined/boolean
  // hybrid, so a provider-confirmed live event says `false` — "this is not
  // a guess" — instead of staying silent. Every consumer reads it as
  // `!event.isLiveHeuristic` (homeRowItems, EventHeader, MultiviewPane), so
  // the rendered result is identical; the assertion moves because the value
  // is now stated rather than absent.
  it('maps status "live" to isLive: true, isLiveHeuristic: false (real data, not a guess)', () => {
    const result = mapNinetyEvent({ ...event([]), status: 'live', home_score: 1, away_score: 0 }, league)
    expect(result.isLive).toBe(true)
    expect(result.isLiveHeuristic).toBe(false)
    expect(result.status).toBe('live')
  })

  it('maps status "halftime" to isLive: true and a synthetic "HT" liveClock', () => {
    const result = mapNinetyEvent({ ...event([]), status: 'halftime', home_score: 1, away_score: 0 }, league)
    expect(result.isLive).toBe(true)
    expect(result.liveClock).toBe('HT')
  })

  it('maps status "scheduled" to isLive: false with no score rendered', () => {
    const result = mapNinetyEvent({ ...event([]), status: 'scheduled' }, league)
    expect(result.isLive).toBe(false)
    expect(result.homeScore).toBeUndefined()
    expect(result.awayScore).toBeUndefined()
  })

  it('maps status "complete" to isLive: false while still carrying the final score', () => {
    const result = mapNinetyEvent({ ...event([]), status: 'complete', home_score: 2, away_score: 1 }, league)
    expect(result.isLive).toBe(false)
    expect(result.homeScore).toBe('2')
    expect(result.awayScore).toBe('1')
  })

  it('preserves a real 0-0 score rather than treating it as absent (falsy-but-real score bug)', () => {
    const result = mapNinetyEvent({ ...event([]), status: 'live', home_score: 0, away_score: 0 }, league)
    expect(result.homeScore).toBe('0')
    expect(result.awayScore).toBe('0')
  })

  it('updates from 0-0 to 1-0 across two separate mappings of the same event id', () => {
    const first = mapNinetyEvent({ ...event([]), status: 'live', home_score: 0, away_score: 0 }, league)
    const second = mapNinetyEvent({ ...event([]), status: 'live', home_score: 1, away_score: 0 }, league)
    expect(first.homeScore).toBe('0')
    expect(second.homeScore).toBe('1')
    expect(first.id).toBe(second.id)
  })

  it('falls back to the time-window heuristic when status is null (e.g. a legacy/untracked event)', () => {
    // start_time_utc far in the past -> heuristic says not live regardless
    // of real time, proving the heuristic path (not the real-status path)
    // is what ran.
    const result = mapNinetyEvent({ ...event([]), status: null, start_time_utc: '2020-01-01T00:00:00Z' }, league)
    expect(result.isLive).toBe(false)
    expect(result.isLiveHeuristic).toBe(false)
  })

  it('never shows a score for a heuristic-live (null-status) event', () => {
    const result = mapNinetyEvent({ ...event([]), status: null, home_score: 5, away_score: 5 }, league)
    // home_score/away_score arrive from upstream regardless, but the UI
    // gate is isLiveHeuristic -- still exercised here for completeness:
    // status stays undefined so nothing downstream can mistake this for a
    // real backend-confirmed state.
    expect(result.status).toBeUndefined()
  })
})

// ===========================================================================
// THE PROVIDER-STATUS-LAG REGRESSION SUITE
// ===========================================================================
//
// The acceptance case, in full: Lillestrøm - Egnatia Rrogozhinë (Europa
// League), 19:00 CEST kickoff, actually being played, Ninety holding the
// event, the kickoff time and two matching VGTV streams — but
// footballdata.io still reporting `status: scheduled` and omitting the
// fixture from GET /fixtures/live entirely. Before this suite existed the
// match fell to eventTiming 'past', feedGroupFor returned null, and it
// vanished from Home's "Live now & coming up" while on TV.
//
// The rule these pin: a provider FAILING TO UPDATE is inferred over; a
// provider that has actually spoken is never contradicted. Wall clock is
// frozen because mapNinetyEvent reads Date.now() itself — the window edges
// are asserted to the minute, which real time cannot do reliably.
describe('mapNinetyEvent effective live state vs provider status', () => {
  const NOW = Date.parse('2026-08-27T19:45:00Z')
  const at = (offsetMinutes: number) => new Date(NOW + offsetMinutes * 60_000).toISOString()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const scheduledAt = (offsetMinutes: number, status: string | null = 'scheduled') =>
    mapNinetyEvent({ ...event([]), status, start_time_utc: at(offsetMinutes) }, league)

  // 1.
  it('leaves a scheduled fixture 30 minutes BEFORE kickoff alone — upcoming, not live', () => {
    const result = scheduledAt(30)
    expect(result.isLive).toBe(false)
    expect(result.isLiveHeuristic).toBe(false)
    expect(eventTiming(result, NOW)).toBe('starting-soon')
  })

  // 2. THE BUG.
  it('treats a scheduled fixture 5 minutes AFTER kickoff as live, and marks it as inferred', () => {
    const result = scheduledAt(-5)
    expect(result.isLive).toBe(true)
    expect(result.isLiveHeuristic).toBe(true)
    expect(eventTiming(result, NOW)).toBe('live')
  })

  // 3. Where the old 90-minute window used to drop the match on the floor.
  it('keeps a scheduled fixture live 90 minutes after kickoff — stoppage and half-time are not "over"', () => {
    const result = scheduledAt(-90)
    expect(result.isLive).toBe(true)
    expect(result.isLiveHeuristic).toBe(true)
  })

  // 4. Extra time and penalties in a knockout tie.
  it('keeps a scheduled fixture live 140 minutes after kickoff — extra time is still football', () => {
    const result = scheduledAt(-140)
    expect(result.isLive).toBe(true)
    expect(result.isLiveHeuristic).toBe(true)
  })

  // 5. The window has to end somewhere, or yesterday stays on Home forever.
  it('stops inferring live once the fixture is outside football\'s in-play window', () => {
    expect(scheduledAt(-150).isLive).toBe(true)
    expect(scheduledAt(-151).isLive).toBe(false)
    expect(eventTiming(scheduledAt(-151), NOW)).toBe('past')
  })

  // 6. A real signal is never relabelled as a guess.
  it('reports a provider-confirmed live fixture as live and NOT heuristic', () => {
    const result = mapNinetyEvent({ ...event([]), status: 'live', start_time_utc: at(-5) }, league)
    expect(result.isLive).toBe(true)
    expect(result.isLiveHeuristic).toBe(false)
  })

  // 7. The pre-existing null-status fallback, unchanged.
  it('still infers live from a null status after kickoff (pre-live-tracking backend)', () => {
    const result = scheduledAt(-5, null)
    expect(result.isLive).toBe(true)
    expect(result.isLiveHeuristic).toBe(true)
    // ...and the absent status stays absent. Inference never fabricates one.
    expect(result.status).toBeUndefined()
  })

  // 8-10. TERMINAL STATUSES. The provider has spoken; the clock does not
  // get a vote. `complete` is ninety-api's spelling of finished (see its
  // sports/eventStatus.ts — deliberately not "finished").
  it.each(['complete', 'cancelled', 'postponed', 'abandoned'])(
    'never infers live over the explicit status "%s", even just after kickoff',
    (status) => {
      const result = scheduledAt(-5, status)
      expect(result.isLive).toBe(false)
      expect(result.isLiveHeuristic).toBe(false)
      expect(eventTiming(result, NOW)).toBe('past')
    },
  )

  // An allow-list, not a deny-list: a status this build has never heard of
  // is far more likely to be a new abnormal state than a new synonym for
  // "not started", so it blocks inference rather than permitting it.
  it('refuses to infer live over an unrecognized status', () => {
    expect(scheduledAt(-5, 'suspended').isLive).toBe(false)
  })

  // THE POINT OF THE WHOLE DESIGN: the canonical value is never rewritten.
  it('leaves the provider status untouched at "scheduled" while the UI state is live', () => {
    const result = scheduledAt(-5)
    expect(result.status).toBe('scheduled')
    expect(result.isLive).toBe(true)
  })

  // Nothing is invented for an inferred-live match: no clock, no 0-0.
  it('fabricates neither a score nor a match clock for an inferred-live fixture', () => {
    const result = mapNinetyEvent(
      { ...event([]), status: 'scheduled', start_time_utc: at(-5), home_score: null, away_score: null },
      league,
    )
    expect(result.liveClock).toBeUndefined()
    expect(result.homeScore).toBeUndefined()
    expect(result.awayScore).toBeUndefined()
  })

  // ...but a score that GENUINELY exists is still real data and still shown.
  it('still carries a real score through on an inferred-live fixture', () => {
    const result = mapNinetyEvent(
      { ...event([]), status: 'scheduled', start_time_utc: at(-5), home_score: 1, away_score: 0 },
      league,
    )
    expect(result.homeScore).toBe('1')
    expect(result.awayScore).toBe('0')
  })

  // 11. THE HOME REGRESSION, end to end: the exact chain that used to drop
  // the match — eventTiming -> feedGroupFor -> row. Asserted through
  // rankHomeFeed rather than the private feedGroupFor so it pins the
  // behaviour Home actually renders.
  it('places an inferred-live fixture in Home\'s live feed group instead of dropping it', () => {
    const lillestrom = mapNinetyEvent(
      {
        ...event([]),
        id: 'lsk-egnatia',
        status: 'scheduled',
        start_time_utc: at(-45),
        home_team_name: 'Lillestrøm',
        away_team_name: 'Egnatia Rrogozhinë',
        competition_name: 'UEFA Europa League',
      },
      league,
    )
    const feed = rankHomeFeed([lillestrom], EMPTY_PERSONALIZATION_CONTEXT, NOW)
    expect(feed.map((item) => ({ id: item.event.id, group: item.group }))).toEqual([
      { id: 'ninety:lsk-egnatia', group: 'live' },
    ])
  })

  // F1 keeps its own, shorter window — the football number must not leak
  // into a sport whose sessions are nothing like 150 minutes long.
  it('does not apply football\'s window to an F1 practice session', () => {
    const f1League: LeagueDef = { id: 'f1', sportKey: 'f1', sportLabel: 'Formula 1', tsdbSport: 'Motorsport', name: 'F1' }
    const practice = mapNinetyEvent(
      { ...event([]), home_team_name: null, away_team_name: null, competition_name: 'Practice 1', start_time_utc: at(-100) },
      f1League,
    )
    expect(practice.isLive).toBe(false)
  })
})

describe('mapNinetyEvent broadcasts identity preservation', () => {
  it('carries logicalChannelId, confidence, and classification through onto SportEvent.broadcasts', () => {
    const result = mapNinetyEvent(
      event([
        broadcast({
          logical_channel_id: 'lc-sky-sports-main',
          name: 'Sky Sports Main Event',
          country: 'GB',
          confidence: 0.87,
          classification: 'PROBABLE',
          broadcast_type: 'LINEAR',
        }),
      ]),
      league,
    )
    expect(result.broadcasts).toEqual([
      {
        logicalChannelId: 'lc-sky-sports-main',
        name: 'Sky Sports Main Event',
        country: 'GB',
        confidence: 0.87,
        classification: 'PROBABLE',
      },
    ])
  })
})

// Venue text is repaired at the MAPPING boundary (see humanText.ts) rather
// than in any one screen, so every surface reading SportEvent.venue — Match
// View, Home's hero meta line — benefits without knowing about it. The
// repair itself is covered exhaustively in humanText.test.ts; these two only
// prove the mapper actually calls it, on both event pathways.
describe('mapNinetyEvent venue normalization', () => {
  it('repairs mojibake in venue_name', () => {
    const result = mapNinetyEvent({ ...event([]), venue_name: 'Estadio Santiago BernabÃ©u' }, league)
    expect(result.venue).toBe('Estadio Santiago Bernabéu')
  })

  it('leaves an already-correct accented venue name untouched', () => {
    const result = mapNinetyEvent({ ...event([]), venue_name: 'Estadio Santiago Bernabéu' }, league)
    expect(result.venue).toBe('Estadio Santiago Bernabéu')
  })
})

describe('mapEvent (TheSportsDB) venue normalization', () => {
  function tsdbEvent(strVenue: string | null): RawSportsDbEvent {
    return {
      idEvent: 'tsdb1',
      strEvent: 'Home FC vs Away FC',
      strLeague: 'Premier League',
      strHomeTeam: 'Home FC',
      strAwayTeam: 'Away FC',
      strVenue,
    } as RawSportsDbEvent
  }

  it('repairs mojibake in strVenue', () => {
    expect(mapEvent(tsdbEvent('Estadio Santiago BernabÃ©u'), league).venue).toBe('Estadio Santiago Bernabéu')
  })

  it('leaves venue undefined when TheSportsDB has none', () => {
    expect(mapEvent(tsdbEvent(null), league).venue).toBeUndefined()
  })
})

// TEST 14 — the personalization block ninety-api gained on 2026-08-26. The
// TV ships before (and independently of) the backend that sends these, so
// "absent" is the case that has to be right first.
describe('mapNinetyEvent personalization fields', () => {
  const bare = () => event([])

  it('leaves every new field undefined against a backend that does not send them', () => {
    const result = mapNinetyEvent(bare(), league)
    expect(result.homeTeamId).toBeUndefined()
    expect(result.awayTeamId).toBeUndefined()
    expect(result.homeDomesticCompetitionId).toBeUndefined()
    expect(result.awayDomesticCompetitionId).toBeUndefined()
    expect(result.homeTeamProminence).toBeUndefined()
    expect(result.awayTeamProminence).toBeUndefined()
    expect(result.rivalryImportance).toBeUndefined()
  })

  it('keeps every existing display field working against that same old payload', () => {
    const result = mapNinetyEvent(bare(), league)
    expect(result.homeTeam).toBe('Home FC')
    expect(result.awayTeam).toBe('Away FC')
    expect(result.title).toBe('Home FC vs Away FC')
    expect(result.league).toBe('Premier League')
    expect(result.broadcasts).toEqual([])
  })

  it('carries the fields through when the backend does send them', () => {
    const result = mapNinetyEvent(
      {
        ...bare(),
        home_team_id: 'team_glimt',
        away_team_id: 'team_benfica',
        home_team_domestic_competition_id: 'norway_eliteserien',
        away_team_domestic_competition_id: 'portugal_primeira',
        home_team_prominence: 0.42,
        away_team_prominence: 0.71,
        rivalry_importance: 0.15,
      },
      league,
    )
    expect(result.homeTeamId).toBe('team_glimt')
    expect(result.awayTeamId).toBe('team_benfica')
    expect(result.homeDomesticCompetitionId).toBe('norway_eliteserien')
    expect(result.awayDomesticCompetitionId).toBe('portugal_primeira')
    expect(result.homeTeamProminence).toBe(0.42)
    expect(result.awayTeamProminence).toBe(0.71)
    expect(result.rivalryImportance).toBe(0.15)
  })

  // An explicit null is "we have no value for this", which must be
  // indistinguishable downstream from the field being absent.
  it('treats an explicit null the same as an absent field', () => {
    const result = mapNinetyEvent(
      { ...bare(), home_team_id: null, home_team_prominence: null, rivalry_importance: null },
      league,
    )
    expect(result.homeTeamId).toBeUndefined()
    expect(result.homeTeamProminence).toBeUndefined()
    expect(result.rivalryImportance).toBeUndefined()
  })

  // Two unknowns must never compare equal and invent a "same team" relation.
  it('treats an empty-string id as absent rather than as a matchable value', () => {
    const result = mapNinetyEvent({ ...bare(), home_team_id: '', away_team_id: '' }, league)
    expect(result.homeTeamId).toBeUndefined()
    expect(result.awayTeamId).toBeUndefined()
  })

  it('clamps an out-of-range prominence into 0..1 instead of propagating it', () => {
    const result = mapNinetyEvent({ ...bare(), home_team_prominence: 4.5, away_team_prominence: -2 }, league)
    expect(result.homeTeamProminence).toBe(1)
    expect(result.awayTeamProminence).toBe(0)
  })

  it('drops a non-finite signal so no score downstream can become NaN', () => {
    const result = mapNinetyEvent({ ...bare(), home_team_prominence: Number.NaN }, league)
    expect(result.homeTeamProminence).toBeUndefined()
  })
})

// ===========================================================================
// OBJECTIVE BROADCAST AVAILABILITY — the API mapping
// ===========================================================================
//
// This build is expected to run against a ninety-api that does not send
// these fields yet, so "what happens when the field isn't there" is the
// primary case, not the edge case.
describe('mapNinetyEvent broadcast availability', () => {
  const bare = () => event([])

  // TEST 1 — missing broadcast_availability from an older API.
  it('maps an absent broadcast_availability to UNKNOWN, never to a negative', () => {
    const result = mapNinetyEvent(bare(), league)
    expect(result.broadcastAvailability).toBe('UNKNOWN')
    expect(result.broadcastAvailabilityReason).toBeUndefined()
  })

  it('maps an explicit null the same way an absent field is mapped', () => {
    const result = mapNinetyEvent({ ...bare(), broadcast_availability: null, broadcast_availability_reason: null }, league)
    expect(result.broadcastAvailability).toBe('UNKNOWN')
    expect(result.broadcastAvailabilityReason).toBeUndefined()
  })

  // TEST 2 — an unrecognized status must never reach Home as itself.
  it('normalizes an unrecognized status to UNKNOWN rather than propagating it', () => {
    const result = mapNinetyEvent(
      // A future backend classification this build predates — cast because
      // the point is precisely that the runtime value is off-union.
      { ...bare(), broadcast_availability: 'PROBABLY_ON_THE_RADIO' as never },
      league,
    )
    expect(result.broadcastAvailability).toBe('UNKNOWN')
  })

  it('carries every recognized status through unchanged, with its reason', () => {
    for (const status of ['CONFIRMED_BROADCAST', 'LIKELY_BROADCAST', 'UNKNOWN', 'LIKELY_NOT_BROADCAST', 'CONFIRMED_NOT_BROADCAST'] as const) {
      const result = mapNinetyEvent(
        { ...bare(), broadcast_availability: status, broadcast_availability_reason: 'no listings in any tracked market' },
        league,
      )
      expect(result.broadcastAvailability).toBe(status)
      expect(result.broadcastAvailabilityReason).toBe('no listings in any tracked market')
    }
  })

  // TEST 14 — the two questions are independent, and this is the direction
  // that is easy to get wrong: an empty broadcasts array is routine (it is
  // country-narrowed, and EPG coverage is incomplete) and says nothing at
  // all about whether the match is televised.
  it('keeps CONFIRMED_BROADCAST even when the event carries no broadcasts at all', () => {
    const result = mapNinetyEvent({ ...bare(), broadcast_availability: 'CONFIRMED_BROADCAST' }, league)
    expect(result.broadcasts).toEqual([])
    expect(result.broadcastAvailability).toBe('CONFIRMED_BROADCAST')
  })

  // TEST 15 — `country` narrows which broadcasters come back; it is not an
  // input to the objective verdict, and a narrowed-to-nothing payload must
  // not read as a different status than the same event unnarrowed.
  it('reports the same availability whether or not the country filter removed every broadcaster', () => {
    const unnarrowed = mapNinetyEvent(
      { ...event([broadcast({ name: 'Sky Sports', country: 'GB' })]), broadcast_availability: 'CONFIRMED_BROADCAST' },
      league,
    )
    const narrowedAway = mapNinetyEvent({ ...event([]), broadcast_availability: 'CONFIRMED_BROADCAST' }, league)
    expect(unnarrowed.broadcastAvailability).toBe(narrowedAway.broadcastAvailability)
    expect(unnarrowed.broadcasts).toHaveLength(1)
    expect(narrowedAway.broadcasts).toHaveLength(0)
  })

  // F1 comes from TheSportsDB, which has no such concept — it must read as
  // UNKNOWN (i.e. behave exactly as it always has), not as missing data
  // anything treats as a negative.
  it('leaves a TheSportsDB event with no availability at all, which reads as UNKNOWN', () => {
    const result = mapEvent(
      { idEvent: 'f1-1', strEvent: 'Monza Grand Prix', strLeague: 'Formula 1', dateEvent: '2026-08-18', strTime: '13:00:00' } as RawSportsDbEvent,
      { ...league, id: 'f1', sportKey: 'f1', sportLabel: 'FORMULA 1' },
    )
    expect(result.broadcastAvailability).toBeUndefined()
  })
})
