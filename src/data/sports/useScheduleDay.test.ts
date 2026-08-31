// @vitest-environment jsdom
//
// The data contract behind Schedule's date navigator: which window is asked
// for, what is allowed through it, what the screen gets alongside the
// fixtures, and what a re-visited day costs.
//
// The window ARITHMETIC itself (local midnight, DST, month/year rollover) is
// covered purely in localDay.test.ts — what's asserted here is that this
// hook asks for exactly that window, for the day it was given, and re-asks
// when the day changes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { localDayRangeOffset } from './localDay'
import type { LeagueDef } from './leagues'
import type { GetEventsParams, NinetyEvent } from './ninetyApiClient'

const { getAllEventsMock, loadFootballCompetitionsMock } = vi.hoisted(() => ({
  getAllEventsMock: vi.fn(),
  loadFootballCompetitionsMock: vi.fn(),
}))

vi.mock('./ninetyApiClient', () => ({ getAllEvents: getAllEventsMock }))
vi.mock('./competitionsCatalog', () => ({ loadFootballCompetitions: loadFootballCompetitionsMock }))

const { canGoToPreviousScheduleDay, MIN_SCHEDULE_DAY_OFFSET, useScheduleDay } = await import('./useScheduleDay')

const CATALOG: LeagueDef[] = [
  {
    id: 'football_premier_league',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    tsdbSport: 'Soccer',
    name: 'Premier League',
    region: 'England',
    countryCode: 'GB',
    tier: 1,
    badge: 'https://example.test/pl.png',
  },
]

// An hour inside the local day, whatever timezone the test process is in.
const atLocalHour = (range: { startMs: number }, hour: number) => new Date(range.startMs + hour * 3_600_000).toISOString()

function event(
  id: string,
  startTimeUtc: string,
  competitionId = 'football_premier_league',
  competitionName = 'Premier League',
): NinetyEvent {
  return {
    id,
    start_time_utc: startTimeUtc,
    status: 'scheduled',
    home_score: null,
    away_score: null,
    round_code: null,
    competition_id: competitionId,
    competition_name: competitionName,
    home_team_name: 'Home',
    home_team_logo: null,
    home_team_form: null,
    away_team_name: 'Away',
    away_team_logo: null,
    away_team_form: null,
    venue_name: null,
    broadcasts: [],
  }
}

const paramsOf = (call: number): GetEventsParams => getAllEventsMock.mock.calls[call][0]

beforeEach(() => {
  getAllEventsMock.mockReset()
  loadFootballCompetitionsMock.mockReset()
  loadFootballCompetitionsMock.mockResolvedValue(CATALOG)
  getAllEventsMock.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
})

describe('useScheduleDay — the requested window', () => {
  it("asks for the viewer's local today at offset 0", async () => {
    renderHook(() => useScheduleDay(0))
    await waitFor(() => expect(getAllEventsMock).toHaveBeenCalledTimes(1))
    const today = localDayRangeOffset(0)
    expect(paramsOf(0).from).toBe(today.fromUtc)
    expect(paramsOf(0).to).toBe(today.toUtc)
  })

  it('asks for a different window when the offset changes', async () => {
    const { rerender } = renderHook(({ offset }) => useScheduleDay(offset), { initialProps: { offset: 0 } })
    await waitFor(() => expect(getAllEventsMock).toHaveBeenCalledTimes(1))

    await act(async () => {
      rerender({ offset: 1 })
    })
    await waitFor(() => expect(getAllEventsMock).toHaveBeenCalledTimes(2))
    expect(paramsOf(1).from).toBe(localDayRangeOffset(1).fromUtc)
    expect(paramsOf(1).from).not.toBe(paramsOf(0).from)

    await act(async () => {
      rerender({ offset: -1 })
    })
    await waitFor(() => expect(getAllEventsMock).toHaveBeenCalledTimes(3))
    expect(paramsOf(2).from).toBe(localDayRangeOffset(-1).fromUtc)
  })

  // ninety-api's `date` filter compares the UTC calendar date, which is not
  // the viewer's day for anyone outside UTC — see localDay.ts.
  it('never uses the API’s UTC `date` filter, and never narrows by competition or country', async () => {
    renderHook(() => useScheduleDay(0))
    await waitFor(() => expect(getAllEventsMock).toHaveBeenCalledTimes(1))
    const params = paramsOf(0)
    expect(params.date).toBeUndefined()
    expect(params.competitionId).toBeUndefined()
    expect(params.country).toBeUndefined()
  })
})

describe('useScheduleDay — the local-day boundary is enforced client side too', () => {
  it('keeps a fixture inside the selected local day and rejects the ones outside it', async () => {
    const today = localDayRangeOffset(0)
    getAllEventsMock.mockResolvedValue([
      event('in-morning', atLocalHour(today, 1)),
      event('in-evening', atLocalHour(today, 20)),
      event('yesterday', new Date(today.startMs - 1).toISOString()),
      event('tomorrow', new Date(today.endMs).toISOString()),
      event('no-kickoff', ''),
    ])
    const { result } = renderHook(() => useScheduleDay(0))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    if (result.current.status !== 'ready') throw new Error('not ready')
    expect(result.current.fixtures.map((f) => f.id)).toEqual(['ninety:in-morning', 'ninety:in-evening'])
  })
})

describe('useScheduleDay — competition metadata travels with the day', () => {
  it('hands back the canonical registry entry for every competition present', async () => {
    getAllEventsMock.mockResolvedValue([event('a', atLocalHour(localDayRangeOffset(0), 18))])
    const { result } = renderHook(() => useScheduleDay(0))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    if (result.current.status !== 'ready') throw new Error('not ready')
    expect(result.current.competitions.get('football_premier_league')?.region).toBe('England')
    expect(result.current.competitions.get('football_premier_league')?.countryCode).toBe('GB')
  })

  it('synthesizes an entry for a competition the catalog has never heard of, rather than dropping its fixture', async () => {
    getAllEventsMock.mockResolvedValue([
      event('a', atLocalHour(localDayRangeOffset(0), 18), 'brand_new_cup', 'Brand New Cup'),
    ])
    const { result } = renderHook(() => useScheduleDay(0))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    if (result.current.status !== 'ready') throw new Error('not ready')
    expect(result.current.fixtures).toHaveLength(1)
    // Named from what the EVENT carried, with no invented tier or region —
    // see fallbackFootballLeague.
    const synthesized = result.current.competitions.get('brand_new_cup')
    expect(synthesized?.name).toBe('Brand New Cup')
    expect(synthesized?.tier).toBeUndefined()
    expect(synthesized?.countryCode).toBeUndefined()
  })
})

describe('useScheduleDay — visited days are cached for the life of the screen', () => {
  it('does not re-fetch a day the viewer has already been on', async () => {
    const { result, rerender } = renderHook(({ offset }) => useScheduleDay(offset), { initialProps: { offset: 0 } })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      rerender({ offset: 1 })
    })
    await waitFor(() => expect(getAllEventsMock).toHaveBeenCalledTimes(2))

    await act(async () => {
      rerender({ offset: 0 })
    })
    // Straight back to ready with no third request, and no loading frame in
    // between — the cache is read during render, not from an effect.
    expect(result.current.status).toBe('ready')
    expect(getAllEventsMock).toHaveBeenCalledTimes(2)
  })

  it('retries a day that failed rather than replaying the error', async () => {
    getAllEventsMock.mockRejectedValueOnce(new Error('ninety-api /v1/events failed: 503'))
    const { result, rerender } = renderHook(({ offset }) => useScheduleDay(offset), { initialProps: { offset: 0 } })
    await waitFor(() => expect(result.current.status).toBe('error'))

    await act(async () => {
      rerender({ offset: 1 })
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      rerender({ offset: 0 })
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(getAllEventsMock).toHaveBeenCalledTimes(3)
  })
})

describe('the backwards boundary', () => {
  it('stops at yesterday', () => {
    expect(MIN_SCHEDULE_DAY_OFFSET).toBe(-1)
    expect(canGoToPreviousScheduleDay(1)).toBe(true)
    expect(canGoToPreviousScheduleDay(0)).toBe(true)
    expect(canGoToPreviousScheduleDay(-1)).toBe(false)
  })
})
