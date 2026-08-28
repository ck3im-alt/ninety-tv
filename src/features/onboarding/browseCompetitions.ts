// The catalogue model behind onboarding step 2's "Browse more competitions"
// panel: two flat, ordered, paginated competition lists.
//
// WHAT THIS REPLACED, AND WHY. Until 2026-08-28 this file's job was done by
// groupExpandedLeagues.ts + leagueBrowserState.ts, which modelled the
// remaining catalogue as one group per country/region because the browser
// was a master/detail panel with a region rail down its left edge. That
// abstraction existed purely to answer "which region is open"; the rail is
// gone (see CompetitionBrowser.tsx), so the abstraction went with it rather
// than being kept as a fake grouping the UI no longer has.
//
// The reason the rail went: country is too expensive a navigation level.
// Of the 21 countries the real catalogue covers, 13 track exactly ONE
// competition, so picking Argentina meant find country → enter country →
// pick its single league → walk back out, and left a 1380px detail pane
// holding one card. The competition is the thing the viewer is choosing, so
// the competition is now the primary selectable object and each card
// carries its own region as secondary metadata.
//
// Pure and parameterized on the fetched catalog (GET /v1/competitions) —
// this module classifies and orders, it never hardcodes a second league
// list, a competition name, a continent table or a country mapping.
// Everything comes from LeagueDef's own countryCode/region/tier/type, which
// are ninety-api's LeagueConfig fields passed straight through (see
// competitionsCatalog.ts).
import { isSupranationalCompetition } from '../../data/sports/competitionGrouping'
import type { LeagueDef } from '../../data/sports/leagues'
import { homeCountryLeague } from './recommendedLeagues'

// The only two high-level buckets, and deliberately not a continent model:
// "international" is exactly the existing supranational classification
// (competitions the registry gives no country of its own — UEFA, CONMEBOL,
// FIFA), shared with Settings' league browser via competitionGrouping.ts so
// a competition can never be filed differently on the two screens.
// "domestic" is everything else.
export type BrowseScope = 'domestic' | 'international'

// Tab order, left to right.
export const BROWSE_SCOPES: readonly BrowseScope[] = ['domestic', 'international']

export const BROWSE_SCOPE_LABELS: Record<BrowseScope, string> = {
  domestic: 'Domestic',
  international: 'International',
}

// THE PAGE SHAPE, and where the numbers come from.
//
// Six columns because the panel is full width now (no rail): 1728px of
// screen minus the panel's own border and padding leaves ~1702px, so six
// cards land at ~273px each — wide enough for a badge, a two-line
// competition name and a region beneath it at the SAME type sizes the
// recommendations use. Three rows because the leftover height under the
// sports row and the recommendations is ~438px at 1920x1080, which fits
// three ~110px rows plus the header with room to spare. Nothing here was
// derived by shrinking type until a denser grid fit.
//
// 6 x 3 = 18 also happens to page the real catalogue neatly: 36 remaining
// domestic competitions for a viewer whose home league is recommended is
// exactly two pages, and the six remaining international ones are one.
export const BROWSE_GRID_COLUMNS = 6
export const BROWSE_GRID_ROWS = 3
export const BROWSE_PAGE_SIZE = BROWSE_GRID_COLUMNS * BROWSE_GRID_ROWS

export interface BrowseCatalogue {
  domestic: LeagueDef[]
  international: LeagueDef[]
}

interface Options {
  // The full catalog, exactly as fetched.
  leagues: readonly LeagueDef[]
  // Already visible in the pinned "Recommended leagues" row — excluded here
  // so no competition is ever rendered twice, which would also mean two
  // focusables fighting over one `league-<id>` focus key.
  recommendedLeagueIds: readonly string[]
  // Canonical ISO2-ish code for the TV's own country, or null. Only used
  // for ORDER; a competition's own scope never depends on it.
  viewerCountryCode?: string | null
}

const regionOf = (league: LeagueDef): string => league.region ?? 'Other'

// Most important tier first, then actual leagues ahead of cups/qualifiers
// at the same tier. The shared head of both scopes' ordering.
function byTierThenKind(a: LeagueDef, b: LeagueDef): number {
  const tier = (a.tier ?? 9) - (b.tier ?? 9)
  if (tier !== 0) return tier
  return (a.type === 'league' ? 0 : 1) - (b.type === 'league' ? 0 : 1)
}

// Name before id so the visible order is the one a person would predict; id
// last purely so the sort can never depend on the order the API returned.
function byNameThenId(a: LeagueDef, b: LeagueDef): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
}

// The viewer's own domestic region, when it can be derived without
// guessing. Reuses homeCountryLeague — the same resolution that already
// decides which domestic league to RECOMMEND — so "home" means exactly the
// same thing in both places. For GB that resolves to the Premier League and
// therefore 'England' rather than an invented England-vs-Scotland tiebreak
// of this module's own; for a country with no tracked competition it
// resolves to null and the home-first ordering is simply skipped.
function homeRegion(leagues: readonly LeagueDef[], viewerCountryCode: string | null | undefined): string | null {
  return homeCountryLeague(leagues, viewerCountryCode ?? null)?.region ?? null
}

// DOMESTIC ORDER. The viewer's own country first — a Norwegian viewer whose
// Eliteserien is already recommended should still meet whatever else Ninety
// tracks in Norway at the very start of the browser, not buried under
// Argentina — then tier, then leagues before cups, then region and name
// alphabetically, then id as the final deterministic tie-break.
//
// Selection is deliberately NOT an input. Sorting picked competitions to
// the front would make cards move between positions (and between PAGES)
// while the viewer is ticking them, so the tile under the highlight would
// change identity mid-press.
function domesticOrder(home: string | null): (a: LeagueDef, b: LeagueDef) => number {
  return (a, b) => {
    const aHome = home != null && regionOf(a) === home ? 0 : 1
    const bHome = home != null && regionOf(b) === home ? 0 : 1
    return aHome - bHome || byTierThenKind(a, b) || regionOf(a).localeCompare(regionOf(b)) || byNameThenId(a, b)
  }
}

// INTERNATIONAL ORDER. Same idea minus the two rules that mean nothing
// here: a supranational competition has no country to be the viewer's own,
// and its `region` ('Europe', 'International', 'South America') is a
// provider artefact rather than something the viewer navigates by.
function internationalOrder(a: LeagueDef, b: LeagueDef): number {
  return byTierThenKind(a, b) || byNameThenId(a, b)
}

// Everything the browser shows, with recommended competitions removed,
// duplicate ids dropped and both lists deterministically ordered.
export function buildBrowseCatalogue({ leagues, recommendedLeagueIds, viewerCountryCode }: Options): BrowseCatalogue {
  const excluded = new Set(recommendedLeagueIds)
  const seen = new Set<string>()

  const domestic: LeagueDef[] = []
  const international: LeagueDef[] = []
  for (const league of leagues) {
    if (excluded.has(league.id)) continue
    // Defensive: a catalog that ever returned the same id twice must not
    // produce two cards with the same focus key.
    if (seen.has(league.id)) continue
    seen.add(league.id)
    if (isSupranationalCompetition(league)) international.push(league)
    else domestic.push(league)
  }

  return {
    domestic: domestic.sort(domesticOrder(homeRegion(leagues, viewerCountryCode))),
    international: international.sort(internationalOrder),
  }
}

export function competitionsIn(catalogue: BrowseCatalogue, scope: BrowseScope): LeagueDef[] {
  return scope === 'domestic' ? catalogue.domestic : catalogue.international
}

// Which scope tabs to render at all. A scope with nothing left in it after
// the recommendations are removed gets no tab, for the same reason the old
// rail gave no row to a region whose every competition was recommended: a
// tab that opens on an empty grid is pure noise, and per the focus contract
// (tokens.css) anything that cannot be acted on should be out of the
// spatial-nav tree rather than merely dimmed.
export function availableScopes(catalogue: BrowseCatalogue): BrowseScope[] {
  return BROWSE_SCOPES.filter((scope) => competitionsIn(catalogue, scope).length > 0)
}

// The scope the browser should currently show, given whatever the viewer
// last activated.
//
// Domestic is the default: it is both the larger list and the one whose
// ordering is personalised to the viewer, so it is where their own country's
// remaining competitions are. Falls back rather than rendering nothing when
// the remembered scope has emptied out — which genuinely happens, because
// the catalog and the viewer's country both resolve asynchronously and can
// change the lists' shape underneath a remembered value.
export function resolveScope(catalogue: BrowseCatalogue, requested: BrowseScope | null): BrowseScope | null {
  const scopes = availableScopes(catalogue)
  if (requested && scopes.includes(requested)) return requested
  return scopes[0] ?? null
}

// How many pages a scope's list needs. Zero for an empty list — a scope
// that empty has no tab, so the UI never has to render "1 / 0".
export function browsePageCount(competitions: readonly LeagueDef[]): number {
  return Math.ceil(competitions.length / BROWSE_PAGE_SIZE)
}

// Keeps a remembered page inside the current list. Same asynchronous-reshape
// reason as resolveScope: page 1 of a two-page list stops existing the
// moment the viewer's country resolves and moves a competition into the
// recommendations.
export function clampBrowsePage(page: number, competitions: readonly LeagueDef[]): number {
  const last = browsePageCount(competitions) - 1
  if (last < 0) return 0
  return Math.min(Math.max(Math.trunc(page), 0), last)
}

// The competitions on one page — the ONLY ones the browser mounts. The
// whole point of paginating rather than scrolling is that the remaining
// catalogue never becomes 42 live focusables inside a fixed-height panel.
export function browsePage(competitions: readonly LeagueDef[], page: number): LeagueDef[] {
  const start = clampBrowsePage(page, competitions) * BROWSE_PAGE_SIZE
  return competitions.slice(start, start + BROWSE_PAGE_SIZE)
}
