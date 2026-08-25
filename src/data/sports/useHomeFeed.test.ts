// @vitest-environment jsdom
//
// Regression coverage for the live-scores/background-sync feature's global
// silent-refresh mechanism: stale-while-revalidate (never blanks the feed
// mid-refresh), ~60s periodic + visibility-regain triggers, no overlapping
// requests, a failed background refresh preserving last-known-good data,
// and eventsById staying current for App.tsx's "fresh event" lookup (see
// EventDetailsScreen's live score display).
//
// Uses fake timers throughout (needed for the periodic/visibility tests) —
// deliberately does NOT use @testing-library's waitFor, which polls via its
// own internal timer and simply never resolves once vi.useFakeTimers() is
// active (its polling timer is frozen along with everything else). Instead,
// `flush()` drives fake-timer-aware microtask draining directly.
//
// Network-touching modules are mocked at the boundary (ninetyApiClient,
// competitionsCatalog, channelMatch) — mapNinetyEvent/heroScoring/leagues
// stay real (pure, already covered by their own test files). Preferences
// are football-only in every test here so otherLeaguesForPreferences(['football'])
// resolves to [] and TheSportsDB (F1) is never actually invoked.
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHomeFeed } from './useHomeFeed'
import type { NinetyEvent } from './ninetyApiClient'
import type { LeagueDef } from './leagues'
import type { SportPreferences } from '../preferences'
import type { Channel } from '../channel'

// Stable references passed to every renderHook call below — Effect 2
// (channels/xtreamCreds/identityIndex in its own deps array) re-runs
// whenever these change identity, same as App.tsx's real playlist.channels
// state; a fresh [] literal on every render (as opposed to this one shared
// constant) would make Effect 2 re-fire every render forever.
const STABLE_CHANNELS: Channel[] = []

const { getAllEventsMock, loadFootballCompetitionsMock, matchChannelsForEventMock } = vi.hoisted(() => ({
  getAllEventsMock: vi.fn(),
  loadFootballCompetitionsMock: vi.fn(),
  matchChannelsForEventMock: vi.fn(),
}))

vi.mock('./ninetyApiClient', () => ({
  getAllEvents: getAllEventsMock,
}))
vi.mock('./competitionsCatalog', () => ({
  loadFootballCompetitions: loadFootballCompetitionsMock,
}))
vi.mock('./channelMatch', () => ({
  matchChannelsForEvent: matchChannelsForEventMock,
}))

const LEAGUE: LeagueDef = {
  id: 'comp1',
  sportKey: 'football',
  sportLabel: 'FOOTBALL',
  tsdbSport: 'Soccer',
  name: 'Test League',
  ninetyCompetitionId: 'comp1',
}

const PREFERENCES: SportPreferences = {
  sports: ['football'],
  footballLeagueIds: ['comp1'],
  favoriteCountries: [],
  streamType: 'auto',
}

function ninetyEvent(overrides: Partial<NinetyEvent> = {}): NinetyEvent {
  return {
    id: 'evt1',
    // In the future relative to any Date.now() this file's tests run at —
    // useHomeFeed's own `upcoming` filter drops anything already in the
    // past, which would make a 'scheduled' fixture invisible for reasons
    // unrelated to what these tests are checking.
    start_time_utc: '2099-01-01T18:00:00Z',
    status: 'scheduled',
    home_score: null,
    away_score: null,
    round_code: null,
    competition_id: 'comp1',
    competition_name: 'Test League',
    home_team_name: 'Home FC',
    home_team_logo: null,
    home_team_form: null,
    away_team_name: 'Away FC',
    away_team_logo: null,
    away_team_form: null,
    venue_name: null,
    broadcasts: [],
    ...overrides,
  }
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

// Drains microtasks (mock promise resolutions, React state updates, the
// effects they schedule) without relying on wall-clock time — safe under
// fake timers, unlike waitFor. Repeated: this hook's own chain is several
// hops deep (fetch resolves -> setFetchState -> Effect 2 fires -> its own
// matchChannelsForEvent resolves -> setState), and each hop needs its own
// microtask turn.
async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  setVisibility('visible')
  loadFootballCompetitionsMock.mockResolvedValue([LEAGUE])
  matchChannelsForEventMock.mockResolvedValue({ matches: [{ channel: {}, source: {} }], apiHasData: true, apiStations: [] })
  getAllEventsMock.mockReset()
})

afterEach(() => {
  // No global vitest setup file registers @testing-library/react's
  // auto-cleanup in this repo (no other .test.tsx file exists yet — see
  // the live-scores task's own final report) — without this explicit
  // call, a previous test's renderHook instance (and its setInterval/
  // visibilitychange listener) stays mounted into the next test, which is
  // exactly what caused the "visibility regain" test to observe 8 calls
  // instead of 1 the first time this file was written.
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

// Renders the hook and drives it to 'ready' — shared setup for every test
// below that isn't specifically about the loading state itself.
async function renderReady(initialEvents: NinetyEvent[]) {
  getAllEventsMock.mockResolvedValueOnce(initialEvents)
  const { result } = renderHook(() => useHomeFeed(PREFERENCES, STABLE_CHANNELS, null, null))
  await flush()
  expect(result.current.status).toBe('ready')
  return result
}

describe('useHomeFeed initial load', () => {
  it('starts in loading status before the first fetch resolves, then reaches ready', async () => {
    let resolveFetch: (events: NinetyEvent[]) => void = () => {}
    getAllEventsMock.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve }))
    const { result } = renderHook(() => useHomeFeed(PREFERENCES, STABLE_CHANNELS, null, null))
    expect(result.current.status).toBe('loading')

    await act(async () => {
      resolveFetch([])
    })
    await flush()
    expect(result.current.status).toBe('ready')
  })
})

describe('useHomeFeed background refresh (stale-while-revalidate)', () => {
  it('a ~60s periodic tick never shows loading again -- every render after the first "ready" stays non-loading', async () => {
    getAllEventsMock.mockResolvedValueOnce([ninetyEvent({ status: 'live', home_score: 0, away_score: 0 })])
    const statuses: string[] = []
    const { result } = renderHook(() => {
      const state = useHomeFeed(PREFERENCES, STABLE_CHANNELS, null, null)
      statuses.push(state.status)
      return state
    })
    await flush()
    expect(result.current.status).toBe('ready')
    const statusesBeforeRefresh = statuses.length

    getAllEventsMock.mockResolvedValueOnce([ninetyEvent({ status: 'live', home_score: 1, away_score: 0 })])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    await flush()

    expect(result.current.eventsById.get('ninety:evt1')?.homeScore).toBe('1')
    // Every render captured from the moment we were first 'ready' onward
    // (the periodic tick's whole lifecycle) never went back to 'loading'.
    expect(statuses.slice(statusesBeforeRefresh - 1).every((s) => s !== 'loading')).toBe(true)
  })

  it('background refresh success updates the score from 0-0 to 1-0', async () => {
    const result = await renderReady([ninetyEvent({ status: 'live', home_score: 0, away_score: 0 })])
    expect(result.current.eventsById.get('ninety:evt1')?.homeScore).toBe('0')

    getAllEventsMock.mockResolvedValueOnce([ninetyEvent({ status: 'live', home_score: 1, away_score: 0 })])
    act(() => {
      result.current.refresh()
    })
    await flush()

    expect(result.current.eventsById.get('ninety:evt1')?.homeScore).toBe('1')
  })

  it('a failed background refresh keeps the last known data instead of showing an error', async () => {
    const result = await renderReady([ninetyEvent({ status: 'live', home_score: 3, away_score: 1 })])
    expect(result.current.status).toBe('ready')

    getAllEventsMock.mockRejectedValueOnce(new Error('network down'))
    act(() => {
      result.current.refresh()
    })
    await flush()

    // Still 'ready' (not 'error'), and the score from before the failed
    // refresh is untouched.
    expect(result.current.status).toBe('ready')
    expect(result.current.eventsById.get('ninety:evt1')?.homeScore).toBe('3')
  })

  it('periodic refresh continues to fire on every ~60s tick, not just once', async () => {
    const result = await renderReady([ninetyEvent()])
    void result
    const callsAfterInitialLoad = getAllEventsMock.mock.calls.length

    getAllEventsMock.mockResolvedValue([ninetyEvent()])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    await flush()

    expect(getAllEventsMock.mock.calls.length).toBe(callsAfterInitialLoad + 2)
  })

  it('does not poll at all while the document is hidden', async () => {
    await renderReady([ninetyEvent()])
    const callsAfterInitialLoad = getAllEventsMock.mock.calls.length

    setVisibility('hidden')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    await flush()

    expect(getAllEventsMock.mock.calls.length).toBe(callsAfterInitialLoad)
  })

  it('visibility regain triggers an immediate refresh', async () => {
    await renderReady([ninetyEvent()])
    const callsAfterInitialLoad = getAllEventsMock.mock.calls.length

    getAllEventsMock.mockResolvedValueOnce([ninetyEvent()])
    setVisibility('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })
    await flush()

    expect(getAllEventsMock.mock.calls.length).toBe(callsAfterInitialLoad + 1)
  })

  it('does not launch a duplicate request when a refresh is already in flight', async () => {
    const result = await renderReady([ninetyEvent()])
    const callsAfterInitialLoad = getAllEventsMock.mock.calls.length

    let resolveSecondFetch: (events: NinetyEvent[]) => void = () => {}
    getAllEventsMock.mockReturnValueOnce(new Promise((resolve) => { resolveSecondFetch = resolve }))

    act(() => {
      result.current.refresh() // starts the in-flight fetch above
    })
    act(() => {
      result.current.refresh() // must no-op -- one is already running
    })
    await act(async () => {
      resolveSecondFetch([ninetyEvent()])
      await vi.advanceTimersByTimeAsync(0)
    })
    await flush()

    expect(getAllEventsMock.mock.calls.length).toBe(callsAfterInitialLoad + 1)
  })

  it('an explicit refresh() call (as App.tsx issues on Player exit) updates eventsById', async () => {
    const result = await renderReady([ninetyEvent({ status: 'scheduled' })])
    expect(result.current.eventsById.get('ninety:evt1')?.status).toBe('scheduled')

    getAllEventsMock.mockResolvedValueOnce([ninetyEvent({ status: 'complete', home_score: 2, away_score: 1 })])
    act(() => {
      result.current.refresh()
    })
    await flush()

    expect(result.current.eventsById.get('ninety:evt1')?.status).toBe('complete')
    expect(result.current.eventsById.get('ninety:evt1')?.homeScore).toBe('2')
  })
})

describe('useHomeFeed Home section transitions (scheduled -> live -> complete)', () => {
  it('a finished match leaves both liveNow and tonight -- it must not linger just because Home loaded before kickoff', async () => {
    // Kickoff in the near past relative to fake-timer "now" -- upcoming's
    // own dateTimeUtc > now filter is what actually excludes a completed
    // match; this proves that filter still does its job once status flows
    // through as 'complete' instead of the old always-false isLive guess.
    const kickoff = new Date(Date.now() - 60_000).toISOString()
    const result = await renderReady([ninetyEvent({ start_time_utc: kickoff, status: 'live', home_score: 1, away_score: 0 })])
    expect(result.current.feed.liveNow.some((e) => e.id === 'ninety:evt1')).toBe(true)

    getAllEventsMock.mockResolvedValueOnce([ninetyEvent({ start_time_utc: kickoff, status: 'complete', home_score: 2, away_score: 1 })])
    act(() => {
      result.current.refresh()
    })
    await flush()

    expect(result.current.eventsById.get('ninety:evt1')?.status).toBe('complete')
    expect(result.current.feed.liveNow.some((e) => e.id === 'ninety:evt1')).toBe(false)
    expect(result.current.feed.tonight.some((e) => e.id === 'ninety:evt1')).toBe(false)
  })
})
