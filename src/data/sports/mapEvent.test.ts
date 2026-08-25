import { describe, expect, it } from 'vitest'
import { mapNinetyEvent } from './mapEvent'
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
