// @vitest-environment jsdom
//
// Screen-level coverage for Schedule, the surface that replaced the old
// Competitions round-browser. The ranking/grouping rules themselves are
// covered exhaustively and purely in data/sports/scheduleRanking.test.ts;
// what's asserted here is what those rules turn into on screen — every
// fixture reachable without picking a competition first, the "All" default,
// the pill row actually filtering, and the plain product copy for
// loading/empty/error.
//
// Rendering only: jsdom has no layout, so norigin's geometric focus search
// can't be exercised (same reasoning as OnboardingSportsScreen.test.tsx).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { init } from '@noriginmedia/norigin-spatial-navigation'
import { makeFakeLocalStorage } from '../../core/storage/testFakeLocalStorage'
import { savePreferences, DEFAULT_PREFERENCES } from '../../data/preferences'
import type { SportEvent } from '../../data/sports/types'
import type { TodaysScheduleState } from '../../data/sports/useTodaysSchedule'

// The one network boundary: the day's fixtures. Its own from/to window logic
// is covered in localDay.test.ts.
const scheduleState = { current: { status: 'loading' } as TodaysScheduleState }
vi.mock('../../data/sports/useTodaysSchedule', () => ({
  useTodaysSchedule: () => scheduleState.current,
}))

const { ScheduleScreen } = await import('./ScheduleScreen')

init({ debug: false, visualDebug: false })
Element.prototype.scrollIntoView = () => {}

function fixture(overrides: Partial<SportEvent> & Pick<SportEvent, 'id' | 'leagueId' | 'league'>): SportEvent {
  return {
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    leagueTier: 1,
    title: overrides.id,
    homeTeam: `${overrides.id} Home`,
    awayTeam: `${overrides.id} Away`,
    dateTimeUtc: '2026-08-26T18:00:00Z',
    timeLabel: '',
    isLive: false,
    ...overrides,
  }
}

const groupTitles = () => [...document.querySelectorAll('.schedule-group-title')].map((el) => el.textContent)
const pillLabels = () => [...document.querySelectorAll('.league-pill')].map((el) => el.textContent)
const activePill = () => document.querySelector('.league-pill.active')?.textContent ?? null
const fixtureRows = () => [...document.querySelectorAll('.fixture-row')].map((el) => el.textContent ?? '')

const clickPill = async (label: string) => {
  const pill = [...document.querySelectorAll('.league-pill')].find((el) => el.textContent === label)
  expect(pill).toBeTruthy()
  await act(async () => {
    ;(pill as HTMLElement).click()
  })
}

function renderSchedule() {
  return render(<ScheduleScreen onSelectEvent={() => {}} onBack={() => {}} />)
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
  scheduleState.current = { status: 'loading' }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Schedule — states', () => {
  it('says it is loading today’s schedule, in product language', () => {
    renderSchedule()
    expect(screen.getByText("Loading today's schedule…")).toBeTruthy()
    expect(screen.getByText('Schedule')).toBeTruthy()
    expect(screen.getByText('Today')).toBeTruthy()
  })

  it('reports a failure without exposing backend terminology', () => {
    scheduleState.current = { status: 'error', message: 'ninety-api /v1/events failed: 503' }
    renderSchedule()
    expect(screen.getByText("Unable to load today's schedule.")).toBeTruthy()
    expect(screen.queryByText(/ninety-api/)).toBeNull()
  })

  it('says there are no fixtures today rather than showing an empty page', () => {
    scheduleState.current = { status: 'ready', fixtures: [] }
    renderSchedule()
    expect(screen.getByText('No fixtures today.')).toBeTruthy()
    expect(pillLabels()).toHaveLength(0)
  })
})

describe('Schedule — the default view is the whole day', () => {
  const FIXTURES = [
    fixture({ id: 'pl-1', leagueId: 'football_premier_league', league: 'Premier League' }),
    fixture({ id: 'cl-1', leagueId: 'football_champions_league', league: 'UEFA Champions League', round: 'Semi-finals' }),
    fixture({ id: 'tiny-1', leagueId: 'tiny_cup', league: 'Tiny Cup', leagueTier: 3 }),
  ]

  beforeEach(() => {
    savePreferences({ ...DEFAULT_PREFERENCES, footballLeagueIds: ['football_premier_league'] })
    scheduleState.current = { status: 'ready', fixtures: FIXTURES }
  })

  it('opens on "All" with every competition already visible — no competition has to be picked first', () => {
    renderSchedule()
    expect(activePill()).toBe('All')
    expect(groupTitles()).toHaveLength(3)
    expect(fixtureRows()).toHaveLength(3)
  })

  it('keeps a small non-favorite competition on the page, only lower down', () => {
    renderSchedule()
    expect(groupTitles()).toContain('Tiny Cup')
    expect(groupTitles().indexOf('Tiny Cup')).toBe(2)
  })

  it('surfaces the favorite league first and the Champions League tie above the tiny cup', () => {
    renderSchedule()
    expect(groupTitles()).toEqual(['Premier League', 'UEFA Champions League', 'Tiny Cup'])
  })

  it('offers one pill per competition with a fixture today, in the same order as the sections', () => {
    renderSchedule()
    expect(pillLabels()).toEqual(['All', 'Premier League', 'UEFA Champions League', 'Tiny Cup'])
  })
})

describe('Schedule — the league filter only narrows on an explicit selection', () => {
  beforeEach(() => {
    savePreferences({ ...DEFAULT_PREFERENCES, footballLeagueIds: [] })
    scheduleState.current = {
      status: 'ready',
      fixtures: [
        fixture({ id: 'pl-1', leagueId: 'football_premier_league', league: 'Premier League' }),
        fixture({ id: 'tiny-1', leagueId: 'tiny_cup', league: 'Tiny Cup', leagueTier: 3 }),
      ],
    }
  })

  it('narrows to exactly the picked competition', async () => {
    renderSchedule()
    await clickPill('Tiny Cup')
    expect(activePill()).toBe('Tiny Cup')
    expect(groupTitles()).toEqual(['Tiny Cup'])
    expect(fixtureRows()).toHaveLength(1)
  })

  it('returns to the whole day when All is picked again', async () => {
    renderSchedule()
    await clickPill('Tiny Cup')
    await clickPill('All')
    expect(activePill()).toBe('All')
    expect(groupTitles()).toHaveLength(2)
  })

  it('keeps every competition in the pill row while filtered, so nothing becomes unreachable', async () => {
    renderSchedule()
    await clickPill('Tiny Cup')
    expect(pillLabels()).toEqual(['All', 'Premier League', 'Tiny Cup'])
  })
})

describe('Schedule — fixture rows', () => {
  beforeEach(() => {
    savePreferences({ ...DEFAULT_PREFERENCES, footballLeagueIds: [] })
  })

  it('shows LIVE instead of a kickoff time for a live fixture, and the real score', () => {
    scheduleState.current = {
      status: 'ready',
      fixtures: [fixture({ id: 'l', leagueId: 'c', league: 'C', isLive: true, status: 'live', homeScore: '2', awayScore: '1' })],
    }
    renderSchedule()
    expect(document.querySelector('.fixture-row-live')?.textContent).toContain('LIVE')
    expect(document.querySelector('.fixture-row-center')?.textContent).toBe('2 – 1')
  })

  it('shows VS (not a fabricated score) for a fixture that has not kicked off', () => {
    scheduleState.current = { status: 'ready', fixtures: [fixture({ id: 's', leagueId: 'c', league: 'C', status: 'scheduled' })] }
    renderSchedule()
    expect(document.querySelector('.fixture-row-center')?.textContent).toBe('VS')
    expect(document.querySelector('.fixture-row-live')).toBeNull()
  })

  it('marks an already-finished earlier fixture FT and keeps its final score', () => {
    scheduleState.current = {
      status: 'ready',
      fixtures: [fixture({ id: 'f', leagueId: 'c', league: 'C', status: 'complete', homeScore: '0', awayScore: '3' })],
    }
    renderSchedule()
    expect(document.querySelector('.fixture-row-ft')?.textContent).toBe('FT')
    expect(document.querySelector('.fixture-row-center')?.textContent).toBe('0 – 3')
  })

  it('opens Event Details from any fixture row', async () => {
    const onSelectEvent = vi.fn()
    scheduleState.current = { status: 'ready', fixtures: [fixture({ id: 'x', leagueId: 'c', league: 'C' })] }
    render(<ScheduleScreen onSelectEvent={onSelectEvent} onBack={() => {}} />)
    await act(async () => {
      ;(document.querySelector('.fixture-row') as HTMLElement).click()
    })
    expect(onSelectEvent).toHaveBeenCalledTimes(1)
    expect(onSelectEvent.mock.calls[0][0].id).toBe('x')
  })

  it('puts a live fixture above earlier and later kickoffs inside its own competition', () => {
    scheduleState.current = {
      status: 'ready',
      fixtures: [
        fixture({ id: 'late', leagueId: 'c', league: 'C', dateTimeUtc: '2026-08-26T21:00:00Z' }),
        fixture({ id: 'early', leagueId: 'c', league: 'C', dateTimeUtc: '2026-08-26T12:30:00Z' }),
        fixture({ id: 'live', leagueId: 'c', league: 'C', isLive: true, dateTimeUtc: '2026-08-26T19:00:00Z' }),
      ],
    }
    renderSchedule()
    const rows = fixtureRows()
    expect(rows[0]).toContain('live Home')
    expect(rows[1]).toContain('early Home')
    expect(rows[2]).toContain('late Home')
  })
})
