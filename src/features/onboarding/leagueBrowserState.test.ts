import { describe, expect, it } from 'vitest'
import { defaultActiveRegionKey, resolveActiveGroup, selectedCountIn } from './leagueBrowserState'
import { INTERNATIONAL_GROUP_KEY, groupExpandedLeagues, type LeagueGroup } from './groupExpandedLeagues'
import { buildRecommendedLeagues } from './recommendedLeagues'
import { TEST_CATALOG } from './testCompetitionCatalog'

// Built through the real grouping rather than by hand: the default-region
// rule IS the group ordering, so a fixture of hand-made groups would test
// nothing.
const groupsFor = (countryCode: string | null, recommendedIds: string[] = []) =>
  groupExpandedLeagues({ leagues: TEST_CATALOG, recommendedLeagueIds: recommendedIds, viewerCountryCode: countryCode })

const labelOf = (groups: LeagueGroup[], key: string | null) => groups.find((g) => g.key === key)?.label ?? null

describe('defaultActiveRegionKey', () => {
  it("opens on the viewer's own region when it still has competitions", () => {
    const groups = groupsFor('ES')
    expect(labelOf(groups, defaultActiveRegionKey(groups))).toBe('Spain')
  })

  it('resolves GB to England rather than Scotland', () => {
    const groups = groupsFor('GB')
    expect(labelOf(groups, defaultActiveRegionKey(groups))).toBe('England')
  })

  it('falls back to International competitions when the home region is empty', () => {
    // The real Norwegian case: Eliteserien is Norway's only tracked
    // competition and it is recommended, so Norway has no group at all.
    const recommended = buildRecommendedLeagues(TEST_CATALOG, 'NO').map((l) => l.id)
    const groups = groupsFor('NO', recommended)
    expect(groups.some((g) => g.label === 'Norway')).toBe(false)
    expect(defaultActiveRegionKey(groups)).toBe(INTERNATIONAL_GROUP_KEY)
  })

  it('falls back to International competitions when no country was detected', () => {
    expect(defaultActiveRegionKey(groupsFor(null))).toBe(INTERNATIONAL_GROUP_KEY)
  })

  it('never defaults to the alphabetically-first region while International exists', () => {
    const groups = groupsFor(null)
    // Belgium sorts first alphabetically — the old flat catalogue put it at
    // the top of the page, which is exactly what this browser must not do.
    expect(groups.map((g) => g.label)).toContain('Belgium')
    expect(labelOf(groups, defaultActiveRegionKey(groups))).not.toBe('Belgium')
  })

  it('is the first remaining group when there is no international competition either', () => {
    const domesticOnly = TEST_CATALOG.filter((l) => l.countryCode != null)
    const groups = groupExpandedLeagues({ leagues: domesticOnly, recommendedLeagueIds: [], viewerCountryCode: 'JP' })
    expect(defaultActiveRegionKey(groups)).toBe(groups[0].key)
  })

  it('is null for an empty catalogue', () => {
    expect(defaultActiveRegionKey([])).toBeNull()
  })
})

describe('resolveActiveGroup', () => {
  it('returns the group the user last focused', () => {
    const groups = groupsFor('NO')
    const spain = groups.find((g) => g.label === 'Spain')!
    expect(resolveActiveGroup(groups, spain.key)).toBe(spain)
  })

  it('falls back to the default when the remembered region no longer exists', () => {
    const groups = groupsFor('ES')
    // e.g. the catalog reloaded, or every competition in that region became
    // recommended once the viewer's country resolved.
    expect(resolveActiveGroup(groups, 'region:Atlantis')).toBe(groups[0])
  })

  it('falls back to the default before anything has been focused', () => {
    const groups = groupsFor('ES')
    expect(resolveActiveGroup(groups, null)?.key).toBe(defaultActiveRegionKey(groups))
  })

  it('is null when there are no groups at all', () => {
    expect(resolveActiveGroup([], null)).toBeNull()
    expect(resolveActiveGroup([], 'region:Spain')).toBeNull()
  })
})

describe('selectedCountIn', () => {
  // The realistic shape: recommendations excluded, so England holds its
  // Championship/FA Cup/League One remainder and NOT the Premier League.
  const groups = groupsFor('NO', buildRecommendedLeagues(TEST_CATALOG, 'NO').map((l) => l.id))
  const england = groups.find((g) => g.label === 'England')!

  it('counts only the selections inside that region', () => {
    const selected = new Set(['england-championship', 'england-fa-cup', 'sweden-allsvenskan'])
    expect(selectedCountIn(england, selected)).toBe(2)
  })

  it('is 0 with nothing selected', () => {
    expect(selectedCountIn(england, new Set())).toBe(0)
  })

  it('ignores selected ids that are not in that region of the browser', () => {
    // Recommended leagues share the flow's one selectedLeagues set but are
    // rendered outside the browser — they must not inflate a region's count.
    expect(england.leagues.some((l) => l.id === 'football_premier_league')).toBe(false)
    expect(selectedCountIn(england, new Set(['football_premier_league']))).toBe(0)
  })

  it('never exceeds the region size', () => {
    const all = new Set(TEST_CATALOG.map((l) => l.id))
    for (const group of groups) expect(selectedCountIn(group, all)).toBe(group.leagues.length)
  })
})
