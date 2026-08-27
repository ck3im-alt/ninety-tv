// @vitest-environment jsdom
//
// Coverage for the leagues step's browser: the full catalogue is reachable
// from a page that is exactly one screen tall, one region at a time.
//
// The 2026-08-26 pass removed the "Browse all leagues (N)" expander — the
// panel is simply always there — and moved teams out to a step of their own
// (see OnboardingTeamsScreen.test.tsx). What is asserted here is unchanged
// in spirit: how much gets MOUNTED at once, which is what went wrong with
// the original flat-catalogue design.
//
// Deliberately a RENDERING test, not a focus test. The D-pad geometry is
// covered by focusChain.test.ts (pure) and by the manual 1920x1080 pass;
// jsdom reports every element as 0x0, so norigin's directional search
// cannot be meaningfully exercised in it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { init } from '@noriginmedia/norigin-spatial-navigation'
import { useState } from 'react'
import { TEST_CATALOG } from './testCompetitionCatalog'
import { buildRecommendedLeagues } from './recommendedLeagues'
import { groupExpandedLeagues } from './groupExpandedLeagues'

vi.mock('../../data/sports/useFootballCompetitions', () => ({
  useFootballCompetitions: () => ({ status: 'ready', leagues: TEST_CATALOG }),
}))

const { OnboardingSportsScreen } = await import('./OnboardingSportsScreen')

const VIEWER = 'NO'
const RECOMMENDED = buildRecommendedLeagues(TEST_CATALOG, VIEWER)
const GROUPS = groupExpandedLeagues({
  leagues: TEST_CATALOG,
  recommendedLeagueIds: RECOMMENDED.map((l) => l.id),
  viewerCountryCode: VIEWER,
})
const CATALOGUE_SIZE = GROUPS.reduce((n, g) => n + g.leagues.length, 0)

// A card is a .pick-card carrying this competition's name, on either league
// surface (the pinned row or the browser's grid).
const cardFor = (name: string) =>
  [...document.querySelectorAll('.league-grid .pick-card, .league-browser-grid .pick-card')].find(
    (card) => card.querySelector('.pick-card-label')?.textContent === name,
  ) ?? null

const cardNames = () =>
  [...document.querySelectorAll('.league-grid .pick-card-label, .league-browser-grid .pick-card-label')].map(
    (el) => el.textContent,
  )
const regionRowNames = () => [...document.querySelectorAll('.region-row .region-row-label')].map((el) => el.textContent)
const regionRow = (label: string) =>
  [...document.querySelectorAll('.region-row')].find((row) => row.querySelector('.region-row-label')?.textContent === label)
const activeRegionName = () => document.querySelector('.league-browser-region')?.textContent ?? null

// Drives the screen the way OnboardingFlow does — it owns the selection,
// the screen is a controlled component.
function Harness({ initialLeagues = [], football = true }: { initialLeagues?: string[]; football?: boolean }) {
  const [selectedLeagues, setSelectedLeagues] = useState<Set<string>>(new Set(initialLeagues))
  const [selectedSports, setSelectedSports] = useState<Set<'football' | 'f1'>>(
    new Set(football ? (['football'] as const) : []),
  )
  return (
    <OnboardingSportsScreen
      selectedSports={selectedSports}
      selectedLeagues={selectedLeagues}
      viewerCountryCode={VIEWER}
      onToggleSport={(id) =>
        setSelectedSports((prev) => {
          const next = new Set(prev)
          if (next.has(id as 'football')) next.delete(id as 'football')
          else next.add(id as 'football')
          return next
        })
      }
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
})

afterEach(() => {
  cleanup()
})

describe('the league browser is always open', () => {
  it('shows the recommendations AND one region, with no expander to press', () => {
    render(<Harness />)
    expect(document.querySelector('.league-browser')).toBeTruthy()
    // The control that used to gate this is gone entirely — not hidden.
    expect(document.querySelector('.onboarding-expander')).toBeNull()

    const active = GROUPS.find((g) => g.label === activeRegionName())!
    expect(cardNames()).toEqual([...RECOMMENDED.map((l) => l.name), ...active.leagues.map((l) => l.name)])
  })

  it('mounts one region at a time, nowhere near the whole catalogue', () => {
    render(<Harness />)
    const active = GROUPS.find((g) => g.label === activeRegionName())!
    expect(cardNames().length - RECOMMENDED.length).toBe(active.leagues.length)
    expect(cardNames().length).toBeLessThan(RECOMMENDED.length + CATALOGUE_SIZE)
  })

  it('fits the recommendations on one row', () => {
    render(<Harness />)
    // Eight columns (.league-grid) and at most eight recommendations, so
    // the pinned row never wraps and never becomes a carousel.
    expect(RECOMMENDED.length).toBeLessThanOrEqual(8)
  })

  it('lists every region in the rail, including the ones it is not showing', () => {
    render(<Harness />)
    expect(regionRowNames()).toEqual(GROUPS.map((g) => g.label))
    // A rail row is not a league card — the rail costs nothing like 42 cards.
    expect(document.querySelectorAll('.region-row').length).toBe(GROUPS.length)
  })

  it('gives no rail row to a region whose every competition is recommended', () => {
    render(<Harness />)
    // Norway (Eliteserien) and Spain (La Liga) contribute exactly one
    // competition each in the fixture, and both are recommended for this
    // viewer — an empty "SPAIN" row would be pure noise in a rail the user
    // has to scroll.
    expect(regionRowNames()).not.toContain('Norway')
    expect(regionRowNames()).not.toContain('Spain')
    expect(GROUPS.every((g) => g.leagues.length > 0)).toBe(true)
  })

  it("opens on the viewer's default region rather than the alphabetically first one", () => {
    render(<Harness />)
    expect(activeRegionName()).toBe(GROUPS[0].label)
    // Norway's only competition is recommended, so a Norwegian viewer lands
    // on the international competitions — never on Belgium.
    expect(activeRegionName()).toBe('International competitions')
  })

  it('never repeats a recommended competition inside the browser', async () => {
    render(<Harness />)
    for (const group of GROUPS) {
      await click(regionRow(group.label))
      const names = cardNames()
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('takes the whole league section away when Football is deselected', async () => {
    render(<Harness />)
    const football = [...document.querySelectorAll('.sports-grid .pick-card')].find(
      (card) => card.querySelector('.pick-card-label')?.textContent === 'Football',
    )
    await click(football)
    expect(document.querySelector('.league-browser')).toBeNull()
    expect(document.querySelector('.league-grid')).toBeNull()
  })
})

describe('switching region', () => {
  it('swaps the visible league set', async () => {
    render(<Harness />)
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
    render(<Harness />)
    expect(regionRowNames()).toContain('England')
    expect(regionRowNames()).toContain('Scotland')
    await click(regionRow('Scotland'))
    expect(cardNames()).not.toContain('Championship')
  })

  it('handles a one-competition region as well as a five-competition one', async () => {
    render(<Harness />)
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
    render(<Harness />)
    await click(regionRow('England'))
    await click(cardFor('Championship'))
    expect(cardFor('Championship')?.className).toContain('selected')

    await click(regionRow('Sweden'))
    expect(cardFor('Championship')).toBeNull()

    await click(regionRow('England'))
    expect(cardFor('Championship')?.className).toContain('selected')
  })

  it('shows a per-region count in the rail without lighting the whole row', async () => {
    render(<Harness />)
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

  // THE LAYOUT-JUMP REGRESSION, as far as the DOM can state it.
  //
  // Ticking a league used to make the whole league row jump down and settle
  // back. The cause was never the card: it was that the row BELOW re-keyed
  // into a transient "Loading teams..." line (the followed-league set had
  // changed, so the team catalogue refetched), and onboarding's centred
  // content area moved every row above it to compensate for the lost
  // height. Two fixes, and this asserts the shape of both — teams are a
  // step of their own now, and useTeamCatalog no longer collapses a loaded
  // grid to revalidate it.
  //
  // The invariant that actually matters at 1920x1080: toggling a league
  // adds and removes NO node anywhere on the page. Nothing appears,
  // nothing disappears, so nothing can move.
  it('adds and removes no nodes anywhere when a league is toggled', async () => {
    render(<Harness />)
    await click(regionRow('England'))

    const body = () => document.querySelector('.onboarding-body')!
    // Everything EXCEPT what lives inside a card's checkbox. The tick mark
    // appearing there is the one node this interaction is allowed to add,
    // and it cannot move anything: .pick-card-checkbox is absolutely
    // positioned in a fixed 22px well (onboardingShared.css), so it is out
    // of flow by construction.
    const shape = () =>
      [...body().querySelectorAll('*')].filter((el) => !el.closest('.pick-card-checkbox')).map((el) => el.tagName)
    const labels = () => [...body().querySelectorAll('.pick-card-label')].map((el) => el.textContent)

    const shapeBefore = shape()
    const labelsBefore = labels()
    await click(cardFor('FA Cup'))

    expect(shape()).toEqual(shapeBefore)
    expect(labels()).toEqual(labelsBefore)
    // And in particular: no status line materialized anywhere.
    expect(body().querySelectorAll('.picker-status')).toHaveLength(0)
    // The card itself did change — otherwise this test would pass on a
    // screen where nothing works at all.
    expect(cardFor('FA Cup')?.className).toContain('selected')
  })
})
