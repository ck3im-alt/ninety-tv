// @vitest-environment jsdom
//
// Coverage for the dedicated Teams step (2026-08-26). What it has to get
// right, in order of importance:
//
//   1. League selection PRIORITIZES clubs; it never restricts them. Every
//      competition Ninety tracks is in the rail, with the viewer's own at
//      the top.
//   2. Rosters are fetched one competition at a time, only for the one
//      being looked at — the rail is ~50 rows and fetching all of them up
//      front is not an option.
//   3. The step is genuinely optional: a backend with no /v1/teams route
//      still leaves it completable.
//
// A rendering test, like the leagues step's — jsdom reports every element
// as 0x0, so norigin's directional search can't be exercised in it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { init } from '@noriginmedia/norigin-spatial-navigation'
import { useState } from 'react'
import { TEST_CATALOG } from './testCompetitionCatalog'
import type { TeamDef } from '../../data/sports/teamCatalog'
import type { TeamCatalogState } from '../../data/sports/useTeamCatalog'

vi.mock('../../data/sports/useFootballCompetitions', () => ({
  useFootballCompetitions: () => ({ status: 'ready', leagues: TEST_CATALOG }),
}))

// Both team hooks are network boundaries (GET /v1/teams). Driven explicitly
// so every state — including the "this backend has no team route" one — can
// be exercised without touching the network.
const suggestions = { current: { status: 'ready', teams: [] } as TeamCatalogState }
// Per-competition rosters, plus a log of which competitions were actually
// asked for, which is how the lazy-fetch rule below is asserted.
const rosters = new Map<string, TeamDef[]>()
const requested: string[] = []
let rosterState: TeamCatalogState['status'] = 'ready'

vi.mock('../../data/sports/useTeamCatalog', () => ({
  useTeamCatalog: () => suggestions.current,
  useCompetitionTeams: (competitionId: string | null) => {
    if (!competitionId) return { status: 'ready', teams: [] }
    if (!requested.includes(competitionId)) requested.push(competitionId)
    if (rosterState !== 'ready') return { status: rosterState, message: 'nope' }
    return { status: 'ready', teams: rosters.get(competitionId) ?? [] }
  },
}))

// The screen debounces the rail before fetching; with real timers that
// would make every assertion a race, so the debounce is made a pass-through.
// Its actual behaviour is covered where it lives (useDebouncedValue is used
// identically by the channel browser).
vi.mock('../channels/useDebouncedValue', () => ({ useDebouncedValue: <T,>(value: T) => value }))

const { OnboardingTeamsScreen } = await import('./OnboardingTeamsScreen')

function team(id: string, name: string, domesticCompetitionId: string, prominence = 0.5): TeamDef {
  return { id, name, domesticCompetitionId, prominence }
}

const railNames = () => [...document.querySelectorAll('.team-browser .region-row-label')].map((el) => el.textContent)
const railRow = (label: string) =>
  [...document.querySelectorAll('.team-browser .region-row')].find(
    (row) => row.querySelector('.region-row-label')?.textContent === label,
  )
const activeCompetitionName = () => document.querySelector('.team-browser .league-browser-region')?.textContent ?? null
const suggestedNames = () => [...document.querySelectorAll('.team-grid .pick-card-label')].map((el) => el.textContent)
const browsedNames = () =>
  [...document.querySelectorAll('.league-browser-grid .pick-card-label')].map((el) => el.textContent)
const cardIn = (root: string, name: string) =>
  [...document.querySelectorAll(`${root} .pick-card`)].find(
    (card) => card.querySelector('.pick-card-label')?.textContent === name,
  ) ?? null

function Harness({ initialLeagues = [], initialTeams = [] }: { initialLeagues?: string[]; initialTeams?: string[] }) {
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set(initialTeams))
  return (
    <OnboardingTeamsScreen
      selectedLeagues={new Set(initialLeagues)}
      selectedTeams={selectedTeams}
      onToggleTeam={(id) =>
        setSelectedTeams((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }
      onBack={() => {}}
      onContinue={() => {}}
    />
  )
}

const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  init({ debug: false, visualDebug: false })
  suggestions.current = { status: 'ready', teams: [] }
  rosters.clear()
  requested.length = 0
  rosterState = 'ready'
})

afterEach(() => {
  cleanup()
})

describe('the rail covers the whole catalogue', () => {
  it('lists every competition Ninety tracks, not just the followed ones', () => {
    render(<Harness initialLeagues={['norway-eliteserien']} />)
    expect(railNames()).toHaveLength(TEST_CATALOG.length)
    // The whole point: a viewer following one Norwegian league can still
    // reach an English club from here.
    expect(railNames()).toContain('Premier League')
  })

  it('puts the followed competitions at the top and opens on the first one', () => {
    render(<Harness initialLeagues={['norway-eliteserien']} />)
    expect(railNames()[0]).toBe('Eliteserien')
    expect(activeCompetitionName()).toBe('Eliteserien')
  })

  it('still opens on something when the viewer followed no leagues at all', () => {
    render(<Harness />)
    expect(activeCompetitionName()).toBeTruthy()
    expect(railNames().length).toBeGreaterThan(0)
  })
})

describe('rosters are fetched one competition at a time', () => {
  it('asks only for the competition currently being browsed', () => {
    render(<Harness initialLeagues={['norway-eliteserien']} />)
    expect(requested).toEqual(['norway-eliteserien'])
  })

  it('asks for the next one only when the rail moves to it', async () => {
    rosters.set('football_premier_league', [team('t-city', 'Manchester City', 'football_premier_league')])
    render(<Harness initialLeagues={['norway-eliteserien']} />)
    await click(railRow('Premier League'))
    expect(requested).toEqual(['norway-eliteserien', 'football_premier_league'])
    expect(activeCompetitionName()).toBe('Premier League')
    expect(browsedNames()).toEqual(['Manchester City'])
  })

  it('never renders one competition\'s clubs under another\'s heading', async () => {
    rosters.set('football_premier_league', [team('t-city', 'Manchester City', 'football_premier_league')])
    rosters.set('football_la_liga', [team('t-madrid', 'Real Madrid', 'football_la_liga')])
    render(<Harness />)
    await click(railRow('Premier League'))
    expect(browsedNames()).toEqual(['Manchester City'])
    await click(railRow('La Liga'))
    expect(browsedNames()).toEqual(['Real Madrid'])
  })
})

describe('following clubs', () => {
  it('suggests clubs from the followed leagues, most prominent first', () => {
    suggestions.current = {
      status: 'ready',
      teams: [
        team('t-arsenal', 'Arsenal', 'football_premier_league', 0.8),
        team('t-city', 'Manchester City', 'football_premier_league', 0.95),
      ],
    }
    render(<Harness initialLeagues={['football_premier_league']} />)
    expect(suggestedNames()).toEqual(['Manchester City', 'Arsenal'])
  })

  it('follows a club from the browser and counts it on its rail row', async () => {
    rosters.set('football_premier_league', [team('t-city', 'Manchester City', 'football_premier_league')])
    render(<Harness />)
    await click(railRow('Premier League'))
    await click(cardIn('.league-browser-grid', 'Manchester City'))

    expect(cardIn('.league-browser-grid', 'Manchester City')?.className).toContain('selected')
    expect(railRow('Premier League')?.querySelector('.region-row-selected')?.textContent).toBe('1 followed')
  })

  it('allows several clubs, across competitions', async () => {
    rosters.set('football_premier_league', [team('t-city', 'Manchester City', 'football_premier_league')])
    rosters.set('football_la_liga', [team('t-madrid', 'Real Madrid', 'football_la_liga')])
    render(<Harness />)
    await click(railRow('Premier League'))
    await click(cardIn('.league-browser-grid', 'Manchester City'))
    await click(railRow('La Liga'))
    await click(cardIn('.league-browser-grid', 'Real Madrid'))

    expect(screen.getByText('2 followed')).toBeTruthy()
    expect(cardIn('.league-browser-grid', 'Real Madrid')?.className).toContain('selected')
  })

  it('keeps a followed club selected after browsing away and back', async () => {
    rosters.set('football_premier_league', [team('t-city', 'Manchester City', 'football_premier_league')])
    render(<Harness />)
    await click(railRow('Premier League'))
    await click(cardIn('.league-browser-grid', 'Manchester City'))
    await click(railRow('La Liga'))
    await click(railRow('Premier League'))
    expect(cardIn('.league-browser-grid', 'Manchester City')?.className).toContain('selected')
  })
})

describe('the step is optional', () => {
  // The point of the 'unavailable' state: ninety-api's team route ships
  // separately, and a first-run flow must never be gated on it.
  it('explains itself and stays completable when the backend has no team catalogue', () => {
    suggestions.current = { status: 'unavailable' }
    rosterState = 'unavailable'
    render(<Harness initialLeagues={['football_premier_league']} />)
    expect(screen.getAllByText(/isn't available yet/).length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.team-grid .pick-card')).toHaveLength(0)
    // Continue is still there, still enabled.
    expect(screen.getByText('Continue')).toBeTruthy()
  })

  it('renders a recoverable message rather than an error screen when the fetch fails', () => {
    suggestions.current = { status: 'error', message: 'network down' }
    rosterState = 'error'
    render(<Harness initialLeagues={['football_premier_league']} />)
    expect(screen.getAllByText(/Couldn't load teams/).length).toBeGreaterThan(0)
    expect(screen.getByText('Continue')).toBeTruthy()
  })

  it('points a viewer with no leagues at the browser rather than at a dead end', () => {
    render(<Harness />)
    expect(screen.getByText(/browse any competition below/)).toBeTruthy()
    expect(document.querySelector('.team-browser')).toBeTruthy()
  })
})
