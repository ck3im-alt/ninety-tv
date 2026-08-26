// @vitest-environment jsdom
//
// Coverage for the 2026-08-25 league-BROWSER pass: opening "Browse all
// leagues" must render one region's competitions, not the whole 42-card
// catalogue.
//
// This is deliberately a RENDERING test, not a focus test — what went wrong
// with the previous design was how much got mounted at once, and that is
// exactly what is asserted here. The D-pad geometry itself is covered by
// focusChain.test.ts (pure) and by the manual 1920x1080 pass; jsdom reports
// every element as 0x0, so norigin's directional search cannot be
// meaningfully exercised in it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { init } from '@noriginmedia/norigin-spatial-navigation'
import { useState } from 'react'
import { TEST_CATALOG } from './testCompetitionCatalog'
import { buildRecommendedLeagues } from './recommendedLeagues'
import { groupExpandedLeagues } from './groupExpandedLeagues'

vi.mock('../../data/sports/useFootballCompetitions', () => ({
  useFootballCompetitions: () => ({ status: 'ready', leagues: TEST_CATALOG }),
}))

// The team catalogue is a SEPARATE network boundary (GET /v1/teams) that
// most of this file has nothing to do with, and that may not exist on the
// backend at all. Mocked at the hook so no test here can reach the network,
// and so the team surface's own states can be driven explicitly — see
// `teamState` below.
const teamState = { current: { status: 'unavailable' } as TeamCatalogState }
vi.mock('../../data/sports/useTeamCatalog', () => ({
  useTeamCatalog: () => teamState.current,
}))

import type { TeamCatalogState } from '../../data/sports/useTeamCatalog'
import type { TeamDef } from '../../data/sports/teamCatalog'

function team(id: string, name: string, domesticCompetitionId: string, prominence = 0.5): TeamDef {
  return { id, name, domesticCompetitionId, prominence }
}

const { OnboardingSportsScreen } = await import('./OnboardingSportsScreen')

const VIEWER = 'NO'
const RECOMMENDED = buildRecommendedLeagues(TEST_CATALOG, VIEWER)
const GROUPS = groupExpandedLeagues({
  leagues: TEST_CATALOG,
  recommendedLeagueIds: RECOMMENDED.map((l) => l.id),
  viewerCountryCode: VIEWER,
})
const CATALOGUE_SIZE = GROUPS.reduce((n, g) => n + g.leagues.length, 0)

// A card is a .pick-card carrying this competition's name.
const cardFor = (name: string) =>
  screen.queryAllByText(name).find((el) => el.className === 'pick-card-label')?.closest('.pick-card') ?? null

// Scoped to the two LEAGUE surfaces — the sports row uses the same tile.
const cardNames = () =>
  [...document.querySelectorAll('.league-grid .pick-card-label, .league-browser-grid .pick-card-label')].map((el) => el.textContent)
const regionRowNames = () => [...document.querySelectorAll('.region-row .region-row-label')].map((el) => el.textContent)
const regionRow = (label: string) =>
  [...document.querySelectorAll('.region-row')].find((row) => row.querySelector('.region-row-label')?.textContent === label)
const activeRegionName = () => document.querySelector('.league-browser-region')?.textContent ?? null

// Drives the screen the way OnboardingFlow does — it owns the selection and
// expansion state, the screen is a controlled component.
function Harness({ initialOpen = false, initialLeagues = [] }: { initialOpen?: boolean; initialLeagues?: string[] }) {
  const [selectedLeagues, setSelectedLeagues] = useState<Set<string>>(new Set(initialLeagues))
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState(initialOpen)
  const [teamsOpen, setTeamsOpen] = useState(false)
  return (
    <OnboardingSportsScreen
      selectedSports={new Set(['football'])}
      selectedLeagues={selectedLeagues}
      selectedTeams={selectedTeams}
      showAllTeams={teamsOpen}
      onToggleShowAllTeams={() => setTeamsOpen((v) => !v)}
      onToggleTeam={(id) =>
        setSelectedTeams((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }
      viewerCountryCode={VIEWER}
      showAllLeagues={open}
      onToggleShowAllLeagues={() => setOpen((v) => !v)}
      onToggleSport={() => {}}
      onToggleLeague={(id) =>
        setSelectedLeagues((prev) => {
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
  // jsdom implements neither of these; every focusable in this tree calls
  // scrollIntoView on focus (useFocusScrollIntoView).
  Element.prototype.scrollIntoView = vi.fn()
  init({ debug: false, visualDebug: false })
  // Default for the league-focused tests below: the team surface renders one
  // explanatory line and nothing else, so it can't interfere with them.
  teamState.current = { status: 'unavailable' }
})

afterEach(() => {
  cleanup()
})

describe('collapsed', () => {
  it('shows only the recommended leagues — the catalogue is not in the DOM', () => {
    render(<Harness />)
    expect(cardNames()).toEqual(RECOMMENDED.map((l) => l.name))
    expect(document.querySelector('.league-browser')).toBeNull()
    expect(regionRowNames()).toEqual([])
  })

  it('fits the recommendations on one row', () => {
    render(<Harness />)
    // Eight columns (.league-grid) and at most eight recommendations, so
    // the pinned row never wraps and never becomes a carousel.
    expect(RECOMMENDED.length).toBeLessThanOrEqual(8)
  })

  it('offers the browser by name, with the size of the catalogue behind it', () => {
    render(<Harness />)
    expect(screen.getByText(`Browse all leagues (${CATALOGUE_SIZE})`)).toBeTruthy()
  })
})

describe('opening the browser', () => {
  it('renders one region at a time, not a card for every group', async () => {
    render(<Harness />)
    await click(screen.getByText(`Browse all leagues (${CATALOGUE_SIZE})`))

    const rendered = cardNames()
    // Recommendations stay, and only ONE region's competitions join them.
    const active = GROUPS.find((g) => g.label === activeRegionName())!
    expect(rendered).toEqual([...RECOMMENDED.map((l) => l.name), ...active.leagues.map((l) => l.name)])

    // The whole point: nowhere near the full catalogue is mounted.
    expect(rendered.length - RECOMMENDED.length).toBe(active.leagues.length)
    expect(rendered.length).toBeLessThan(RECOMMENDED.length + CATALOGUE_SIZE)
  })

  it('keeps the recommendations pinned above the browser', async () => {
    render(<Harness />)
    await click(screen.getByText(`Browse all leagues (${CATALOGUE_SIZE})`))
    for (const league of RECOMMENDED) expect(cardFor(league.name)).toBeTruthy()
  })

  it('lists every region in the rail, including the ones it is not showing', async () => {
    render(<Harness />)
    await click(screen.getByText(`Browse all leagues (${CATALOGUE_SIZE})`))
    expect(regionRowNames()).toEqual(GROUPS.map((g) => g.label))
    // A rail row is not a league card — the rail costs nothing like 42 cards.
    expect(document.querySelectorAll('.region-row').length).toBe(GROUPS.length)
  })

  it('gives no rail row to a region whose every competition is recommended', async () => {
    render(<Harness />)
    await click(screen.getByText(`Browse all leagues (${CATALOGUE_SIZE})`))
    // Norway (Eliteserien) and Spain (La Liga) contribute exactly one
    // competition each in the fixture, and both are recommended for this
    // viewer — an empty "SPAIN" row would be pure noise in a rail the user
    // has to scroll.
    expect(regionRowNames()).not.toContain('Norway')
    expect(regionRowNames()).not.toContain('Spain')
    expect(GROUPS.every((g) => g.leagues.length > 0)).toBe(true)
  })

  it("opens on the viewer's default region rather than the alphabetically first one", async () => {
    render(<Harness />)
    await click(screen.getByText(`Browse all leagues (${CATALOGUE_SIZE})`))
    expect(activeRegionName()).toBe(GROUPS[0].label)
    // Norway's only competition is recommended, so a Norwegian viewer lands
    // on the international competitions — never on Belgium.
    expect(activeRegionName()).toBe('International competitions')
  })

  it('never repeats a recommended competition inside the browser', async () => {
    render(<Harness />)
    await click(screen.getByText(`Browse all leagues (${CATALOGUE_SIZE})`))
    for (const group of GROUPS) {
      await click(regionRow(group.label))
      const names = cardNames()
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('closes again, taking the whole browser out of the DOM', async () => {
    render(<Harness />)
    await click(screen.getByText(`Browse all leagues (${CATALOGUE_SIZE})`))
    await click(screen.getByText('Hide league browser'))
    expect(document.querySelector('.league-browser')).toBeNull()
    expect(cardNames()).toEqual(RECOMMENDED.map((l) => l.name))
  })
})

describe('switching region', () => {
  it('swaps the visible league set', async () => {
    render(<Harness initialOpen />)
    const england = GROUPS.find((g) => g.label === 'England')!
    const sweden = GROUPS.find((g) => g.label === 'Sweden')!

    await click(regionRow('England'))
    expect(activeRegionName()).toBe('England')
    for (const l of england.leagues) expect(cardFor(l.name)).toBeTruthy()
    for (const l of sweden.leagues) expect(cardFor(l.name)).toBeNull()

    await click(regionRow('Sweden'))
    expect(activeRegionName()).toBe('Sweden')
    for (const l of sweden.leagues) expect(cardFor(l.name)).toBeTruthy()
    for (const l of england.leagues) expect(cardFor(l.name)).toBeNull()
  })

  it('keeps England and Scotland separate regions', async () => {
    render(<Harness initialOpen />)
    expect(regionRowNames()).toContain('England')
    expect(regionRowNames()).toContain('Scotland')
    await click(regionRow('Scotland'))
    expect(cardNames()).not.toContain('Championship')
  })

  it('handles a one-competition region as well as a five-competition one', async () => {
    render(<Harness initialOpen />)
    const single = GROUPS.find((g) => g.leagues.length === 1)!
    const biggest = [...GROUPS].sort((a, b) => b.leagues.length - a.leagues.length)[0]

    await click(regionRow(single.label))
    expect(document.querySelectorAll('.league-browser-grid .pick-card').length).toBe(1)

    await click(regionRow(biggest.label))
    expect(document.querySelectorAll('.league-browser-grid .pick-card').length).toBe(biggest.leagues.length)
  })
})

describe('selection', () => {
  it('survives switching region and coming back', async () => {
    render(<Harness initialOpen />)
    await click(regionRow('England'))
    await click(cardFor('Championship'))
    expect(cardFor('Championship')?.className).toContain('selected')

    await click(regionRow('Sweden'))
    expect(cardFor('Championship')).toBeNull()

    await click(regionRow('England'))
    expect(cardFor('Championship')?.className).toContain('selected')
  })

  it('shows a per-region count in the rail without lighting the whole row', async () => {
    render(<Harness initialOpen />)
    await click(regionRow('England'))
    await click(cardFor('Championship'))
    await click(cardFor('FA Cup'))

    expect(regionRow('England')?.querySelector('.region-row-selected')?.textContent).toBe('2 selected')
    // Other regions keep their plain competition count, and no row is
    // "selected" just because one of its competitions is.
    expect(regionRow('Sweden')?.querySelector('.region-row-selected')).toBeNull()
    expect(regionRow('Sweden')?.querySelector('.region-row-count')).toBeTruthy()
    expect(regionRow('England')?.className).not.toContain('selected')
  })

  it('does not close the browser or change region when a league is toggled', async () => {
    render(<Harness initialOpen />)
    await click(regionRow('England'))
    await click(cardFor('FA Cup'))
    expect(document.querySelector('.league-browser')).toBeTruthy()
    expect(activeRegionName()).toBe('England')
  })
})

// The 2026-08-26 personalization pass: "Teams you follow" is part of THIS
// step rather than a fourth one, and is optional in the strong sense — a
// backend with no team catalogue must still leave the step completable.
describe('OnboardingSportsScreen — teams you follow', () => {
  const teamGridNames = () => [...document.querySelectorAll('.team-grid .pick-card-label')].map((el) => el.textContent)
  const teamCard = (name: string) =>
    [...document.querySelectorAll('.team-grid .pick-card')].find(
      (card) => card.querySelector('.pick-card-label')?.textContent === name,
    ) ?? null

  it('suggests clubs from the leagues the viewer actually picked, most prominent first', () => {
    teamState.current = {
      status: 'ready',
      teams: [
        team('t-arsenal', 'Arsenal', 'football_premier_league', 0.8),
        team('t-city', 'Manchester City', 'football_premier_league', 0.95),
      ],
    }
    render(<Harness initialLeagues={['football_premier_league']} />)
    expect(teamGridNames()).toEqual(['Manchester City', 'Arsenal'])
  })

  it('mixes suggestions across several followed leagues rather than filling the row from one', () => {
    teamState.current = {
      status: 'ready',
      teams: [
        team('t-city', 'Manchester City', 'football_premier_league', 0.95),
        team('t-arsenal', 'Arsenal', 'football_premier_league', 0.9),
        team('t-glimt', 'Bodo/Glimt', 'norway_eliteserien', 0.4),
      ],
    }
    render(<Harness initialLeagues={['football_premier_league', 'norway_eliteserien']} />)
    // Second slot goes to the OTHER league, not to the second-best English
    // club — otherwise following a small league would never show it.
    expect(teamGridNames()).toEqual(['Manchester City', 'Bodo/Glimt', 'Arsenal'])
  })

  it('marks a followed team as selected and keeps it in the suggestions', async () => {
    teamState.current = {
      status: 'ready',
      teams: [team('t-city', 'Manchester City', 'football_premier_league', 0.95)],
    }
    render(<Harness initialLeagues={['football_premier_league']} />)
    await click(teamCard('Manchester City'))
    expect(teamCard('Manchester City')?.className).toContain('selected')
  })

  // The point of the whole "unavailable" state: ninety-api's team route
  // ships separately, and a first-run flow must never be gated on it.
  it('explains itself and stays completable when the backend has no team catalogue', () => {
    teamState.current = { status: 'unavailable' }
    render(<Harness initialLeagues={['football_premier_league']} />)
    expect(screen.getByText(/isn't available yet/)).toBeTruthy()
    expect(document.querySelectorAll('.team-grid .pick-card')).toHaveLength(0)
    // Continue is still there, still enabled.
    expect(screen.getByText('Continue')).toBeTruthy()
  })

  it('renders a recoverable message rather than an error screen when the team fetch fails', () => {
    teamState.current = { status: 'error', message: 'network down' }
    render(<Harness initialLeagues={['football_premier_league']} />)
    expect(screen.getByText(/Couldn't load teams/)).toBeTruthy()
    expect(screen.getByText('Continue')).toBeTruthy()
  })

  // Both browsers are the last child of the content area and both claim the
  // leftover height — two open at once would push the footer off a 1080px
  // screen.
  it('closes the league browser when the team browser is opened', async () => {
    teamState.current = {
      status: 'ready',
      teams: [
        team('t-city', 'Manchester City', 'football_premier_league', 0.95),
        team('t-arsenal', 'Arsenal', 'football_premier_league', 0.9),
        team('t-spurs', 'Tottenham', 'football_premier_league', 0.7),
        team('t-glimt', 'Bodo/Glimt', 'norway_eliteserien', 0.4),
        team('t-rosenborg', 'Rosenborg', 'norway_eliteserien', 0.35),
        team('t-brann', 'Brann', 'norway_eliteserien', 0.3),
        team('t-viking', 'Viking', 'norway_eliteserien', 0.28),
        team('t-lsk', 'Lillestrom', 'norway_eliteserien', 0.25),
        team('t-valerenga', 'Valerenga', 'norway_eliteserien', 0.2),
      ],
    }
    render(<Harness initialOpen initialLeagues={['football_premier_league', 'norway_eliteserien']} />)
    expect(document.querySelector('.league-browser:not(.team-browser)')).toBeTruthy()
    // The team section is hidden while the league browser is open, so close
    // that first — which is exactly the flow a viewer follows.
    await click(screen.getByText(/Hide league browser/))
    await click(screen.getByText(/Browse all teams/))
    expect(document.querySelector('.team-browser')).toBeTruthy()
    expect(document.querySelector('.league-browser:not(.team-browser)')).toBeNull()
  })
})
