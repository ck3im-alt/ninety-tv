import { describe, expect, it } from 'vitest'
import {
  BROWSE_PAGE_SIZE,
  availableScopes,
  browsePage,
  browsePageCount,
  buildBrowseCatalogue,
  clampBrowsePage,
  competitionsIn,
  resolveScope,
  type BrowseCatalogue,
} from './browseCompetitions'
import { buildRecommendedLeagues } from './recommendedLeagues'
import { BIG_FIVE_COMPETITION_IDS } from '../../data/sports/editorialCompetitions'
import type { LeagueDef } from '../../data/sports/leagues'
import { TEST_CATALOG } from './testCompetitionCatalog'

const build = (recommendedLeagueIds: string[] = [], viewerCountryCode: string | null = null, leagues = TEST_CATALOG) =>
  buildBrowseCatalogue({ leagues, recommendedLeagueIds, viewerCountryCode })

const ids = (leagues: readonly LeagueDef[]) => leagues.map((l) => l.id)
const regions = (leagues: readonly LeagueDef[]) => leagues.map((l) => l.region)

// The realistic shape: the pinned recommendations already removed, for a
// Norwegian viewer (whose only tracked domestic competition IS recommended
// — the case the old region browser had to special-case with an empty
// group).
const NORWEGIAN = () => build(buildRecommendedLeagues(TEST_CATALOG, 'NO').map((l) => l.id), 'NO')

describe('recommended competitions never appear again in Browse More', () => {
  it('drops a recommended domestic competition', () => {
    const catalogue = build(['football_premier_league'])
    expect(ids(catalogue.domestic)).not.toContain('football_premier_league')
    // …but the rest of England is still there.
    expect(ids(catalogue.domestic)).toContain('england-championship')
  })

  it('drops a recommended supranational competition', () => {
    const catalogue = build(['football_champions_league'])
    expect(ids(catalogue.international)).not.toContain('football_champions_league')
    expect(ids(catalogue.international)).toContain('football_europa_league')
  })

  it('renders every catalog competition exactly once across recommended + browse', () => {
    const recommended = buildRecommendedLeagues(TEST_CATALOG, 'NO')
    const catalogue = build(recommended.map((l) => l.id), 'NO')
    const rendered = [...ids(recommended), ...ids(catalogue.domestic), ...ids(catalogue.international)]
    expect(new Set(rendered).size).toBe(rendered.length)
    expect(new Set(rendered)).toEqual(new Set(ids(TEST_CATALOG)))
  })

  it('leaves both lists empty when everything is already recommended', () => {
    const catalogue = build(ids(TEST_CATALOG))
    expect(catalogue).toEqual({ domestic: [], international: [] })
  })

  it('keeps the Big Five and UEFA out for a Norwegian viewer', () => {
    const browsable = [...ids(NORWEGIAN().domestic), ...ids(NORWEGIAN().international)]
    for (const id of BIG_FIVE_COMPETITION_IDS) expect(browsable).not.toContain(id)
    expect(browsable).not.toContain('football_champions_league')
    expect(browsable).not.toContain('norway-eliteserien')
  })
})

describe('duplicate ids', () => {
  it('renders a repeated catalog id only once', () => {
    const duplicated = [...TEST_CATALOG, TEST_CATALOG.find((l) => l.id === 'england-championship')!]
    const catalogue = build([], null, duplicated)
    expect(ids(catalogue.domestic).filter((id) => id === 'england-championship')).toHaveLength(1)
  })
})

describe('domestic vs international', () => {
  it('classifies by the shared supranational rule, not by region strings', () => {
    const catalogue = build()
    // countryCode null — regardless of whether the region says Europe,
    // South America or International.
    expect(ids(catalogue.international)).toContain('football_champions_league') // region 'Europe'
    expect(ids(catalogue.international)).toContain('south-america-copa-libertadores') // region 'South America'
    expect(ids(catalogue.international)).toContain('international-world-cup') // region 'International'
    // …and nothing with a country of its own leaks in.
    expect(catalogue.international.every((l) => l.countryCode == null)).toBe(true)
    expect(catalogue.domestic.every((l) => l.countryCode != null)).toBe(true)
  })

  it('needs no code change for a supranational competition in a new region', () => {
    const withNewRegion: LeagueDef[] = [
      ...TEST_CATALOG,
      {
        id: 'africa-afcon',
        sportKey: 'football',
        sportLabel: 'FOOTBALL',
        tsdbSport: 'Soccer',
        name: 'Africa Cup of Nations',
        region: 'Africa',
        countryCode: null,
        type: 'international',
        tier: 1,
      },
    ]
    const catalogue = build([], null, withNewRegion)
    expect(ids(catalogue.international)).toContain('africa-afcon')
    expect(ids(catalogue.domestic)).not.toContain('africa-afcon')
  })

  it('is FLAT — no country grouping survives anywhere in the model', () => {
    const catalogue = build()
    // Every entry is a competition, not a bucket of them: the old
    // { key, label, leagues[] } group shape is gone.
    for (const league of [...catalogue.domestic, ...catalogue.international]) {
      expect(typeof league.id).toBe('string')
      expect(league).not.toHaveProperty('leagues')
    }
  })

  it('keeps England and Scotland apart through each competition’s own region', () => {
    const catalogue = build()
    const byId = (id: string) => catalogue.domestic.find((l) => l.id === id)
    // Both carry countryCode 'GB'; `region` is what actually distinguishes
    // them, and it is carried on the card rather than collapsed into a
    // "United Kingdom" bucket.
    expect(byId('england-championship')?.region).toBe('England')
    expect(byId('scotland-premiership')?.region).toBe('Scotland')
    expect(regions(catalogue.domestic)).not.toContain('United Kingdom')
  })
})

describe('domestic ordering', () => {
  it("puts the viewer's own region first when it still has competitions", () => {
    // A Spanish viewer: La Liga is recommended, so Spain still contributes
    // nothing else in this fixture — use GB, whose England keeps four.
    const catalogue = build(buildRecommendedLeagues(TEST_CATALOG, 'GB').map((l) => l.id), 'GB')
    const englandCount = catalogue.domestic.filter((l) => l.region === 'England').length
    expect(englandCount).toBeGreaterThan(0)
    expect(regions(catalogue.domestic).slice(0, englandCount).every((r) => r === 'England')).toBe(true)
  })

  it('resolves GB to England (the Premier League’s region), never Scotland', () => {
    const catalogue = build([], 'GB')
    expect(catalogue.domestic[0].region).toBe('England')
  })

  it('skips the home-first rule when the viewer’s region has nothing left', () => {
    // The real Norwegian case: Eliteserien is Norway's only tracked
    // competition and it is recommended, so nothing is pinned to the front
    // and ordering falls through to tier.
    const catalogue = NORWEGIAN()
    expect(regions(catalogue.domestic)).not.toContain('Norway')
    expect(catalogue.domestic[0].tier).toBe(2)
  })

  it('orders by tier, then leagues before cups, then region, then name', () => {
    const catalogue = build([], null)
    const key = (l: LeagueDef) => [l.tier ?? 9, l.type === 'league' ? 0 : 1, l.region ?? '', l.name, l.id]
    const keys = catalogue.domestic.map(key)
    expect(keys).toEqual([...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
    // Spelled out on the two cases that matter: Championship (t2 league)
    // before FA Cup (t2 cup), and Portugal's LigaPro before its Super Cup.
    const order = ids(catalogue.domestic)
    expect(order.indexOf('england-championship')).toBeLessThan(order.indexOf('england-fa-cup'))
    expect(order.indexOf('portugal-ligapro')).toBeLessThan(order.indexOf('portugal-portuguese-super-cup'))
  })

  it('does not use the incoming API order', () => {
    // FA Cup is listed before Scotland's Premiership in the fixture, and
    // EFL League One before Championship — neither survives.
    const order = ids(build().domestic)
    expect(order.indexOf('england-championship')).toBeLessThan(order.indexOf('england-efl-league-one'))
    expect(order.indexOf('scotland-premiership')).toBeLessThan(order.indexOf('england-fa-cup'))
  })

  it('is stable regardless of what the viewer has selected', () => {
    // Selection is not an input to the model at all — the assertion is that
    // there is no way to pass it, and that two builds agree exactly.
    expect(ids(build([], 'GB').domestic)).toEqual(ids(build([], 'GB').domestic))
  })
})

describe('international ordering', () => {
  it('orders by tier, then leagues before cups, then name', () => {
    const catalogue = build()
    const keys = catalogue.international.map((l) => [l.tier ?? 9, l.type === 'league' ? 0 : 1, l.name, l.id])
    expect(keys).toEqual([...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
  })

  it('ignores the viewer’s country, which no supranational competition has', () => {
    expect(ids(build([], 'NO').international)).toEqual(ids(build([], 'BR').international))
  })
})

describe('scopes', () => {
  const empty: BrowseCatalogue = { domestic: [], international: [] }

  it('offers both tabs for the real shape of the catalogue', () => {
    expect(availableScopes(NORWEGIAN())).toEqual(['domestic', 'international'])
  })

  it('offers no tab for a scope with nothing left in it', () => {
    const domesticOnly = build([], null, TEST_CATALOG.filter((l) => l.countryCode != null))
    expect(availableScopes(domesticOnly)).toEqual(['domestic'])
  })

  it('defaults to Domestic', () => {
    expect(resolveScope(NORWEGIAN(), null)).toBe('domestic')
  })

  it('keeps the scope the viewer activated', () => {
    expect(resolveScope(NORWEGIAN(), 'international')).toBe('international')
  })

  it('falls back when the remembered scope has emptied out', () => {
    const internationalOnly = build([], null, TEST_CATALOG.filter((l) => l.countryCode == null))
    expect(resolveScope(internationalOnly, 'domestic')).toBe('international')
  })

  it('is null when there is nothing to browse at all', () => {
    expect(resolveScope(empty, null)).toBeNull()
    expect(resolveScope(empty, 'domestic')).toBeNull()
    expect(availableScopes(empty)).toEqual([])
  })

  it('reads a scope’s list off the catalogue', () => {
    const catalogue = NORWEGIAN()
    expect(competitionsIn(catalogue, 'domestic')).toBe(catalogue.domestic)
    expect(competitionsIn(catalogue, 'international')).toBe(catalogue.international)
  })
})

describe('pagination', () => {
  const list = (n: number): LeagueDef[] =>
    Array.from({ length: n }, (_, i) => ({ ...TEST_CATALOG[0], id: `c${i}`, name: `Competition ${i}` }))

  it('is 18 to a page', () => {
    expect(BROWSE_PAGE_SIZE).toBe(18)
  })

  it('counts pages, with a partial final one', () => {
    expect(browsePageCount([])).toBe(0)
    expect(browsePageCount(list(1))).toBe(1)
    expect(browsePageCount(list(18))).toBe(1)
    expect(browsePageCount(list(19))).toBe(2)
    expect(browsePageCount(list(36))).toBe(2)
  })

  it('slices deterministically and covers the list exactly once', () => {
    const all = list(40)
    const pages = [0, 1, 2].map((p) => browsePage(all, p))
    expect(pages.map((p) => p.length)).toEqual([18, 18, 4])
    expect(pages.flatMap(ids)).toEqual(ids(all))
    // Same input, same pages — every time.
    expect(browsePage(all, 1)).toEqual(pages[1])
  })

  it('clamps a page that no longer exists rather than rendering nothing', () => {
    const all = list(20)
    expect(clampBrowsePage(5, all)).toBe(1)
    expect(clampBrowsePage(-3, all)).toBe(0)
    expect(clampBrowsePage(1, list(10))).toBe(0)
    expect(clampBrowsePage(2, [])).toBe(0)
    expect(browsePage(all, 99)).toEqual(browsePage(all, 1))
  })

  it('pages the real remaining catalogue into a handful of pages, not a document', () => {
    const catalogue = NORWEGIAN()
    expect(browsePageCount(catalogue.domestic)).toBeLessThanOrEqual(3)
    expect(browsePageCount(catalogue.international)).toBeLessThanOrEqual(3)
  })
})
