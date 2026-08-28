// @vitest-environment jsdom
//
// Coverage for the leagues step's browser: the whole catalogue is reachable
// from a page that is exactly one screen tall, one PAGE at a time.
//
// The 2026-08-28 pass removed the region rail. The browser used to be a
// master/detail panel — countries down the left, one country's competitions
// on the right — and is now a flat, paginated, full-width grid under two
// scopes. What is asserted here is unchanged in spirit: how much gets
// MOUNTED at once (which is what went wrong with the original flat
// catalogue), plus the new rules that replaced the region ones — page
// stability, scope classification and focus never being left on a card that
// has just been paged away.
//
// Deliberately mostly a RENDERING test. jsdom reports every element as 0x0,
// so norigin's DIRECTIONAL search cannot be meaningfully exercised in it —
// the D-pad geometry is covered by focusChain.test.ts (pure) and by the
// manual 1920x1080 pass. Explicit setFocus/getCurrentFocusKey does work,
// and is used below for the focus-rescue invariants that matter most.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { destroy, doesFocusableExist, getCurrentFocusKey, init, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useState } from 'react'
import { TEST_CATALOG } from './testCompetitionCatalog'
import { buildRecommendedLeagues } from './recommendedLeagues'
import {
  BROWSE_PAGE_SIZE,
  browsePage,
  browsePageCount,
  buildBrowseCatalogue,
} from './browseCompetitions'
import { leagueFocusKey } from './leagueFocusKeys'

vi.mock('../../data/sports/useFootballCompetitions', () => ({
  useFootballCompetitions: () => ({ status: 'ready', leagues: TEST_CATALOG }),
}))

const { OnboardingSportsScreen } = await import('./OnboardingSportsScreen')

// Norway: the interesting real case. Eliteserien is the country's only
// tracked competition and it is recommended, so the viewer's own region
// contributes nothing to the browser and the ordering falls through to
// tier — and the 36 remaining domestic competitions are exactly two pages.
const VIEWER = 'NO'
const RECOMMENDED = buildRecommendedLeagues(TEST_CATALOG, VIEWER)
const CATALOGUE = buildBrowseCatalogue({
  leagues: TEST_CATALOG,
  recommendedLeagueIds: RECOMMENDED.map((l) => l.id),
  viewerCountryCode: VIEWER,
})
const DOMESTIC_PAGES = browsePageCount(CATALOGUE.domestic)

const names = (leagues: readonly { name: string }[]) => leagues.map((l) => l.name)

// NAME ALONE DOES NOT IDENTIFY A COMPETITION, and the real catalogue proves
// it: Germany's Bundesliga is recommended while Austria's is browsable, and
// the same goes for Italy's and Brazil's Serie A. Anything asserting "this
// competition is / is not on screen" has to say which region it means —
// which is exactly the argument for the browser's cards carrying one.
const identify = (league: { name: string; region?: string }) => `${league.name}|${league.region ?? ''}`
const identities = (leagues: readonly { name: string; region?: string }[]) => leagues.map(identify)
const cardIdentity = (card: Element) =>
  `${card.querySelector('.pick-card-label')?.textContent ?? ''}|${card.querySelector('.pick-card-sublabel')?.textContent ?? ''}`

const ALL_LEAGUE_CARDS = '.league-grid .pick-card, .competition-browser-grid .pick-card'

// A card carrying this competition's name, on either league surface (the
// pinned row or the browser's grid). Only ever called with names that are
// unambiguous in the fixture.
const cardFor = (name: string) =>
  [...document.querySelectorAll(ALL_LEAGUE_CARDS)].find(
    (card) => card.querySelector('.pick-card-label')?.textContent === name,
  ) ?? null

const cardNames = () =>
  [...document.querySelectorAll('.league-grid .pick-card-label, .competition-browser-grid .pick-card-label')].map(
    (el) => el.textContent,
  )
const cardIdentities = () => [...document.querySelectorAll(ALL_LEAGUE_CARDS)].map(cardIdentity)
const browsedCards = () => [...document.querySelectorAll('.competition-browser-grid .pick-card')]
const browsedIdentities = () => browsedCards().map(cardIdentity)
const browsedNames = () =>
  [...document.querySelectorAll('.competition-browser-grid .pick-card-label')].map((el) => el.textContent)
const browsedRegions = () =>
  [...document.querySelectorAll('.competition-browser-grid .pick-card-sublabel')].map((el) => el.textContent)

const scopeTabs = () => [...document.querySelectorAll('.competition-browser-scope')]
const scopeTab = (label: string) => scopeTabs().find((tab) => tab.textContent === label)
const activeScope = () => document.querySelector('.competition-browser-scope.active')?.textContent ?? null
const pageIndicator = () => document.querySelector('.competition-browser-page-count')?.textContent ?? null
const pageArrows = () => [...document.querySelectorAll('.competition-browser-page-arrow')]
const nextPage = () => pageArrows()[1]
const prevPage = () => pageArrows()[0]

// Drives the screen the way OnboardingFlow does — it owns the selection,
// the screen is a controlled component.
function Harness({
  initialLeagues = [],
  football = true,
  viewerCountryCode = VIEWER,
}: {
  initialLeagues?: string[]
  football?: boolean
  viewerCountryCode?: string | null
}) {
  const [selectedLeagues, setSelectedLeagues] = useState<Set<string>>(new Set(initialLeagues))
  const [selectedSports, setSelectedSports] = useState<Set<'football' | 'f1'>>(
    new Set(football ? (['football'] as const) : []),
  )
  return (
    <OnboardingSportsScreen
      selectedSports={selectedSports}
      selectedLeagues={selectedLeagues}
      viewerCountryCode={viewerCountryCode}
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

const focus = async (key: string) => {
  await act(async () => {
    await setFocus(key)
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
  // NOT just cleanup(). norigin's service is a module singleton that
  // remembers the last focused key across init(), and it re-focuses a
  // newly mounted focusable whose key matches (focusOnPresetKey). A test
  // that leaves focus on `browse-scope-international` therefore makes the
  // NEXT test's browser open on International the moment its tabs mount —
  // which is invisible until an assertion about pages suddenly disagrees.
  destroy()
})

describe('the shape of the step', () => {
  it('shows the recommendations AND an always-open browser, with no expander to press', () => {
    render(<Harness />)
    expect(document.querySelector('.competition-browser')).toBeTruthy()
    expect(document.querySelector('.onboarding-expander')).toBeNull()
    expect(cardNames()).toEqual([...names(RECOMMENDED), ...names(browsePage(CATALOGUE.domestic, 0))])
  })

  it('has NO region rail — country is not a navigation level any more', () => {
    render(<Harness />)
    expect(document.querySelectorAll('.region-row')).toHaveLength(0)
    expect(document.querySelector('.league-browser')).toBeNull()
  })

  it('keeps the recommendations on one row of at most eight', () => {
    render(<Harness />)
    // Eight columns (.league-grid) and at most eight recommendations, so
    // the pinned row never wraps and never becomes a carousel.
    expect(RECOMMENDED.length).toBeLessThanOrEqual(8)
    expect(document.querySelectorAll('.league-grid .pick-card')).toHaveLength(RECOMMENDED.length)
  })

  it('keeps the panel as the last child of a browsing body, which is what leaves room for the footer', () => {
    render(<Harness />)
    // jsdom cannot measure 1080px, but it can assert the structure the
    // one-screen CSS rule depends on: the spacers are off (`browsing`) and
    // the panel — the one flex child sized by what is left — is last.
    const body = document.querySelector('.onboarding-body')!
    expect(body.className).toContain('browsing')
    expect(body.lastElementChild?.className).toContain('competition-browser')
    expect(document.querySelector('.onboarding-footer .continue-button')).toBeTruthy()
  })

  it('takes the whole league section away when Football is deselected', async () => {
    render(<Harness />)
    const football = [...document.querySelectorAll('.sports-grid .pick-card')].find(
      (card) => card.querySelector('.pick-card-label')?.textContent === 'Football',
    )
    await click(football)
    expect(document.querySelector('.competition-browser')).toBeNull()
    expect(document.querySelector('.league-grid')).toBeNull()
    expect(document.querySelectorAll('.pick-card')).toHaveLength(2) // the two sports, and nothing else
  })
})

describe('domestic / international scopes', () => {
  it('offers exactly two tabs and opens on Domestic', () => {
    render(<Harness />)
    expect(scopeTabs().map((t) => t.textContent)).toEqual(['Domestic', 'International'])
    expect(activeScope()).toBe('Domestic')
  })

  it('shows the supranational competitions under International, classified by the shared rule', async () => {
    render(<Harness />)
    await click(scopeTab('International'))
    expect(activeScope()).toBe('International')
    expect(browsedNames()).toEqual(names(CATALOGUE.international))
    // Every one of them is a competition the registry gives no country —
    // UEFA, CONMEBOL and FIFA alike, never a continent bucket.
    expect(CATALOGUE.international.every((l) => l.countryCode == null)).toBe(true)
    for (const name of ['World Cup', 'Copa America', 'America Copa Libertadores', 'UEFA Euro Qualifiers']) {
      expect(browsedNames()).toContain(name)
    }
  })

  it('is FLAT under Domestic — every card carries its own region instead', async () => {
    render(<Harness />)
    // No headings, no grouping: 18 sibling cards, several of them from
    // different countries with the same tier.
    expect(browsedNames()).toHaveLength(BROWSE_PAGE_SIZE)
    expect(browsedRegions().length).toBeGreaterThan(0)
    expect(cardFor('Championship')?.querySelector('.pick-card-sublabel')?.textContent).toBe('England')
    expect(cardFor('Pro League')?.querySelector('.pick-card-sublabel')?.textContent).toBe('Belgium')
  })

  it('keeps England and Scotland as their own regions, never "United Kingdom"', async () => {
    render(<Harness />)
    expect(cardFor('Championship')?.querySelector('.pick-card-sublabel')?.textContent).toBe('England')
    expect(cardFor('Premiership')?.querySelector('.pick-card-sublabel')?.textContent).toBe('Scotland')
    await click(nextPage())
    expect(cardFor('Scottish League Cup')?.querySelector('.pick-card-sublabel')?.textContent).toBe('Scotland')
    expect(cardFor('National League')?.querySelector('.pick-card-sublabel')?.textContent).toBe('England')
    expect(browsedRegions()).not.toContain('United Kingdom')
  })

  it("floats the viewer's own remaining competitions to the very front", () => {
    // A UK viewer: the Premier League is recommended, but England still has
    // five competitions left and they lead the browser rather than being
    // buried behind Australia and Austria.
    render(<Harness viewerCountryCode="GB" />)
    expect(browsedRegions().slice(0, 5)).toEqual(['England', 'England', 'England', 'England', 'England'])
  })

  it('skips that rule entirely when the home region has nothing left', () => {
    // Norway's only competition is recommended — no empty NORWAY anything,
    // and the list simply starts at the best remaining tier.
    render(<Harness />)
    expect(browsedRegions()).not.toContain('Norway')
    expect(browsedNames()[0]).toBe(CATALOGUE.domestic[0].name)
  })
})

describe('recommendations are never repeated below', () => {
  it('holds across every page of every scope', async () => {
    render(<Harness />)
    const recommended = new Set(identities(RECOMMENDED))
    for (let page = 0; page < DOMESTIC_PAGES; page++) {
      if (page > 0) await click(nextPage())
      for (const card of browsedIdentities()) expect(recommended.has(card)).toBe(false)
      // …and nothing is rendered twice anywhere on screen, which would mean
      // two focusables fighting over one `league-<id>` key.
      expect(new Set(cardIdentities()).size).toBe(cardIdentities().length)
    }
    await click(scopeTab('International'))
    for (const card of browsedIdentities()) expect(recommended.has(card)).toBe(false)
    expect(new Set(cardIdentities()).size).toBe(cardIdentities().length)
  })

  it('still browses a competition whose NAME a recommended one shares', () => {
    // Germany's Bundesliga is recommended; Austria's is not, and must still
    // be browsable — excluding by name rather than by id would silently
    // swallow it, and the two are told apart on screen only by the region
    // line the compact card carries.
    render(<Harness />)
    expect(cardIdentities()).toContain('Bundesliga|Germany')
    expect(browsedIdentities()).toContain('Bundesliga|Austria')
    expect(cardIdentities()).toContain('Serie A|Italy')
    expect(browsedIdentities()).toContain('Serie A|Brazil')
  })

  it('renders a duplicated catalogue id only once', () => {
    // Guards the dedup all the way through to the DOM, not just in the
    // model: two cards under one focus key is a broken remote, not a
    // cosmetic bug.
    render(<Harness />)
    const all = cardIdentities()
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('pagination', () => {
  it('mounts ONE page, nowhere near the remaining catalogue', () => {
    render(<Harness />)
    expect(CATALOGUE.domestic.length).toBeGreaterThan(BROWSE_PAGE_SIZE)
    expect(document.querySelectorAll('.competition-browser-grid .pick-card')).toHaveLength(BROWSE_PAGE_SIZE)
    expect(pageIndicator()).toBe(`1 / ${DOMESTIC_PAGES}`)
  })

  it('keeps the whole catalogue to a handful of pages', () => {
    render(<Harness />)
    expect(DOMESTIC_PAGES).toBeGreaterThan(1)
    expect(DOMESTIC_PAGES).toBeLessThanOrEqual(3)
  })

  it('replaces the grid in place, with deterministic contents per page', async () => {
    render(<Harness />)
    const first = browsedIdentities()
    await click(nextPage())
    expect(pageIndicator()).toBe(`2 / ${DOMESTIC_PAGES}`)
    expect(browsedIdentities()).toEqual(identities(browsePage(CATALOGUE.domestic, 1)))
    // Page 1's competitions are genuinely gone, not merely scrolled away.
    for (const card of first) expect(browsedIdentities()).not.toContain(card)
    // Still exactly one page's worth of focusables.
    expect(browsedCards().length).toBeLessThanOrEqual(BROWSE_PAGE_SIZE)

    await click(prevPage())
    expect(pageIndicator()).toBe(`1 / ${DOMESTIC_PAGES}`)
    expect(browsedIdentities()).toEqual(first)
  })

  it('does nothing at the ends of the catalogue', async () => {
    render(<Harness />)
    await click(prevPage())
    expect(pageIndicator()).toBe(`1 / ${DOMESTIC_PAGES}`)
    for (let i = 1; i < DOMESTIC_PAGES; i++) await click(nextPage())
    expect(pageIndicator()).toBe(`${DOMESTIC_PAGES} / ${DOMESTIC_PAGES}`)
    await click(nextPage())
    expect(pageIndicator()).toBe(`${DOMESTIC_PAGES} / ${DOMESTIC_PAGES}`)
  })

  it('handles a final page holding a single card', () => {
    // A UK viewer leaves 37 domestic competitions — three pages, the last
    // of which is one card. It must still render, and still be the only
    // thing mounted.
    render(<Harness viewerCountryCode="GB" />)
    const uk = buildBrowseCatalogue({
      leagues: TEST_CATALOG,
      recommendedLeagueIds: buildRecommendedLeagues(TEST_CATALOG, 'GB').map((l) => l.id),
      viewerCountryCode: 'GB',
    })
    const lastPage = browsePageCount(uk.domestic) - 1
    expect(browsePage(uk.domestic, lastPage)).toHaveLength(1)
  })

  it('shows no pager at all for a scope that fits on one page', async () => {
    render(<Harness />)
    await click(scopeTab('International'))
    expect(browsePageCount(CATALOGUE.international)).toBe(1)
    expect(document.querySelector('.competition-browser-pager')).toBeNull()
  })

  it('starts again at page 1 when the scope changes', async () => {
    render(<Harness />)
    await click(nextPage())
    expect(pageIndicator()).toBe(`2 / ${DOMESTIC_PAGES}`)
    await click(scopeTab('International'))
    await click(scopeTab('Domestic'))
    expect(pageIndicator()).toBe(`1 / ${DOMESTIC_PAGES}`)
  })

  it('does NOT start again when the scope you are already on is re-activated', async () => {
    // Every time the viewer steps Up out of the grid, the active tab takes
    // focus and re-activates its own scope. That must not throw away the
    // page they were reading.
    render(<Harness />)
    await click(nextPage())
    await click(scopeTab('Domestic'))
    expect(pageIndicator()).toBe(`2 / ${DOMESTIC_PAGES}`)
  })
})

describe('focus is never left on something that has been paged away', () => {
  it('enters the new page after a page turn', async () => {
    render(<Harness />)
    const leaving = leagueFocusKey(CATALOGUE.domestic[0].id)
    await focus(leaving)
    expect(getCurrentFocusKey()).toBe(leaving)

    await click(nextPage())
    expect(doesFocusableExist(getCurrentFocusKey())).toBe(true)
    // Specifically: the first card of the page just turned to, because the
    // pager entered it from the left edge of row 0.
    expect(getCurrentFocusKey()).toBe(leagueFocusKey(browsePage(CATALOGUE.domestic, 1)[0].id))
  })

  it('lands somewhere mounted after a scope change', async () => {
    render(<Harness />)
    await focus(leagueFocusKey(CATALOGUE.domestic[0].id))
    await click(scopeTab('International'))
    expect(doesFocusableExist(getCurrentFocusKey())).toBe(true)
    expect(getCurrentFocusKey()).toBe('browse-scope-international')
  })

  it('leaves the league surfaces entirely when Football is deselected', async () => {
    render(<Harness />)
    await focus(leagueFocusKey(CATALOGUE.domestic[0].id))
    const footballCard = [...document.querySelectorAll('.sports-grid .pick-card')].find(
      (card) => card.querySelector('.pick-card-label')?.textContent === 'Football',
    )
    await click(footballCard)
    expect(getCurrentFocusKey()).toBe('sport-football')
    expect(doesFocusableExist(getCurrentFocusKey())).toBe(true)
  })
})

describe('selection', () => {
  it('survives paging away and coming back', async () => {
    render(<Harness />)
    await click(cardFor('Championship'))
    expect(cardFor('Championship')?.className).toContain('selected')

    await click(nextPage())
    expect(cardFor('Championship')).toBeNull()

    await click(prevPage())
    expect(cardFor('Championship')?.className).toContain('selected')
  })

  it('survives a round trip through the other scope', async () => {
    render(<Harness />)
    await click(cardFor('Championship'))
    await click(scopeTab('International'))
    await click(cardFor('World Cup'))
    await click(scopeTab('Domestic'))
    expect(cardFor('Championship')?.className).toContain('selected')
    await click(scopeTab('International'))
    expect(cardFor('World Cup')?.className).toContain('selected')
  })

  it('never resorts or repaginates the catalogue', async () => {
    render(<Harness />)
    const before = browsedIdentities()
    const cards = browsedCards()
    // Tick several competitions, including the first and last on the page.
    await click(cards[0])
    await click(cards[cards.length - 1])
    await click(cardFor('Championship'))
    expect(browsedIdentities()).toEqual(before)
    expect(pageIndicator()).toBe(`1 / ${DOMESTIC_PAGES}`)
    // …and page 2 is unchanged too: nothing was pushed across the break.
    await click(nextPage())
    expect(browsedIdentities()).toEqual(identities(browsePage(CATALOGUE.domestic, 1)))
  })

  // THE LAYOUT-JUMP REGRESSION, as far as the DOM can state it.
  //
  // Ticking a league used to make the whole league row jump down and settle
  // back. The cause was never the card: it was that the row BELOW re-keyed
  // into a transient "Loading teams..." line, and onboarding's centred
  // content area moved every row above it to compensate. Two fixes, and
  // this asserts the shape of both — teams are a step of their own now, and
  // the body is permanently in `browsing` mode, which switches the centring
  // spacers off.
  //
  // The invariant that actually matters at 1920x1080: toggling a league adds
  // and removes NO node anywhere on the page. Nothing appears, nothing
  // disappears, so nothing can move — and in particular the browser's own
  // header (tabs, page indicator) is untouched by selection.
  it('adds and removes no nodes anywhere when a league is toggled', async () => {
    render(<Harness />)

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
    const indicatorBefore = pageIndicator()
    await click(cardFor('FA Cup'))

    expect(shape()).toEqual(shapeBefore)
    expect(labels()).toEqual(labelsBefore)
    expect(pageIndicator()).toBe(indicatorBefore)
    // And in particular: no status line materialized anywhere.
    expect(body().querySelectorAll('.picker-status')).toHaveLength(0)
    // The card itself did change — otherwise this test would pass on a
    // screen where nothing works at all.
    expect(cardFor('FA Cup')?.className).toContain('selected')
  })

  it('does not light a scope tab green just because something inside it is picked', async () => {
    render(<Harness />)
    await click(cardFor('Championship'))
    expect(scopeTab('Domestic')?.className).not.toContain('selected')
    expect(scopeTab('International')?.className).not.toContain('selected')
  })
})
