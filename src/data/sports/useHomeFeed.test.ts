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
import { NO_XTREAM_CREDENTIALS } from '../playlists/xtreamResolver'
import { useHomeFeed } from './useHomeFeed'
import { FORWARD_EXPANSION_DAYS, MIN_VISIBLE_UPCOMING_FOOTBALL } from './homeFeedDensity'
import type { NinetyEvent } from './ninetyApiClient'
import type { LeagueDef } from './leagues'
import type { SportPreferences } from '../preferences'
import type { Channel } from '../channel'

// Stable references passed to every renderHook call below — Effect 2
// (channels/xtream/identityIndex in its own deps array) re-runs whenever
// these change identity, same as the combined library.channels array App.tsx
// passes in; a fresh [] literal on every render (as opposed to this one
// shared constant) would make Effect 2 re-fire every render forever.
const STABLE_CHANNELS: Channel[] = []

const {
  getAllEventsMock,
  loadFootballCompetitionsMock,
  matchChannelsForEventMock,
  fetchNextEventsForLeagueMock,
  fetchPastEventsForLeagueMock,
} = vi.hoisted(() => ({
  getAllEventsMock: vi.fn(),
  loadFootballCompetitionsMock: vi.fn(),
  matchChannelsForEventMock: vi.fn(),
  fetchNextEventsForLeagueMock: vi.fn(),
  fetchPastEventsForLeagueMock: vi.fn(),
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
// Only ever reached by a NON-football league (see otherLeaguesForPreferences),
// which every test here avoids except the F1 one below — mocked at the
// boundary so enabling f1 in preferences costs no network and no real
// TheSportsDB shape.
vi.mock('./theSportsDbClient', () => ({
  fetchNextEventsForLeague: fetchNextEventsForLeagueMock,
  fetchPastEventsForLeague: fetchPastEventsForLeagueMock,
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
  favoriteTeamIds: [],
  homeContentMode: 'all',
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
// Effect 2 hands the main thread back mid-pass once it has held it for
// LOCAL_MATCH_SLICE_MS (see sliceWork), via requestIdleCallback with a 50 ms
// timeout falling back to setTimeout(0). `flush` above advances by 0 ms,
// which never reaches an idle callback's timeout — so a pass long enough to
// yield needs real time moved forward between drains.
async function flushChunks(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60)
    })
  }
}

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
  fetchNextEventsForLeagueMock.mockResolvedValue([])
  fetchPastEventsForLeagueMock.mockResolvedValue([])
  getAllEventsMock.mockReset()
  // Default for any call a test doesn't explicitly script. Needed because
  // load() makes a SECOND request when the primary window contains nothing
  // upcoming (the density expansion — see useHomeFeed.ts), which every
  // sparse fixture list in this file triggers. Without a default that call
  // resolves to undefined and the whole load reports a football error.
  // mockResolvedValueOnce still takes priority, so scripted tests are
  // unaffected.
  getAllEventsMock.mockResolvedValue([])
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
  const { result } = renderHook(() => useHomeFeed(PREFERENCES, STABLE_CHANNELS, NO_XTREAM_CREDENTIALS, null))
  await flush()
  expect(result.current.status).toBe('ready')
  return result
}

describe('useHomeFeed initial load', () => {
  it('starts in loading status before the first fetch resolves, then reaches ready', async () => {
    let resolveFetch: (events: NinetyEvent[]) => void = () => {}
    getAllEventsMock.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve }))
    const { result } = renderHook(() => useHomeFeed(PREFERENCES, STABLE_CHANNELS, NO_XTREAM_CREDENTIALS, null))
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
      const state = useHomeFeed(PREFERENCES, STABLE_CHANNELS, NO_XTREAM_CREDENTIALS, null)
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

// SEPARATING SPORTS FRESHNESS FROM PLAYLIST FRESHNESS.
//
// Now that provider playlists install a new generation every ~12 minutes,
// the two kinds of freshness have to stay independent in both directions: a
// new generation must re-run the LOCAL broadcaster/channel availability pass
// (that is how a newly added PPV feed makes a live card appear on Home)
// without dragging a sports-API request along with it, and a sports refresh
// must not depend on the playlist changing.
describe('useHomeFeed reaction to a playlist generation install', () => {
  it('re-runs local availability on a new channels array without issuing a single extra API request', async () => {
    getAllEventsMock.mockResolvedValueOnce([ninetyEvent({ status: 'live' })])
    let channels: Channel[] = []
    const { rerender } = renderHook(() => useHomeFeed(PREFERENCES, channels, NO_XTREAM_CREDENTIALS, null))
    await flush()
    const apiCallsAfterLoad = getAllEventsMock.mock.calls.length
    const matchCallsAfterLoad = matchChannelsForEventMock.mock.calls.length
    expect(matchCallsAfterLoad).toBeGreaterThan(0)

    // A generation install: a brand new combined channel array.
    channels = []
    await act(async () => {
      rerender()
    })
    await flush()

    // Matching ran again against the new generation...
    expect(matchChannelsForEventMock.mock.calls.length).toBeGreaterThan(matchCallsAfterLoad)
    // ...and no fixture request was made that was not otherwise due.
    expect(getAllEventsMock.mock.calls.length).toBe(apiCallsAfterLoad)
  })

  it('matches every near-term event, not just the first slice', async () => {
    // Deliberately more events than one slice would hold on a slow device,
    // so a bug in the slicing loop (a wrong bound, an early return after the
    // first yield) shows up as missing matches. The slicing RULE itself —
    // when it yields, and that a cancellation mid-yield abandons the pass —
    // is tested directly in core/async/sliceWork.test.ts, with the clock and
    // the event loop injected, because neither is observable through this
    // hook under fake timers.
    const events = Array.from({ length: 9 }, (_, i) => ninetyEvent({ id: `evt${i}`, status: 'live' }))
    getAllEventsMock.mockResolvedValueOnce(events)
    const { result } = renderHook(() => useHomeFeed(PREFERENCES, STABLE_CHANNELS, NO_XTREAM_CREDENTIALS, null))
    await flushChunks()

    expect(result.current.status).toBe('ready')
    expect(matchChannelsForEventMock.mock.calls.length).toBe(events.length)
    expect(result.current.feed.liveNow).toHaveLength(events.length)
  })

  it('a pass superseded mid-chunk does not overwrite the newer one', async () => {
    const events = Array.from({ length: 9 }, (_, i) => ninetyEvent({ id: `evt${i}`, status: 'live' }))
    getAllEventsMock.mockResolvedValueOnce(events)
    const { result, unmount } = renderHook(() => useHomeFeed(PREFERENCES, STABLE_CHANNELS, NO_XTREAM_CREDENTIALS, null))
    await flushChunks()
    expect(result.current.status).toBe('ready')

    // Unmounting mid-flight is the harshest version of "this pass was
    // superseded": every remaining chunk must abandon rather than write.
    const errors: unknown[] = []
    const onError = (e: ErrorEvent) => errors.push(e.error)
    window.addEventListener('error', onError)
    unmount()
    await flushChunks()
    window.removeEventListener('error', onError)
    expect(errors).toEqual([])
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

// The 2026-08-26 personalization pass's most important architectural
// change. Home used to fetch ONLY the competitions the viewer followed,
// which made favorites a hard content filter: a Champions League final
// could be live and Ninety would not know it existed, and a followed club
// playing outside its own league was invisible. Favorites now decide ORDER
// only.
describe('useHomeFeed candidate generation', () => {
  it('does NOT send a competition filter on the primary request', async () => {
    await renderReady([ninetyEvent()])
    const url = getAllEventsMock.mock.calls[0][0]
    expect(url.competitionId).toBeUndefined()
  })

  it('asks for a window from the recent past to the end of the viewer local day', async () => {
    await renderReady([ninetyEvent()])
    const { from, to } = getAllEventsMock.mock.calls[0][0]
    expect(new Date(from).getTime()).toBeLessThan(Date.now())
    expect(new Date(to).getTime()).toBeGreaterThan(Date.now())
    // The past reach is bounded — a whole afternoon of finished fixtures is
    // not a Home candidate set.
    expect(Date.now() - new Date(from).getTime()).toBeLessThanOrEqual(3 * 60 * 60 * 1000 + 1000)
  })

  // The point of dropping the filter: an event from a competition the
  // viewer does NOT follow must still reach the feed.
  it('keeps a live event from an unfollowed competition', async () => {
    loadFootballCompetitionsMock.mockResolvedValue([LEAGUE, { ...LEAGUE, id: 'comp2', ninetyCompetitionId: 'comp2', name: 'Other League' }])
    const result = await renderReady([
      ninetyEvent({ id: 'other', competition_id: 'comp2', status: 'live', start_time_utc: new Date(Date.now() - 60_000).toISOString() }),
    ])
    expect(result.current.feed.items.map((item) => item.event.id)).toContain('ninety:other')
  })

  // A competition the cached catalog has never heard of must not make the
  // fixture vanish — see fallbackFootballLeague.
  it('keeps an event whose competition is missing from the catalog', async () => {
    const result = await renderReady([
      ninetyEvent({ id: 'brand-new', competition_id: 'comp_unknown', competition_name: 'Brand New Cup' }),
    ])
    expect(result.current.eventsById.get('ninety:brand-new')?.league).toBe('Brand New Cup')
  })

  // A live football match with no channel in the playlist stays OUT of the
  // row (the long-standing rule) but must remain known to the app.
  it('keeps an unplayable live event out of the row while still resolving it by id', async () => {
    matchChannelsForEventMock.mockResolvedValue({ matches: [], apiHasData: true, apiStations: [] })
    const result = await renderReady([
      ninetyEvent({ status: 'live', start_time_utc: new Date(Date.now() - 60_000).toISOString() }),
    ])
    expect(result.current.feed.items.some((item) => item.event.id === 'ninety:evt1')).toBe(false)
    expect(result.current.eventsById.get('ninety:evt1')).toBeDefined()
  })

  it('groups the row into live, then starting soon, then later today', async () => {
    const result = await renderReady([
      ninetyEvent({ id: 'later', start_time_utc: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() }),
      ninetyEvent({ id: 'soon', start_time_utc: new Date(Date.now() + 20 * 60 * 1000).toISOString() }),
      ninetyEvent({ id: 'now', status: 'live', start_time_utc: new Date(Date.now() - 60_000).toISOString() }),
    ])
    expect(result.current.feed.items.map((item) => item.group)).toEqual(['live', 'starting-soon', 'coming-up'])
  })

  // Narrowed to what the viewer follows, and starting where today ends —
  // this is a targeted top-up, not the candidate architecture. When it
  // fires is homeFeedDensity's question; see the density suite below.
  it('follows the primary request with a competition-filtered forward one', async () => {
    getAllEventsMock.mockResolvedValueOnce([])
    getAllEventsMock.mockResolvedValueOnce([ninetyEvent({ id: 'tomorrow' })])
    const { result } = renderHook(() => useHomeFeed(PREFERENCES, STABLE_CHANNELS, NO_XTREAM_CREDENTIALS, null))
    await flush()

    expect(getAllEventsMock.mock.calls).toHaveLength(2)
    expect(getAllEventsMock.mock.calls[1][0].competitionId).toEqual(['comp1'])
    expect(result.current.eventsById.get('ninety:tomorrow')).toBeDefined()
  })

  // Never send an empty competition_id — the backend reads that as "no
  // filter", i.e. every tracked competition for a week.
  it('skips the look-ahead entirely when the viewer follows no competitions', async () => {
    const noFavorites: SportPreferences = { ...PREFERENCES, footballLeagueIds: [] }
    getAllEventsMock.mockResolvedValueOnce([])
    renderHook(() => useHomeFeed(noFavorites, STABLE_CHANNELS, NO_XTREAM_CREDENTIALS, null))
    await flush()
    expect(getAllEventsMock.mock.calls).toHaveLength(1)
  })
})

// ===========================================================================
// OBJECTIVE BROADCAST AVAILABILITY
// ===========================================================================
//
// The wiring, end to end: what reaches the feed, what reaches the hero, and
// — the efficiency half of the feature — which events cost a local
// channel-match attempt at all. matchChannelsForEvent is already mocked at
// the module boundary above, so "was this event matched?" is directly
// observable.
//
// A fixed system time is used throughout so "30 minutes from now" is a real
// near-term, starting-soon fixture rather than the far-future default the
// tests above use.
describe('useHomeFeed — objective broadcast availability', () => {
  const NOW = Date.parse('2026-08-26T19:00:00Z')
  const inMinutes = (n: number) => new Date(NOW + n * 60_000).toISOString()

  // The scenario observed in the real UI, as data.
  const TOTTENHAM_CHARLTON = () =>
    ninetyEvent({
      id: 'tottenham-charlton',
      start_time_utc: inMinutes(30),
      home_team_name: 'Tottenham',
      away_team_name: 'Charlton',
      broadcast_availability: 'CONFIRMED_BROADCAST',
    })
  const BOOTLE_NORTHWICH = (overrides: Partial<NinetyEvent> = {}) =>
    ninetyEvent({
      id: 'bootle-northwich',
      start_time_utc: inMinutes(30),
      home_team_name: 'Bootle',
      away_team_name: 'Northwich Victoria',
      home_team_id: 'team_bootle',
      away_team_id: 'team_northwich',
      broadcast_availability: 'LIKELY_NOT_BROADCAST',
      broadcast_availability_reason: 'no listings found in any tracked market',
      ...overrides,
    })

  const BOOTLE_FAN: SportPreferences = { ...PREFERENCES, favoriteTeamIds: ['team_bootle'] }

  // Which events actually cost a local channel lookup.
  const matchedIds = () => matchChannelsForEventMock.mock.calls.map((call) => (call[0] as { id: string }).id)

  async function renderWith(events: NinetyEvent[], preferences: SportPreferences = PREFERENCES) {
    getAllEventsMock.mockResolvedValueOnce(events)
    const { result } = renderHook(() => useHomeFeed(preferences, STABLE_CHANNELS, NO_XTREAM_CREDENTIALS, null))
    await flush()
    expect(result.current.status).toBe('ready')
    return result
  }

  beforeEach(() => {
    vi.setSystemTime(NOW)
  })

  const feedIds = (result: { current: { feed: { items: { event: { id: string } }[] } } }) =>
    result.current.feed.items.map((item) => item.event.id)

  // TEST 6
  it('drops a LIKELY_NOT_BROADCAST fixture from the feed when no favorite club is playing', async () => {
    const result = await renderWith([TOTTENHAM_CHARLTON(), BOOTLE_NORTHWICH()])
    expect(feedIds(result)).toEqual(['ninety:tottenham-charlton'])
    // Still fetched and still resolvable by id — it was removed from ONE
    // row, not erased from the app (Event Details can still open it).
    expect(result.current.eventsById.get('ninety:bootle-northwich')).toBeDefined()
  })

  // TEST 7
  it('keeps that same fixture in the feed when an explicit favorite club is playing', async () => {
    const result = await renderWith([TOTTENHAM_CHARLTON(), BOOTLE_NORTHWICH()], BOOTLE_FAN)
    expect(feedIds(result)).toContain('ninety:bootle-northwich')
  })

  // TEST 8 — the favorite-club exception buys a feed card, never the hero.
  it('never makes that favorite-club fixture the hero', async () => {
    const result = await renderWith([TOTTENHAM_CHARLTON(), BOOTLE_NORTHWICH()], BOOTLE_FAN)
    expect(result.current.feed.hero?.id).toBe('ninety:tottenham-charlton')
  })

  it('leaves the hero empty rather than featuring it when it is the only fixture', async () => {
    const result = await renderWith([BOOTLE_NORTHWICH()], BOOTLE_FAN)
    expect(result.current.feed.hero).toBeNull()
    expect(result.current.feed.heroIsWatchableNow).toBe(false)
  })

  // TEST 9 — the efficiency win, observed at the matching boundary.
  it('never calls matchChannelsForEvent for a LIKELY_NOT_BROADCAST fixture, favorite club or not', async () => {
    await renderWith([TOTTENHAM_CHARLTON(), BOOTLE_NORTHWICH()], BOOTLE_FAN)
    expect(matchedIds()).toEqual(['ninety:tottenham-charlton'])
    expect(matchedIds()).not.toContain('ninety:bootle-northwich')
  })

  // TEST 10 / TEST 11 / TEST 12
  it('excludes a CONFIRMED_NOT_BROADCAST fixture from the feed and never matches it, favorite club or not', async () => {
    const confirmedNot = BOOTLE_NORTHWICH({ broadcast_availability: 'CONFIRMED_NOT_BROADCAST' })
    for (const preferences of [PREFERENCES, BOOTLE_FAN]) {
      matchChannelsForEventMock.mockClear()
      // eslint-disable-next-line no-await-in-loop
      const result = await renderWith([TOTTENHAM_CHARLTON(), confirmedNot], preferences)
      expect(feedIds(result)).toEqual(['ninety:tottenham-charlton'])
      expect(matchedIds()).not.toContain('ninety:bootle-northwich')
      cleanup()
    }
  })

  // TEST 3 / TEST 4 / TEST 5 — everything that is not a stated negative is
  // matched exactly as before. The UNKNOWN case is the one that matters:
  // absence of evidence must not become a silent short-circuit.
  it.each(['CONFIRMED_BROADCAST', 'LIKELY_BROADCAST', 'UNKNOWN'] as const)(
    'still runs channel matching, and still feeds/heroes, for %s',
    async (availability) => {
      const result = await renderWith([BOOTLE_NORTHWICH({ broadcast_availability: availability })])
      expect(feedIds(result)).toEqual(['ninety:bootle-northwich'])
      expect(result.current.feed.hero?.id).toBe('ninety:bootle-northwich')
      expect(matchedIds()).toEqual(['ninety:bootle-northwich'])
    },
  )

  // TEST 1 — the backwards-compatibility case, which is what this build
  // actually runs against until ninety-api ships its half. No mass
  // disappearance, no skipped matching.
  it('behaves exactly as before against an API that sends no availability field at all', async () => {
    const oldPayload = ninetyEvent({ id: 'old-api', start_time_utc: inMinutes(30) })
    expect('broadcast_availability' in oldPayload).toBe(false)
    const result = await renderWith([oldPayload])
    expect(feedIds(result)).toEqual(['ninety:old-api'])
    expect(result.current.feed.hero?.id).toBe('ninety:old-api')
    expect(matchedIds()).toEqual(['ninety:old-api'])
  })

  // TEST 2 — a classification this build predates must not delete anything.
  it('treats an unrecognized availability value as UNKNOWN rather than hiding the event', async () => {
    const result = await renderWith([
      ninetyEvent({ id: 'future-value', start_time_utc: inMinutes(30), broadcast_availability: 'NOT_A_REAL_STATUS' as never }),
    ])
    expect(feedIds(result)).toEqual(['ninety:future-value'])
    expect(matchedIds()).toEqual(['ninety:future-value'])
  })

  // TEST 19 — the feed's chronological structure survives the new filter.
  it('still groups the surviving events live, then starting soon, then coming up', async () => {
    const result = await renderWith([
      ninetyEvent({ id: 'later', start_time_utc: inMinutes(180) }),
      ninetyEvent({ id: 'soon', start_time_utc: inMinutes(30) }),
      ninetyEvent({ id: 'live', start_time_utc: inMinutes(-35), status: 'live' }),
      BOOTLE_NORTHWICH(),
    ])
    expect(result.current.feed.items.map((item) => [item.event.id, item.group])).toEqual([
      ['ninety:live', 'live'],
      ['ninety:soon', 'starting-soon'],
      ['ninety:later', 'coming-up'],
    ])
  })

  // The observed screenshot, end to end.
  it('produces the expected 20:45-slot feed: the three broadcastable fixtures, and no wasted matching', async () => {
    const result = await renderWith([
      TOTTENHAM_CHARLTON(),
      ninetyEvent({ id: 'newcastle-wba', start_time_utc: inMinutes(30), broadcast_availability: 'LIKELY_BROADCAST' }),
      ninetyEvent({ id: 'longlevens-winslow', start_time_utc: inMinutes(30), broadcast_availability: 'LIKELY_NOT_BROADCAST' }),
      BOOTLE_NORTHWICH(),
      ninetyEvent({ id: 'bradford-burnley', start_time_utc: inMinutes(30) }),
    ])
    expect(feedIds(result).sort()).toEqual(['ninety:bradford-burnley', 'ninety:newcastle-wba', 'ninety:tottenham-charlton'])
    expect(matchedIds().sort()).toEqual(['ninety:bradford-burnley', 'ninety:newcastle-wba', 'ninety:tottenham-charlton'])
  })

  // SECTION 13 — live events. Existing live-feed behaviour is preserved:
  // a live football card with nowhere to watch it stays out of the row. The
  // new layer only decides whether the lookup runs at all.
  it('does not match a LIVE fixture the backend does not expect to be broadcast, so no dead card reaches the row', async () => {
    const result = await renderWith(
      [ninetyEvent({ id: 'live-untelevised', start_time_utc: inMinutes(-35), status: 'live', broadcast_availability: 'LIKELY_NOT_BROADCAST' })],
      BOOTLE_FAN,
    )
    expect(matchedIds()).toEqual([])
    expect(feedIds(result)).toEqual([])
  })

  it('still matches a LIVE fixture with an UNKNOWN verdict and keeps it in the live row', async () => {
    const result = await renderWith([ninetyEvent({ id: 'live-unknown', start_time_utc: inMinutes(-35), status: 'live' })])
    expect(matchedIds()).toEqual(['ninety:live-unknown'])
    expect(result.current.feed.items.map((item) => item.group)).toEqual(['live'])
  })

  // TEST 15 — the country preference narrows which broadcasters come back.
  // It is not an input to the objective verdict, and must not change any of
  // these decisions.
  it('reaches the same decisions with a country preference set as without one', async () => {
    const withCountry: SportPreferences = { ...PREFERENCES, favoriteCountries: ['GB'] }
    const events = [TOTTENHAM_CHARLTON(), BOOTLE_NORTHWICH()]
    const plain = await renderWith(events)
    const plainFeed = feedIds(plain)
    const plainMatched = matchedIds()
    cleanup()
    matchChannelsForEventMock.mockClear()

    const narrowed = await renderWith(events, withCountry)
    expect(feedIds(narrowed)).toEqual(plainFeed)
    expect(matchedIds()).toEqual(plainMatched)
  })
})

// ===========================================================================
// HOME CONTENT MODE
// ===========================================================================
//
// The policy's own rules are unit-tested in homeContentPolicy.test.ts. What
// this suite is for is the WIRING, and specifically the two properties that
// can only fail here:
//
//   the hero and the feed receive the SAME allowed pool, and
//   changing the mode is a local re-derivation, not a refetch.
//
// A fixed system time throughout so "live" and "in 30 minutes" are real
// states rather than the far-future default the tests above use.
describe('useHomeFeed — Home content mode', () => {
  const NOW = Date.parse('2026-08-26T19:00:00Z')
  const inMinutes = (n: number) => new Date(NOW + n * 60_000).toISOString()

  // Two competitions: comp1 is what PREFERENCES follows, comp2 is not.
  const CATALOG: LeagueDef[] = [
    LEAGUE,
    { ...LEAGUE, id: 'comp2', ninetyCompetitionId: 'comp2', name: 'Unfollowed League', tier: 2 },
  ]

  const FOLLOWED = () => ninetyEvent({ id: 'followed', competition_id: 'comp1', start_time_utc: inMinutes(30) })

  // An ordinary fixture in a league the viewer does not follow, between two
  // clubs nobody outside their cities has heard of: excluded by both
  // narrower modes, admitted by 'all'.
  const UNRELATED = (overrides: Partial<NinetyEvent> = {}) =>
    ninetyEvent({
      id: 'unrelated',
      competition_id: 'comp2',
      competition_name: 'Unfollowed League',
      start_time_utc: inMinutes(30),
      home_team_prominence: 0.42,
      away_team_prominence: 0.4,
      ...overrides,
    })

  const withMode = (mode: SportPreferences['homeContentMode']): SportPreferences => ({ ...PREFERENCES, homeContentMode: mode })

  async function renderWith(events: NinetyEvent[], preferences: SportPreferences) {
    getAllEventsMock.mockResolvedValueOnce(events)
    const { result } = renderHook(() => useHomeFeed(preferences, STABLE_CHANNELS, NO_XTREAM_CREDENTIALS, null))
    await flush()
    expect(result.current.status).toBe('ready')
    return result
  }

  const feedIds = (result: { current: { feed: { items: { event: { id: string } }[] } } }) =>
    result.current.feed.items.map((item) => item.event.id)

  beforeEach(() => {
    vi.setSystemTime(NOW)
    loadFootballCompetitionsMock.mockResolvedValue(CATALOG)
  })

  it("'all' keeps an unrelated competition in the feed — today's behaviour, unchanged", async () => {
    const result = await renderWith([FOLLOWED(), UNRELATED()], withMode('all'))
    expect(feedIds(result)).toContain('ninety:unrelated')
  })

  it("'favorites_only' removes it", async () => {
    const result = await renderWith([FOLLOWED(), UNRELATED()], withMode('favorites_only'))
    expect(feedIds(result)).toEqual(['ninety:followed'])
  })

  it("'highlights' removes an ordinary unrelated fixture too", async () => {
    const result = await renderWith([FOLLOWED(), UNRELATED()], withMode('highlights'))
    expect(feedIds(result)).toEqual(['ninety:followed'])
  })

  // Removed from HOME, not erased from the app: Event Details opened from
  // Schedule still has to resolve its freshest version by id.
  it('leaves an excluded event resolvable by id', async () => {
    const result = await renderWith([FOLLOWED(), UNRELATED()], withMode('favorites_only'))
    expect(result.current.eventsById.get('ninety:unrelated')).toBeDefined()
  })

  // THE INVARIANT. A row containing only followed leagues while the hero
  // features something else entirely is the exact failure this layer exists
  // to make impossible, so it is asserted where the two are produced.
  it('never lets an excluded event become the hero, even as the only alternative', async () => {
    const result = await renderWith([UNRELATED()], withMode('favorites_only'))
    expect(result.current.feed.hero).toBeNull()
  })

  it('gives the hero the same pool as the feed when a followed fixture exists', async () => {
    const result = await renderWith(
      [
        FOLLOWED(),
        // Objectively the bigger match, and it would win the hero under
        // 'all' — which is exactly why it has to be gone here.
        UNRELATED({ home_team_prominence: 0.99, away_team_prominence: 0.97 }),
      ],
      withMode('favorites_only'),
    )
    expect(result.current.feed.hero?.id).toBe('ninety:followed')
    expect(feedIds(result)).toEqual(['ninety:followed'])
  })

  // Time decides ranking and eligibility AMONG allowed candidates. It is
  // never a way past the gate.
  it('keeps an excluded LIVE event out of the feed and out of the hero', async () => {
    const result = await renderWith(
      [FOLLOWED(), UNRELATED({ status: 'live', start_time_utc: inMinutes(-30) })],
      withMode('favorites_only'),
    )
    expect(feedIds(result)).toEqual(['ninety:followed'])
    expect(result.current.feed.hero?.id).toBe('ninety:followed')
  })

  it('spends no channel lookup on an excluded event', async () => {
    matchChannelsForEventMock.mockClear()
    await renderWith([FOLLOWED(), UNRELATED({ status: 'live', start_time_utc: inMinutes(-30) })], withMode('favorites_only'))
    const matched = matchChannelsForEventMock.mock.calls.map((call) => (call[0] as { id: string }).id)
    expect(matched).toEqual(['ninety:followed'])
  })

  // F1 remains governed by whether the sport is ENABLED, never by a
  // football league-breadth setting. Choosing "My leagues only" for football
  // must not quietly take the race weekend away with it.
  it('keeps F1 while removing every unrelated football fixture', async () => {
    fetchNextEventsForLeagueMock.mockResolvedValueOnce([
      {
        idEvent: 'race-1',
        strEvent: 'Belgian Grand Prix',
        dateEvent: '2026-08-26',
        strTimestamp: inMinutes(45),
      },
    ])
    const result = await renderWith([UNRELATED()], { ...withMode('favorites_only'), sports: ['football', 'f1'] })
    expect(feedIds(result)).toContain('race-1')
    expect(feedIds(result)).not.toContain('ninety:unrelated')
  })

  // LOCAL DERIVATION, NOT A REFETCH. The mode governs which already-fetched
  // events may be shown, so changing it must re-shape Home with no network
  // round-trip and no loading flash.
  it('re-derives the feed on a mode change without fetching anything again', async () => {
    getAllEventsMock.mockResolvedValueOnce([FOLLOWED(), UNRELATED()])
    const { result, rerender } = renderHook(({ preferences }: { preferences: SportPreferences }) =>
      useHomeFeed(preferences, STABLE_CHANNELS, NO_XTREAM_CREDENTIALS, null),
      { initialProps: { preferences: withMode('all') } },
    )
    await flush()
    expect(feedIds(result)).toContain('ninety:unrelated')
    const callsAfterInitialLoad = getAllEventsMock.mock.calls.length

    rerender({ preferences: withMode('favorites_only') })
    await flush()

    expect(feedIds(result)).toEqual(['ninety:followed'])
    expect(getAllEventsMock.mock.calls).toHaveLength(callsAfterInitialLoad)
    // And never through a loading state, which would blank Home on the way.
    expect(result.current.status).toBe('ready')
  })

  it('widens again just as locally when the mode is relaxed', async () => {
    getAllEventsMock.mockResolvedValueOnce([FOLLOWED(), UNRELATED()])
    const { result, rerender } = renderHook(({ preferences }: { preferences: SportPreferences }) =>
      useHomeFeed(preferences, STABLE_CHANNELS, NO_XTREAM_CREDENTIALS, null),
      { initialProps: { preferences: withMode('favorites_only') } },
    )
    await flush()
    const callsAfterInitialLoad = getAllEventsMock.mock.calls.length

    rerender({ preferences: withMode('all') })
    await flush()

    expect(feedIds(result)).toContain('ninety:unrelated')
    expect(getAllEventsMock.mock.calls).toHaveLength(callsAfterInitialLoad)
  })

  // ===========================================================================
  // DENSITY-AWARE FORWARD EXPANSION
  // ===========================================================================
  //
  // The wiring for homeFeedDensity.ts (whose own arithmetic is unit-tested
  // there). What can only fail HERE is the loop it closes: today's candidates
  // are measured THROUGH the viewer's content policy, and what the forward
  // request brings back goes through that same policy and the same ranking.
  //
  // The old rule fired only on an empty Home, so a single qualifying fixture
  // plus an unrelated F1 card counted as a full screen. These tests pin the
  // replacement: a count against one screenful, and a top-up bounded by it.
  describe('density-aware forward expansion', () => {
    const inDays = (n: number) => new Date(NOW + n * 24 * 60 * 60 * 1000).toISOString()

    // A followed-competition fixture in the forward window.
    const AHEAD = (n: number) => ninetyEvent({ id: `ahead${n}`, competition_id: 'comp1', start_time_utc: inDays(n) })

    // Today's followed fixtures, all still to come.
    const todaysFixtures = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        ninetyEvent({ id: `today${i}`, competition_id: 'comp1', start_time_utc: inMinutes(30 + i * 20) }),
      )

    const forwardRequests = () => getAllEventsMock.mock.calls.filter((call) => call[0]?.competitionId != null)

    async function render(preferences: SportPreferences) {
      const { result } = renderHook(() => useHomeFeed(preferences, STABLE_CHANNELS, NO_XTREAM_CREDENTIALS, null))
      await flush()
      return result
    }

    // THE REPORTED SCREEN. One qualifying Premier League match, one
    // unrelated F1 card, and a "Live now & coming up" row with nothing in
    // it. Not empty — and still four events short of a Home screen.
    it('fires when Home is technically not empty but visibly sparse', async () => {
      fetchNextEventsForLeagueMock.mockResolvedValueOnce([
        { idEvent: 'race-1', strEvent: 'Belgian Grand Prix', dateEvent: '2026-08-26', strTimestamp: inMinutes(45) },
      ])
      getAllEventsMock.mockResolvedValueOnce(todaysFixtures(1))
      getAllEventsMock.mockResolvedValueOnce([AHEAD(1), AHEAD(2)])
      const result = await render({ ...withMode('favorites_only'), sports: ['football', 'f1'] })

      expect(forwardRequests()).toHaveLength(1)
      expect(feedIds(result)).toEqual(expect.arrayContaining(['ninety:ahead1', 'ninety:ahead2']))
    })

    it('does not fire once today already holds a full screenful of visible football', async () => {
      getAllEventsMock.mockResolvedValueOnce(todaysFixtures(MIN_VISIBLE_UPCOMING_FOOTBALL))
      await render(withMode('favorites_only'))
      expect(forwardRequests()).toHaveLength(0)
    })

    // MEASURED THROUGH THE POLICY, NOT OVER THE RAW CANDIDATES. Identical
    // payload, opposite answers — which is why the trigger cannot be moved
    // upstream of homeContentPolicy.
    it('counts what the viewer can actually see, not what was fetched', async () => {
      const unrelated = Array.from({ length: MIN_VISIBLE_UPCOMING_FOOTBALL }, (_, i) =>
        UNRELATED({ id: `unrelated${i}`, start_time_utc: inMinutes(30 + i) }),
      )
      getAllEventsMock.mockResolvedValueOnce(unrelated)
      await render(withMode('all'))
      expect(forwardRequests()).toHaveLength(0)

      cleanup()
      getAllEventsMock.mockClear()
      getAllEventsMock.mockResolvedValueOnce(unrelated)
      await render(withMode('favorites_only'))
      expect(forwardRequests()).toHaveLength(1)
    })

    // ...and the same for the broadcast verdict: a fixture the feed drops
    // as untelevised was never a card either.
    it('does not let fixtures nobody is expected to broadcast stand in for a full screen', async () => {
      getAllEventsMock.mockResolvedValueOnce(
        todaysFixtures(MIN_VISIBLE_UPCOMING_FOOTBALL).map((ev) => ({ ...ev, broadcast_availability: 'CONFIRMED_NOT_BROADCAST' as const })),
      )
      await render(withMode('favorites_only'))
      expect(forwardRequests()).toHaveLength(1)
    })

    // THE CAP, and the promise that this is not Schedule: a week of a
    // followed competition may contribute only what Home was missing.
    it('adds no more than the shortfall, nearest fixtures first', async () => {
      getAllEventsMock.mockResolvedValueOnce(todaysFixtures(1))
      getAllEventsMock.mockResolvedValueOnce([AHEAD(6), AHEAD(5), AHEAD(4), AHEAD(3), AHEAD(2), AHEAD(1)])
      const result = await render(withMode('favorites_only'))

      expect(feedIds(result)).toEqual([
        'ninety:today0',
        'ninety:ahead1',
        'ninety:ahead2',
        'ninety:ahead3',
        'ninety:ahead4',
      ])
    })

    it('asks for a bounded run of local days after today, and only for followed competitions', async () => {
      getAllEventsMock.mockResolvedValueOnce([])
      await render(withMode('favorites_only'))

      const [request] = forwardRequests()[0]
      expect(request.competitionId).toEqual(['comp1'])
      const from = new Date(request.from).getTime()
      const to = new Date(request.to).getTime()
      // Starts where the primary window stopped: the end of the viewer's
      // local day, so the two can never overlap.
      expect(from).toBe(new Date(getAllEventsMock.mock.calls[0][0].to).getTime() + 1)
      expect(Math.round((to - from) / (24 * 60 * 60 * 1000))).toBe(FORWARD_EXPANSION_DAYS)
    })

    it('never lists a fixture twice when both windows return it', async () => {
      getAllEventsMock.mockResolvedValueOnce(todaysFixtures(1))
      getAllEventsMock.mockResolvedValueOnce([...todaysFixtures(1), AHEAD(1)])
      const result = await render(withMode('favorites_only'))
      expect(feedIds(result)).toEqual(['ninety:today0', 'ninety:ahead1'])
    })

    // The forward window holds nothing live and nothing that changes minute
    // to minute, while the state that triggers it lasts all evening — so
    // the ~60s refresh re-measures density every tick without re-asking the
    // same week-long question every tick.
    it('does not re-issue the same forward request on every background refresh', async () => {
      getAllEventsMock.mockResolvedValueOnce(todaysFixtures(1))
      getAllEventsMock.mockResolvedValueOnce([AHEAD(1)])
      const result = await render(withMode('favorites_only'))
      expect(forwardRequests()).toHaveLength(1)

      getAllEventsMock.mockResolvedValue(todaysFixtures(1))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      await flush()

      expect(forwardRequests()).toHaveLength(1)
      // ...and the cached answer is still part of the feed, not dropped on
      // the refresh that reused it.
      expect(feedIds(result)).toContain('ninety:ahead1')
    })

    // The case the old empty-state fallback existed for, which must keep
    // working exactly as it did: a genuinely empty late-evening Home.
    it('still fills an empty Home, and keeps the result resolvable by id', async () => {
      getAllEventsMock.mockResolvedValueOnce([])
      getAllEventsMock.mockResolvedValueOnce([AHEAD(1)])
      const result = await render(withMode('favorites_only'))
      expect(feedIds(result)).toEqual(['ninety:ahead1'])
      expect(result.current.eventsById.get('ninety:ahead1')).toBeDefined()
    })
  })
})
