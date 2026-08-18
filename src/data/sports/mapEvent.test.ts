import { describe, expect, it } from 'vitest'
import { mapNinetyEvent } from './mapEvent'
import type { NinetyEvent, NinetyBroadcast } from './ninetyApiClient'
import type { LeagueDef } from './leagues'

const league: LeagueDef = {
  id: 'premier-league',
  sportKey: 'football',
  sportLabel: 'Premier League',
  tsdbSport: 'Soccer',
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
    round_code: null,
    competition_id: null,
    competition_name: 'Premier League',
    home_team_name: 'Home FC',
    home_team_logo: null,
    away_team_name: 'Away FC',
    away_team_logo: null,
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
