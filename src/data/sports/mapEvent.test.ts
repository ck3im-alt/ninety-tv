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
