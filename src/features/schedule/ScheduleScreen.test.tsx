// @vitest-environment jsdom
//
// Screen-level coverage for Schedule, Ninety's day-by-day fixture guide.
// The ranking/grouping rules themselves are covered exhaustively and purely
// in data/sports/scheduleRanking.test.ts, and the day-window arithmetic in
// data/sports/localDay.test.ts; what's asserted here is what those turn into
// on screen — the one-line date navigator, which day is requested, favorite
// competitions first, the country + competition heading, real score/LIVE/FT,
// the FLAT fixture-to-fixture focus chain, and the plain product copy for
// loading/empty/error.
//
// Rendering only: jsdom has no layout, so norigin's GEOMETRIC focus search
// can't be exercised (same reasoning as OnboardingSportsScreen.test.tsx).
// The explicit setFocus/focusable wiring can be, and is — which is exactly
// the wiring that carries the D-pad across a competition boundary and in and
// out of the date bar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { destroy, doesFocusableExist, getCurrentFocusKey, init, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { makeFakeLocalStorage } from '../../core/storage/testFakeLocalStorage'
import { savePreferences, DEFAULT_PREFERENCES } from '../../data/preferences'
import type { LeagueDef } from '../../data/sports/leagues'
import type { SportEvent } from '../../data/sports/types'
import type { ScheduleDayState } from '../../data/sports/useScheduleDay'

// The one network boundary: one day's fixtures. The hook records which day
// it was asked for so the date navigator's effect on the DATA is assertable,
// not just its label.
//
// It is also re-renderable on demand (see deliverDay below): a day's
// fixtures genuinely ARRIVE, some time after the screen is already on
// screen, and "where is focus when they do" is a question this file has to
// be able to ask without changing day to force a re-render.
const requestedOffsets: number[] = []
const dayStates = new Map<number, ScheduleDayState>()
const scheduleSubscribers = new Set<() => void>()
vi.mock('../../data/sports/useScheduleDay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/sports/useScheduleDay')>()
  const { useEffect, useState } = await import('react')
  return {
    ...actual,
    useScheduleDay: (dayOffset: number) => {
      const [, bump] = useState(0)
      useEffect(() => {
        const rerender = () => bump((n) => n + 1)
        scheduleSubscribers.add(rerender)
        return () => {
          scheduleSubscribers.delete(rerender)
        }
      }, [])
      requestedOffsets.push(dayOffset)
      return dayStates.get(dayOffset) ?? { status: 'loading' }
    },
  }
})

const { ScheduleScreen } = await import('./ScheduleScreen')

// Re-run per test (see afterEach) rather than once for the file: the
// spatial-navigation state is a module-level singleton that outlives
// cleanup(), and the focus tests below both depend on and produce focus
// state — see SettingsScreen.test.tsx, where a leaked focus key silently
// changed the section under the next test.
function initSpatialNavigation() {
  init({ debug: false, visualDebug: false })
}
initSpatialNavigation()

// jsdom implements no layout, so it has no scrollIntoView — the shared
// useFocusScrollIntoView hook every focusable here uses would otherwise
// throw on first focus.
Element.prototype.scrollIntoView = () => {}

function league(id: string, name: string, countryCode: string | null, region: string): LeagueDef {
  return {
    id,
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    tsdbSport: 'Soccer',
    name,
    region,
    countryCode,
    badge: `https://example.test/${id}.png`,
  }
}

const CATALOG = new Map<string, LeagueDef>([
  ['football_premier_league', league('football_premier_league', 'Premier League', 'GB', 'England')],
  ['football_la_liga', league('football_la_liga', 'LaLiga', 'ES', 'Spain')],
  ['norway_eliteserien', league('norway_eliteserien', 'Eliteserien', 'NO', 'Norway')],
  ['football_champions_league', league('football_champions_league', 'UEFA Champions League', null, 'Europe')],
  ['tiny_cup', league('tiny_cup', 'Tiny Cup', 'GB', 'England')],
])

function fixture(overrides: Partial<SportEvent> & Pick<SportEvent, 'id' | 'leagueId'>): SportEvent {
  return {
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    league: overrides.leagueId,
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

const ready = (fixtures: SportEvent[]): ScheduleDayState => ({ status: 'ready', fixtures, competitions: CATALOG })

const headings = () => [...document.querySelectorAll('.schedule-competition-title')].map((el) => el.textContent)
const fixtureRows = () => [...document.querySelectorAll('.fixture-row')].map((el) => el.textContent ?? '')
const dayTitle = () => document.querySelector('.schedule-day-title')?.textContent ?? null
const prevArrow = () => document.querySelector('.schedule-day-arrow[aria-label="Previous day"]') as HTMLElement
const nextArrow = () => document.querySelector('.schedule-day-arrow[aria-label="Next day"]') as HTMLElement
const lastRequestedOffset = () => requestedOffsets[requestedOffsets.length - 1]

// Every fixture on the page, in the order it is actually rendered — read
// back off the home half of each row, whose team name is `<id> Home` (see
// the fixture() factory). Derived rather than assumed, because the order is
// the ranking's business (scheduleRanking.test.ts) and a test that hardcoded
// a position would fail for a reason that has nothing to do with focus.
const fixtureIdsInOrder = () =>
  [...document.querySelectorAll('.fixture-row')].map(
    (row) => row.querySelector('.fixture-team-home .fixture-team-name')?.textContent?.replace(/ Home$/, '') ?? '',
  )
const fixtureKey = (id: string, dayOffset = 0) => `schedule-d${dayOffset}-fx-${id}`

const click = async (el: Element | null) => {
  expect(el).toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}

// Presses a remote key on whatever currently has focus, the way the library
// itself dispatches it — the only way to exercise a control whose activation
// must be suppressed when it stops being focusable, and the only way to walk
// the D-pad chain the way a viewer does.
const press = async (key: string, keyCode: number) => {
  await act(async () => {
    fireEvent.keyDown(window, { key, keyCode })
    // The library's key handler and setFocus are both async; a few
    // microtask turns is what it takes for the new focus key to settle.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}
const pressEnter = () => press('Enter', 13)
const pressDown = () => press('ArrowDown', 40)
const pressUp = () => press('ArrowUp', 38)

function renderSchedule(onSelectEvent: (event: SportEvent) => void = () => {}) {
  return render(<ScheduleScreen onSelectEvent={onSelectEvent} onBack={() => {}} />)
}

// Renders AND focuses the screen the way App.tsx does on navigation — it
// targets the screen's own root key (see App's SCREEN_FOCUS_KEYS), which is
// what resolves the container's preferredChildFocusKey. Without this, a
// directly-rendered screen simply has nothing focused, which is a state a
// viewer can never actually be in.
async function enterSchedule(onSelectEvent: (event: SportEvent) => void = () => {}) {
  const result = renderSchedule(onSelectEvent)
  await act(async () => {
    await setFocus('schedule-screen')
  })
  return result
}

// A day's fixtures landing while the screen is already up.
async function deliverDay(dayOffset: number, state: ScheduleDayState) {
  dayStates.set(dayOffset, state)
  await act(async () => {
    for (const rerender of scheduleSubscribers) rerender()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
  savePreferences({ ...DEFAULT_PREFERENCES, footballLeagueIds: [] })
  requestedOffsets.length = 0
  dayStates.clear()
  scheduleSubscribers.clear()
})

afterEach(() => {
  cleanup()
  // Unmounting leaves the library holding the last focus key and a DEBOUNCED
  // (300ms) restore armed for the control that just vanished; carried into
  // the next test, that key is re-claimed the moment something registers
  // under it again. destroy() drops the focus key, the component registry
  // and the key bindings; init() puts them back for the next render.
  destroy()
  initSpatialNavigation()
  vi.unstubAllGlobals()
})

// ONE LINE, and that line is the whole label. The formatting rules
// themselves are pinned against a fixed clock in scheduleDayLabel.test.ts;
// what matters here is that the screen renders exactly one line of it.
describe('Schedule — the date navigator', () => {
  it('opens on today, labelled exactly "Today"', () => {
    renderSchedule()
    expect(dayTitle()).toBe('Today')
    expect(lastRequestedOffset()).toBe(0)
  })

  it('puts nothing under the day name — the label is a single line', () => {
    renderSchedule()
    expect(document.querySelector('.schedule-day-subtitle')).toBeNull()
    expect(document.querySelectorAll('.schedule-day-label > *')).toHaveLength(1)
  })

  it('names tomorrow exactly "Tomorrow"', async () => {
    renderSchedule()
    await click(nextArrow())
    expect(dayTitle()).toBe('Tomorrow')
    expect(document.querySelectorAll('.schedule-day-label > *')).toHaveLength(1)
    expect(lastRequestedOffset()).toBe(1)
  })

  it('names yesterday exactly "Yesterday"', async () => {
    renderSchedule()
    await click(prevArrow())
    expect(dayTitle()).toBe('Yesterday')
    expect(document.querySelectorAll('.schedule-day-label > *')).toHaveLength(1)
    expect(lastRequestedOffset()).toBe(-1)
  })

  it('names a further-out day "<Weekday> dd.mm", with no month word and no year', async () => {
    renderSchedule()
    await click(nextArrow())
    await click(nextArrow())
    expect(dayTitle()).toMatch(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \d{2}\.\d{2}$/)
    expect(lastRequestedOffset()).toBe(2)
  })

  it('browses forward without a ceiling', async () => {
    renderSchedule()
    for (let i = 0; i < 10; i += 1) await click(nextArrow())
    expect(lastRequestedOffset()).toBe(10)
    expect(nextArrow().className).not.toContain('disabled')
  })

  it('comes back to today from tomorrow', async () => {
    renderSchedule()
    await click(nextArrow())
    await click(prevArrow())
    expect(dayTitle()).toBe('Today')
    expect(lastRequestedOffset()).toBe(0)
  })
})

// OPENING SCHEDULE PUTS THE HIGHLIGHT ON THE FIRST GAME.
//
// It used to land on the next-day arrow — the container's mount-time
// fallback — which made a viewer's first press a correction rather than a
// step. The fixtures arrive asynchronously, so this is deliberately two
// mechanisms (see ScheduleScreen's preferredChildFocusKey and its entry
// effect); both orders are exercised below, and so is the case the guard
// exists for.
describe('Schedule — where focus lands on entry', () => {
  const A_DAY = [
    fixture({ id: 'pl-1', leagueId: 'football_premier_league' }),
    fixture({ id: 'pl-2', leagueId: 'football_premier_league' }),
    fixture({ id: 'liga-1', leagueId: 'football_la_liga' }),
  ]

  it('focuses the first rendered fixture once the day arrives', async () => {
    await enterSchedule()
    // Nothing to land on yet — the arrow holds focus while the day loads.
    expect(getCurrentFocusKey()).toBe('schedule-day-next')

    await deliverDay(0, ready(A_DAY))

    expect(getCurrentFocusKey()).toBe(fixtureKey(fixtureIdsInOrder()[0]))
  })

  it('focuses the first fixture immediately when the day is already in hand', async () => {
    dayStates.set(0, ready(A_DAY))
    await enterSchedule()
    expect(getCurrentFocusKey()).toBe(fixtureKey(fixtureIdsInOrder()[0]))
  })

  // Not the arrows, not the day label, not any other page chrome — the
  // things you go to when the answer on screen is not the one you wanted.
  it('lands on a fixture row, never on the date navigator', async () => {
    dayStates.set(0, ready(A_DAY))
    await enterSchedule()
    const landed = getCurrentFocusKey()
    expect(landed).not.toBe('schedule-day-next')
    expect(landed).not.toBe('schedule-day-prev')
    expect(landed).not.toBe('schedule-screen')
    expect(doesFocusableExist(landed)).toBe(true)
    expect(document.querySelector('.fixture-row.focused')).toBeTruthy()
  })

  // THE GUARD. Pressing a date arrow while today is still loading must keep
  // the highlight on that arrow when the fixtures land — otherwise the
  // arrows stop working exactly when they are being used.
  it('does not steal focus back from a viewer who changed day during the load', async () => {
    await enterSchedule()
    expect(getCurrentFocusKey()).toBe('schedule-day-next')
    await pressEnter()
    expect(lastRequestedOffset()).toBe(1)

    // Tomorrow's fixtures land AFTER the viewer has already moved.
    await deliverDay(1, ready(A_DAY))

    expect(getCurrentFocusKey()).toBe('schedule-day-next')
  })

  // Fires once per entry, not once per day: a later day's fixtures arriving
  // is not a fresh entry into the screen.
  it('leaves focus alone when a LATER day loads', async () => {
    dayStates.set(0, ready(A_DAY))
    await enterSchedule()
    expect(getCurrentFocusKey()).toBe(fixtureKey(fixtureIdsInOrder()[0]))

    await act(async () => {
      await setFocus('schedule-day-next')
    })
    await pressEnter()
    await deliverDay(1, ready([fixture({ id: 'ucl-1', leagueId: 'football_champions_league' })]))

    expect(getCurrentFocusKey()).toBe('schedule-day-next')
  })

  // A day with no football on it has no fixture to name, so the arrow keeps
  // the highlight rather than a stale or invented key being targeted.
  it('keeps focus on the date bar for an empty day', async () => {
    dayStates.set(0, ready([]))
    await enterSchedule()
    expect(getCurrentFocusKey()).toBe('schedule-day-next')
  })

  it('keeps focus on the date bar when the day fails to load', async () => {
    dayStates.set(0, { status: 'error', message: 'nope' })
    await enterSchedule()
    expect(getCurrentFocusKey()).toBe('schedule-day-next')
  })
})

describe('Schedule — the backwards boundary is yesterday', () => {
  it('disables the previous-day control once yesterday is showing', async () => {
    renderSchedule()
    await click(prevArrow())
    expect(prevArrow().className).toContain('disabled')
  })

  it('cannot be clicked past yesterday', async () => {
    renderSchedule()
    await click(prevArrow())
    await click(prevArrow())
    await click(prevArrow())
    expect(dayTitle()).toBe('Yesterday')
    expect(lastRequestedOffset()).toBe(-1)
  })

  it('cannot be pressed past yesterday with the remote either', async () => {
    renderSchedule()
    await act(async () => {
      await setFocus('schedule-day-prev')
    })
    await pressEnter()
    expect(dayTitle()).toBe('Yesterday')
    // Put the highlight back on the now-disabled arrow and press again.
    // Nothing happens: the library suppresses Enter for a non-focusable
    // component, so the boundary holds even from there — which is why the
    // control can stay visible instead of vanishing under the viewer.
    await act(async () => {
      await setFocus('schedule-day-prev')
    })
    await pressEnter()
    expect(dayTitle()).toBe('Yesterday')
    expect(lastRequestedOffset()).toBe(-1)
  })

  it('moves focus to the next-day control rather than losing it at the boundary', async () => {
    renderSchedule()
    await act(async () => {
      await setFocus('schedule-day-prev')
    })
    expect(getCurrentFocusKey()).toBe('schedule-day-prev')
    await pressEnter()
    expect(getCurrentFocusKey()).toBe('schedule-day-next')
  })

  it('re-enables going back as soon as the viewer moves forward again', async () => {
    renderSchedule()
    await click(prevArrow())
    await click(nextArrow())
    expect(prevArrow().className).not.toContain('disabled')
  })
})

describe('Schedule — states', () => {
  it('shows a skeleton rather than a blank page while a day loads, keeping the navigator', () => {
    renderSchedule()
    expect(document.querySelector('.schedule-skeleton')).toBeTruthy()
    expect(document.querySelector('.schedule-datebar')).toBeTruthy()
    expect(dayTitle()).toBe('Today')
  })

  it('keeps the date navigator mounted while moving to an unloaded day', async () => {
    dayStates.set(0, ready([fixture({ id: 'a', leagueId: 'football_premier_league' })]))
    renderSchedule()
    await click(nextArrow())
    expect(document.querySelector('.schedule-datebar')).toBeTruthy()
    expect(document.querySelector('.schedule-skeleton')).toBeTruthy()
    expect(dayTitle()).toBe('Tomorrow')
  })

  it('reports a failure in product language, without exposing backend terminology', () => {
    dayStates.set(0, { status: 'error', message: 'ninety-api /v1/events failed: 503' })
    renderSchedule()
    expect(screen.getByText("Unable to load today's fixtures.")).toBeTruthy()
    expect(screen.queryByText(/ninety-api/)).toBeNull()
  })

  it('names the day in its empty state', () => {
    dayStates.set(0, ready([]))
    renderSchedule()
    expect(screen.getByText('No fixtures today.')).toBeTruthy()
  })

  it('names tomorrow naturally in its empty state', async () => {
    dayStates.set(0, ready([]))
    dayStates.set(1, ready([]))
    renderSchedule()
    await click(nextArrow())
    expect(screen.getByText('No fixtures tomorrow.')).toBeTruthy()
  })

  it('names a further-out empty day by its full date', async () => {
    dayStates.set(2, ready([]))
    renderSchedule()
    await click(nextArrow())
    await click(nextArrow())
    expect(
      screen.getByText(/^No fixtures on (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \d{1,2} [A-Z][a-z]+\.$/),
    ).toBeTruthy()
  })
})

describe('Schedule — the whole day, favorites first', () => {
  const FIXTURES = [
    fixture({ id: 'pl-1', leagueId: 'football_premier_league' }),
    fixture({ id: 'cl-1', leagueId: 'football_champions_league', round: 'Semi-finals' }),
    fixture({ id: 'elite-1', leagueId: 'norway_eliteserien', leagueTier: 2 }),
    fixture({ id: 'tiny-1', leagueId: 'tiny_cup', leagueTier: 3 }),
  ]

  it('puts followed competitions above everything else, however big the rest is', () => {
    savePreferences({ ...DEFAULT_PREFERENCES, footballLeagueIds: ['norway_eliteserien', 'tiny_cup'] })
    dayStates.set(0, ready(FIXTURES))
    renderSchedule()
    expect(headings()).toEqual([
      'Norway – Eliteserien',
      'England – Tiny Cup',
      'Europe – UEFA Champions League',
      'England – Premier League',
    ])
  })

  it('keeps every competition on the page — favorites reorder, they never filter', () => {
    savePreferences({ ...DEFAULT_PREFERENCES, footballLeagueIds: ['norway_eliteserien'] })
    dayStates.set(0, ready(FIXTURES))
    renderSchedule()
    expect(headings()).toHaveLength(4)
    expect(fixtureRows()).toHaveLength(4)
  })

  it('has no league-pill filter row at all any more', () => {
    dayStates.set(0, ready(FIXTURES))
    renderSchedule()
    expect(document.querySelectorAll('.league-pill')).toHaveLength(0)
    expect(document.querySelector('.schedule-pills')).toBeNull()
    expect(screen.queryByText('All')).toBeNull()
  })
})

describe('Schedule — competition headings', () => {
  it('names the country and the competition, from the canonical catalog', () => {
    dayStates.set(0, ready([fixture({ id: 'a', leagueId: 'football_la_liga' })]))
    renderSchedule()
    expect(headings()).toEqual(['Spain – LaLiga'])
  })

  it('shows the country flag for a domestic competition', () => {
    dayStates.set(0, ready([fixture({ id: 'a', leagueId: 'norway_eliteserien' })]))
    renderSchedule()
    const flag = document.querySelector('.schedule-competition-flag') as HTMLImageElement
    expect(flag).toBeTruthy()
    expect(flag.src).toContain('flags/NO.svg')
  })

  it('invents no national flag for a supranational competition, using its badge instead', () => {
    dayStates.set(0, ready([fixture({ id: 'a', leagueId: 'football_champions_league' })]))
    renderSchedule()
    expect(document.querySelector('.schedule-competition-flag')).toBeNull()
    expect(document.querySelector('.schedule-competition-badge')).toBeTruthy()
    expect(headings()).toEqual(['Europe – UEFA Champions League'])
  })

  it('falls back to the bare competition name when the catalog has no entry', () => {
    dayStates.set(0, {
      status: 'ready',
      fixtures: [fixture({ id: 'a', leagueId: 'brand_new', league: 'Brand New Cup' })],
      competitions: new Map(),
    })
    renderSchedule()
    expect(headings()).toEqual(['Brand New Cup'])
  })
})

// A competition is a LABEL, not a level of navigation: the header says which
// competition the rows beneath belong to and offers nothing to press. No
// collapsing, no chevron, no focusable — see the focus-graph note at the top
// of ScheduleScreen.tsx.
describe('Schedule — competition headers are informational only', () => {
  const FIXTURES = [
    fixture({ id: 'pl-1', leagueId: 'football_premier_league' }),
    fixture({ id: 'liga-1', leagueId: 'football_la_liga' }),
  ]

  // Located by NAME, never by index — the two competitions here are ranked
  // by prestige, and a test that assumed a position would break for a reason
  // that has nothing to do with the header.
  const header = (name: string) =>
    [...document.querySelectorAll('.schedule-competition-header')].find((el) =>
      el.querySelector('.schedule-competition-title')?.textContent?.includes(name),
    ) ?? null

  it('renders each header as plain, non-interactive DOM', () => {
    dayStates.set(0, ready(FIXTURES))
    renderSchedule()
    const headers = [...document.querySelectorAll('.schedule-competition-header')]
    expect(headers).toHaveLength(2)
    for (const el of headers) {
      expect(el.tagName).toBe('DIV')
      expect(el.getAttribute('role')).toBeNull()
      expect(el.getAttribute('aria-expanded')).toBeNull()
      expect(el.querySelector('button')).toBeNull()
    }
  })

  it('carries no collapse affordance of any kind', () => {
    dayStates.set(0, ready(FIXTURES))
    renderSchedule()
    // The chevron was the only <svg> a header ever contained; the country
    // mark is an <img>.
    expect(document.querySelectorAll('.schedule-competition-header svg')).toHaveLength(0)
    expect(document.querySelector('.schedule-chevron')).toBeNull()
    expect(document.querySelector('.schedule-competition.collapsed')).toBeNull()
  })

  it('registers no focusable for a competition — only its fixtures are targets', () => {
    dayStates.set(0, ready(FIXTURES))
    renderSchedule()
    expect(doesFocusableExist('schedule-d0-comp-football_premier_league')).toBe(false)
    expect(doesFocusableExist('schedule-d0-comp-football_la_liga')).toBe(false)
    expect(doesFocusableExist(fixtureKey('pl-1'))).toBe(true)
    expect(doesFocusableExist(fixtureKey('liga-1'))).toBe(true)
  })

  it('keeps every fixture on screen when a header is activated — there is nothing to collapse', async () => {
    dayStates.set(0, ready(FIXTURES))
    renderSchedule()
    await click(header('Premier League'))
    expect(fixtureRows()).toHaveLength(2)
    expect(doesFocusableExist(fixtureKey('pl-1'))).toBe(true)
    expect(document.querySelector('.schedule-competition.collapsed')).toBeNull()
  })
})

// THE POINT OF THE SCREEN. Every fixture of the day is one flat vertical
// chain; a competition boundary costs zero key presses.
describe('Schedule — the flat fixture chain', () => {
  // One fixture per competition, so EVERY Down in this walk crosses a
  // competition boundary — the exact case the redesign is about.
  const ONE_EACH = [
    fixture({ id: 'pl-1', leagueId: 'football_premier_league' }),
    fixture({ id: 'liga-1', leagueId: 'football_la_liga' }),
    fixture({ id: 'elite-1', leagueId: 'norway_eliteserien', leagueTier: 2 }),
  ]

  // Two competitions of two, for the ordering assertions: the boundary sits
  // between two fixtures that are neighbours in the rendered sequence.
  const TWO_EACH = [
    fixture({ id: 'pl-early', leagueId: 'football_premier_league', dateTimeUtc: '2026-08-26T13:30:00Z' }),
    fixture({ id: 'pl-late', leagueId: 'football_premier_league', dateTimeUtc: '2026-08-26T18:30:00Z' }),
    fixture({ id: 'liga-early', leagueId: 'football_la_liga', dateTimeUtc: '2026-08-26T15:00:00Z' }),
    fixture({ id: 'liga-late', leagueId: 'football_la_liga', dateTimeUtc: '2026-08-26T20:00:00Z' }),
  ]

  it('walks Down from one competition straight into the next, stopping on nothing in between', async () => {
    dayStates.set(0, ready(ONE_EACH))
    renderSchedule()
    const order = fixtureIdsInOrder()
    expect(order).toHaveLength(3)
    expect(headings()).toHaveLength(3)

    await act(async () => {
      await setFocus(fixtureKey(order[0]))
    })
    const visited = [getCurrentFocusKey()]
    await pressDown()
    visited.push(getCurrentFocusKey())
    await pressDown()
    visited.push(getCurrentFocusKey())
    expect(visited).toEqual(order.map((id) => fixtureKey(id)))
  })

  it('walks Up the same chain, competition boundaries included', async () => {
    dayStates.set(0, ready(ONE_EACH))
    renderSchedule()
    const order = fixtureIdsInOrder()

    await act(async () => {
      await setFocus(fixtureKey(order[2]))
    })
    await pressUp()
    expect(getCurrentFocusKey()).toBe(fixtureKey(order[1]))
    await pressUp()
    expect(getCurrentFocusKey()).toBe(fixtureKey(order[0]))
  })

  it('renders every fixture in one continuous sequence, grouped but never interrupted', () => {
    dayStates.set(0, ready(TWO_EACH))
    renderSchedule()
    // Each competition's own fixtures stay together and in kickoff order,
    // and the whole day is four rows with nothing focusable between them.
    expect(fixtureIdsInOrder()).toEqual(['pl-early', 'pl-late', 'liga-early', 'liga-late'])
  })

  it('makes the first fixture of the next competition the immediate neighbour of the last of the previous', async () => {
    dayStates.set(0, ready(TWO_EACH))
    renderSchedule()
    await act(async () => {
      await setFocus(fixtureKey('pl-late'))
    })
    await pressDown()
    expect(getCurrentFocusKey()).toBe(fixtureKey('liga-early'))
    await pressUp()
    expect(getCurrentFocusKey()).toBe(fixtureKey('pl-late'))
  })

  it('goes Down from the date navigator to the first fixture of the day', async () => {
    dayStates.set(0, ready(TWO_EACH))
    renderSchedule()
    await act(async () => {
      await setFocus('schedule-day-next')
    })
    await pressDown()
    expect(getCurrentFocusKey()).toBe(fixtureKey('pl-early'))
  })

  it('goes Down from the previous-day control to the same first fixture', async () => {
    dayStates.set(0, ready(TWO_EACH))
    renderSchedule()
    await act(async () => {
      await setFocus('schedule-day-prev')
    })
    await pressDown()
    expect(getCurrentFocusKey()).toBe(fixtureKey('pl-early'))
  })

  it('goes Up from the first fixture back to the date control the viewer came down from', async () => {
    dayStates.set(0, ready(TWO_EACH))
    renderSchedule()
    await act(async () => {
      await setFocus('schedule-day-prev')
    })
    await pressDown()
    expect(getCurrentFocusKey()).toBe(fixtureKey('pl-early'))
    await pressUp()
    expect(getCurrentFocusKey()).toBe('schedule-day-prev')
  })

  it('targets no content focus key on a day with nothing on it', async () => {
    dayStates.set(0, ready([]))
    renderSchedule()
    await act(async () => {
      await setFocus('schedule-day-next')
    })
    await pressDown()
    expect(getCurrentFocusKey()).toBe('schedule-day-next')
  })

  it('targets no content focus key while a day is still loading', async () => {
    renderSchedule()
    await act(async () => {
      await setFocus('schedule-day-next')
    })
    await pressDown()
    expect(getCurrentFocusKey()).toBe('schedule-day-next')
  })

  it('targets no content focus key when the day failed to load', async () => {
    dayStates.set(0, { status: 'error', message: 'boom' })
    renderSchedule()
    await act(async () => {
      await setFocus('schedule-day-prev')
    })
    await pressDown()
    expect(getCurrentFocusKey()).toBe('schedule-day-prev')
  })
})

describe('Schedule — fixture rows', () => {
  it('shows the kickoff time for a fixture that has not started, and no fabricated score', () => {
    dayStates.set(0, ready([fixture({ id: 's', leagueId: 'tiny_cup', status: 'scheduled', dateTimeUtc: '2026-08-26T18:30:00Z' })]))
    renderSchedule()
    expect(document.querySelector('.fixture-center-value')?.textContent).toMatch(/^\d{2}:\d{2}$/)
    expect(document.querySelector('.fixture-center-status')).toBeNull()
  })

  it('shows the real score and a LIVE marker for a live fixture', () => {
    dayStates.set(
      0,
      ready([fixture({ id: 'l', leagueId: 'tiny_cup', isLive: true, status: 'live', homeScore: '2', awayScore: '1' })]),
    )
    renderSchedule()
    expect(document.querySelector('.fixture-center-value')?.textContent).toBe('2 – 1')
    expect(document.querySelector('.fixture-center-status.live')?.textContent).toContain('LIVE')
  })

  it('says only LIVE for a heuristically-live fixture, never a score it does not have', () => {
    dayStates.set(
      0,
      ready([
        fixture({ id: 'h', leagueId: 'tiny_cup', isLive: true, isLiveHeuristic: true, homeScore: '2', awayScore: '1' }),
      ]),
    )
    renderSchedule()
    expect(document.querySelector('.fixture-center-value')?.textContent).toBe('LIVE')
    expect(document.body.textContent).not.toContain('2 – 1')
  })

  it('marks a finished fixture FT and keeps its final score', () => {
    dayStates.set(
      0,
      ready([fixture({ id: 'f', leagueId: 'tiny_cup', status: 'complete', homeScore: '0', awayScore: '3' })]),
    )
    renderSchedule()
    expect(document.querySelector('.fixture-center-value')?.textContent).toBe('0 – 3')
    expect(document.querySelector('.fixture-center-status')?.textContent).toBe('FT')
  })

  it('renders both teams with their crests', () => {
    dayStates.set(
      0,
      ready([
        fixture({
          id: 'x',
          leagueId: 'tiny_cup',
          homeTeam: 'Aston Villa',
          awayTeam: 'Arsenal',
          homeBadge: 'https://example.test/villa.png',
          awayBadge: 'https://example.test/arsenal.png',
        }),
      ]),
    )
    renderSchedule()
    expect(screen.getByText('Aston Villa')).toBeTruthy()
    expect(screen.getByText('Arsenal')).toBeTruthy()
    expect(document.querySelectorAll('.fixture-crest')).toHaveLength(2)
  })

  it('falls back to the event title when there are not two named sides', () => {
    dayStates.set(
      0,
      ready([fixture({ id: 'odd', leagueId: 'tiny_cup', title: 'Cup Draw', homeTeam: undefined, awayTeam: undefined })]),
    )
    renderSchedule()
    expect(screen.getByText('Cup Draw')).toBeTruthy()
    expect(document.querySelectorAll('.fixture-row')).toHaveLength(1)
  })

  it('opens Event Details from any fixture row', async () => {
    const onSelectEvent = vi.fn()
    dayStates.set(0, ready([fixture({ id: 'x', leagueId: 'tiny_cup' })]))
    renderSchedule(onSelectEvent)
    await click(document.querySelector('.fixture-row'))
    expect(onSelectEvent).toHaveBeenCalledTimes(1)
    expect(onSelectEvent.mock.calls[0][0].id).toBe('x')
  })

  it('puts a live fixture above earlier and later kickoffs inside its own competition', () => {
    dayStates.set(
      0,
      ready([
        fixture({ id: 'late', leagueId: 'tiny_cup', dateTimeUtc: '2026-08-26T21:00:00Z' }),
        fixture({ id: 'early', leagueId: 'tiny_cup', dateTimeUtc: '2026-08-26T12:30:00Z' }),
        fixture({ id: 'live', leagueId: 'tiny_cup', isLive: true, dateTimeUtc: '2026-08-26T19:00:00Z' }),
      ]),
    )
    renderSchedule()
    const rows = fixtureRows()
    expect(rows[0]).toContain('live Home')
    expect(rows[1]).toContain('early Home')
    expect(rows[2]).toContain('late Home')
  })
})

// Schedule answers a SPORTING question, not a TV one, and now says nothing
// about television at all. The broadcast data still rides on SportEvent for
// Event Details to rank streams out of — it simply has no presentation here,
// and it has never decided what appears (see scheduleRanking.test.ts).
describe('Schedule — no broadcast indicator', () => {
  it('shows no TV tag on a fixture the backend says is televised', () => {
    dayStates.set(0, ready([fixture({ id: 'a', leagueId: 'tiny_cup', broadcastAvailability: 'CONFIRMED_BROADCAST' })]))
    renderSchedule()
    expect(document.querySelector('.fixture-row')).toBeTruthy()
    expect(document.querySelector('.fixture-tv-mark')).toBeNull()
    expect(document.querySelector('.fixture-broadcast')).toBeNull()
    expect(document.body.textContent).not.toContain('TV')
  })

  it('shows no TV tag for a fixture whose EPG resolver found a real channel either', () => {
    dayStates.set(
      0,
      ready([
        fixture({
          id: 'a',
          leagueId: 'tiny_cup',
          broadcasts: [{ logicalChannelId: 'c1', name: 'TV 2', country: 'NO', confidence: 0.9, classification: 'CONFIRMED' }],
        }),
      ]),
    )
    renderSchedule()
    expect(document.querySelector('.fixture-tv-mark')).toBeNull()
  })

  it('renders a fixture the backend says is NOT televised exactly like any other', () => {
    dayStates.set(
      0,
      ready([
        fixture({ id: 'off-tv', leagueId: 'tiny_cup', broadcastAvailability: 'CONFIRMED_NOT_BROADCAST' }),
        fixture({ id: 'on-tv', leagueId: 'tiny_cup', broadcastAvailability: 'CONFIRMED_BROADCAST' }),
      ]),
    )
    renderSchedule()
    expect(fixtureRows()).toHaveLength(2)
    expect(document.body.textContent).toContain('off-tv Home')
    expect(document.querySelectorAll('.fixture-tv-mark')).toHaveLength(0)
  })

  it('opens Event Details from an untelevised fixture like any other', async () => {
    const onSelectEvent = vi.fn()
    dayStates.set(0, ready([fixture({ id: 'off-tv', leagueId: 'tiny_cup', broadcastAvailability: 'CONFIRMED_NOT_BROADCAST' })]))
    renderSchedule(onSelectEvent)
    await click(document.querySelector('.fixture-row'))
    expect(onSelectEvent.mock.calls[0][0].id).toBe('off-tv')
  })
})

describe('Schedule — moving between days', () => {
  it('returns the viewport to the top of the new day', async () => {
    dayStates.set(0, ready([fixture({ id: 'a', leagueId: 'tiny_cup' })]))
    dayStates.set(1, ready([fixture({ id: 'b', leagueId: 'tiny_cup' })]))
    renderSchedule()
    // jsdom has no layout, so scrollTop is a permanent 0 — the assertable
    // fact is that the screen (its own scroll owner) is told to go back to
    // the top when the day changes, not that pixels moved.
    const main = document.querySelector('.schedule-screen') as HTMLElement
    const writes: number[] = []
    Object.defineProperty(main, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: (value: number) => writes.push(value),
    })
    await click(nextArrow())
    expect(writes).toContain(0)
  })
})

describe('Schedule — focus on a day change', () => {
  it('leaves focus on the control the viewer just used', async () => {
    dayStates.set(0, ready([fixture({ id: 'a', leagueId: 'tiny_cup' })]))
    dayStates.set(1, ready([fixture({ id: 'b', leagueId: 'tiny_cup' })]))
    renderSchedule()
    await act(async () => {
      await setFocus('schedule-day-next')
    })
    await pressEnter()
    expect(dayTitle()).toBe('Tomorrow')
    expect(getCurrentFocusKey()).toBe('schedule-day-next')
  })

  it('then goes Down into the first fixture of the NEW day', async () => {
    dayStates.set(0, ready([fixture({ id: 'a', leagueId: 'tiny_cup' })]))
    dayStates.set(1, ready([fixture({ id: 'b', leagueId: 'tiny_cup' })]))
    renderSchedule()
    await act(async () => {
      await setFocus('schedule-day-next')
    })
    await pressEnter()
    await pressDown()
    expect(getCurrentFocusKey()).toBe(fixtureKey('b', 1))
  })

  it('registers the new day’s rows under their own focus keys', async () => {
    dayStates.set(0, ready([fixture({ id: 'a', leagueId: 'tiny_cup' })]))
    dayStates.set(1, ready([fixture({ id: 'b', leagueId: 'tiny_cup' })]))
    renderSchedule()
    expect(doesFocusableExist('schedule-d0-fx-a')).toBe(true)
    await click(nextArrow())
    // The new day's rows register under their own keys, and the previous
    // day's are gone rather than lingering as stale focus targets.
    expect(doesFocusableExist('schedule-d1-fx-b')).toBe(true)
    expect(doesFocusableExist('schedule-d0-fx-a')).toBe(false)
    await act(async () => {
      await setFocus('schedule-d1-fx-b')
    })
    expect(getCurrentFocusKey()).toBe('schedule-d1-fx-b')
  })
})
