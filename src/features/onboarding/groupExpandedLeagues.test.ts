import { describe, expect, it } from 'vitest'
import { INTERNATIONAL_GROUP_LABEL, groupExpandedLeagues } from './groupExpandedLeagues'
import { BIG_FIVE_COMPETITION_IDS, buildRecommendedLeagues } from './recommendedLeagues'
import { TEST_CATALOG } from './testCompetitionCatalog'

import type { LeagueGroup } from './groupExpandedLeagues'

const labels = (groups: LeagueGroup[]) => groups.map((g) => g.label)
const groupNamed = (groups: LeagueGroup[], label: string) => groups.find((g) => g.label === label)
const idsIn = (groups: LeagueGroup[], label: string) => groupNamed(groups, label)?.leagues.map((l) => l.id) ?? []

describe('recommended leagues are never duplicated in the catalogue', () => {
  it('drops a recommended competition from its domestic group', () => {
    const groups = groupExpandedLeagues({
      leagues: TEST_CATALOG,
      recommendedLeagueIds: ['football_premier_league'],
    })
    expect(idsIn(groups, 'England')).not.toContain('football_premier_league')
    // …but the rest of England is still there.
    expect(idsIn(groups, 'England')).toContain('england-championship')
  })

  it('drops a recommended UEFA competition from International competitions', () => {
    const groups = groupExpandedLeagues({
      leagues: TEST_CATALOG,
      recommendedLeagueIds: ['football_champions_league'],
    })
    expect(idsIn(groups, INTERNATIONAL_GROUP_LABEL)).not.toContain('football_champions_league')
    expect(idsIn(groups, INTERNATIONAL_GROUP_LABEL)).toContain('football_europa_league')
  })

  it('renders every catalog competition exactly once across recommended + groups', () => {
    const recommended = buildRecommendedLeagues(TEST_CATALOG, 'NO')
    const groups = groupExpandedLeagues({
      leagues: TEST_CATALOG,
      recommendedLeagueIds: recommended.map((l) => l.id),
      viewerCountryCode: 'NO',
    })
    const rendered = [...recommended.map((l) => l.id), ...groups.flatMap((g) => g.leagues.map((l) => l.id))]
    expect(new Set(rendered).size).toBe(rendered.length)
    expect(new Set(rendered)).toEqual(new Set(TEST_CATALOG.map((l) => l.id)))
  })

  it('leaves the catalogue empty when everything is already recommended', () => {
    const groups = groupExpandedLeagues({
      leagues: TEST_CATALOG,
      recommendedLeagueIds: TEST_CATALOG.map((l) => l.id),
    })
    expect(groups).toEqual([])
  })
})

describe('international grouping', () => {
  it('puts a countryCode-null / region Europe competition in International competitions', () => {
    const groups = groupExpandedLeagues({ leagues: TEST_CATALOG, recommendedLeagueIds: [] })
    expect(idsIn(groups, INTERNATIONAL_GROUP_LABEL)).toContain('football_champions_league')
    expect(idsIn(groups, INTERNATIONAL_GROUP_LABEL)).toContain('football_europa_league')
  })

  it('groups every other supranational region into the same bucket, not per-region ones', () => {
    const groups = groupExpandedLeagues({ leagues: TEST_CATALOG, recommendedLeagueIds: [] })
    expect(idsIn(groups, INTERNATIONAL_GROUP_LABEL)).toContain('south-america-copa-libertadores') // region 'South America'
    expect(idsIn(groups, INTERNATIONAL_GROUP_LABEL)).toContain('international-world-cup') // region 'International'
    expect(labels(groups)).not.toContain('Europe')
    expect(labels(groups)).not.toContain('South America')
  })

  it('classifies by countryCode alone, so a new supranational region needs no code change', () => {
    const withNewRegion = [
      ...TEST_CATALOG,
      {
        id: 'africa-afcon',
        sportKey: 'football' as const,
        sportLabel: 'FOOTBALL',
        tsdbSport: 'Soccer',
        name: 'Africa Cup of Nations',
        region: 'Africa',
        countryCode: null,
        type: 'international' as const,
        tier: 1 as const,
      },
    ]
    const groups = groupExpandedLeagues({ leagues: withNewRegion, recommendedLeagueIds: [] })
    expect(idsIn(groups, INTERNATIONAL_GROUP_LABEL)).toContain('africa-afcon')
    expect(labels(groups)).not.toContain('Africa')
  })
})

describe('domestic grouping by region, not country code', () => {
  it('separates England and Scotland even though both are countryCode GB', () => {
    const groups = groupExpandedLeagues({ leagues: TEST_CATALOG, recommendedLeagueIds: [] })
    expect(labels(groups)).toContain('England')
    expect(labels(groups)).toContain('Scotland')
    expect(labels(groups)).not.toContain('United Kingdom')
    expect(idsIn(groups, 'Scotland')).toEqual(['scotland-premiership'])
    expect(idsIn(groups, 'England')).toContain('football_premier_league')
    expect(idsIn(groups, 'England')).not.toContain('scotland-premiership')
  })

  it('gives each region its own group with no empty ones', () => {
    const groups = groupExpandedLeagues({ leagues: TEST_CATALOG, recommendedLeagueIds: [] })
    expect(groups.every((g) => g.leagues.length > 0)).toBe(true)
  })
})

describe('ordering within a group', () => {
  it('sorts by tier ascending', () => {
    const groups = groupExpandedLeagues({ leagues: TEST_CATALOG, recommendedLeagueIds: [] })
    const england = groupNamed(groups, 'England')!.leagues
    const tiers = england.map((l) => l.tier ?? 9)
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b))
    expect(england[0].id).toBe('football_premier_league') // the only tier 1
  })

  it('puts a league ahead of a cup at the same tier', () => {
    const groups = groupExpandedLeagues({ leagues: TEST_CATALOG, recommendedLeagueIds: [] })
    const england = groupNamed(groups, 'England')!.leagues.map((l) => l.id)
    // Championship (tier 2, league) before FA Cup (tier 2, cup).
    expect(england.indexOf('england-championship')).toBeLessThan(england.indexOf('england-fa-cup'))
    // Portugal: LigaPro (tier 3, league) before the Super Cup (tier 3, cup).
    expect(idsIn(groups, 'Portugal')).toEqual(['portugal-ligapro', 'portugal-portuguese-super-cup'])
  })

  it('falls back to alphabetical name order at the same tier and kind', () => {
    const groups = groupExpandedLeagues({ leagues: TEST_CATALOG, recommendedLeagueIds: [] })
    const usa = groupNamed(groups, 'USA')!.leagues
    const tier3Leagues = usa.filter((l) => l.tier === 3 && l.type === 'league').map((l) => l.name)
    expect(tier3Leagues).toEqual([...tier3Leagues].sort((a, b) => a.localeCompare(b)))
  })

  it('does not use the incoming API order', () => {
    // FA Cup is listed before Scotland's Premiership in the fixture, and
    // Championship after EFL League One would be API order — neither holds.
    const groups = groupExpandedLeagues({ leagues: TEST_CATALOG, recommendedLeagueIds: [] })
    const england = groupNamed(groups, 'England')!.leagues.map((l) => l.id)
    expect(england.indexOf('england-championship')).toBeLessThan(england.indexOf('england-efl-league-one'))
  })
})

describe('group ordering', () => {
  it("puts the viewer's own region first, then International, then the rest alphabetically", () => {
    // Norway's only competition is recommended, so use a viewer whose region
    // still has competitions left after exclusion.
    const groups = groupExpandedLeagues({
      leagues: TEST_CATALOG,
      recommendedLeagueIds: [],
      viewerCountryCode: 'ES',
    })
    expect(labels(groups)[0]).toBe('Spain')
    expect(labels(groups)[1]).toBe(INTERNATIONAL_GROUP_LABEL)
    const rest = labels(groups).slice(2)
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)))
  })

  it('resolves GB to England (the Premier League’s region), not Scotland', () => {
    const groups = groupExpandedLeagues({ leagues: TEST_CATALOG, recommendedLeagueIds: [], viewerCountryCode: 'GB' })
    expect(labels(groups)[0]).toBe('England')
  })

  it('falls back to International-then-alphabetical when the country is unknown', () => {
    for (const code of [null, undefined, 'JP', '']) {
      const groups = groupExpandedLeagues({ leagues: TEST_CATALOG, recommendedLeagueIds: [], viewerCountryCode: code })
      expect(labels(groups)[0]).toBe(INTERNATIONAL_GROUP_LABEL)
      const rest = labels(groups).slice(1)
      expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)))
    }
  })

  it('omits the home group entirely when everything in it is recommended', () => {
    // The real-world Norwegian case: Eliteserien is Norway's only tracked
    // competition and it is recommended, so no empty NORWAY heading appears.
    const recommended = buildRecommendedLeagues(TEST_CATALOG, 'NO')
    const groups = groupExpandedLeagues({
      leagues: TEST_CATALOG,
      recommendedLeagueIds: recommended.map((l) => l.id),
      viewerCountryCode: 'NO',
    })
    expect(labels(groups)).not.toContain('Norway')
    expect(labels(groups)[0]).toBe(INTERNATIONAL_GROUP_LABEL)
  })

  it('never crashes on an empty catalog', () => {
    expect(groupExpandedLeagues({ leagues: [], recommendedLeagueIds: [], viewerCountryCode: 'NO' })).toEqual([])
  })
})

describe('against the real recommendation set', () => {
  it('leaves the Big Five and UEFA out of the catalogue for a Norwegian viewer', () => {
    const recommended = buildRecommendedLeagues(TEST_CATALOG, 'NO')
    const groups = groupExpandedLeagues({
      leagues: TEST_CATALOG,
      recommendedLeagueIds: recommended.map((l) => l.id),
      viewerCountryCode: 'NO',
    })
    const catalogueIds = groups.flatMap((g) => g.leagues.map((l) => l.id))
    for (const id of BIG_FIVE_COMPETITION_IDS) expect(catalogueIds).not.toContain(id)
    expect(catalogueIds).not.toContain('football_champions_league')
    expect(catalogueIds).not.toContain('norway-eliteserien')
  })
})
