import { describe, expect, it } from 'vitest'
import { mapEvent, mapNinetyEvent } from './mapEvent'
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
  it('maps status "live" to isLive: true, isLiveHeuristic: undefined (real data, not a guess)', () => {
    const result = mapNinetyEvent({ ...event([]), status: 'live', home_score: 1, away_score: 0 }, league)
    expect(result.isLive).toBe(true)
    expect(result.isLiveHeuristic).toBeUndefined()
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
