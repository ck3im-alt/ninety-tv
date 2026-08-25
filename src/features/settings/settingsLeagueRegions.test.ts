import { describe, expect, it } from 'vitest'
import { groupLeaguesByRegion, initialRegion, selectedLeagues } from './settingsLeagueRegions'
import { INTERNATIONAL_GROUP_LABEL } from '../../data/sports/competitionGrouping'
import type { LeagueDef } from '../../data/sports/leagues'

// A small local slice shaped like what GET /v1/competitions returns. Kept
// local (rather than importing onboarding's fixture) so these tests stay
// independent of that feature's own fixtures — but countryCode is spelled
// out on every entry exactly as the real endpoint sends it (`string | null`,
// never absent), because null is what marks a supranational competition.
function league(
  id: string,
  name: string,
  region: string | undefined,
  countryCode: string | null,
  tier: 1 | 2 | 3,
): LeagueDef {
  return { id, sportKey: 'football', sportLabel: 'FOOTBALL', tsdbSport: 'Soccer', name, region, countryCode, tier }
}

const CATALOG: LeagueDef[] = [
  league('football_premier_league', 'Premier League', 'England', 'GB', 1),
  league('football_championship', 'Championship', 'England', 'GB', 2),
  league('football_fa_cup', 'FA Cup', 'England', 'GB', 2),
  league('football_la_liga', 'La Liga', 'Spain', 'ES', 1),
  league('football_eliteserien', 'Eliteserien', 'Norway', 'NO', 3),
  // Supranational: no country of its own, nominal region 'Europe'.
  league('football_champions_league', 'Champions League', 'Europe', null, 1),
  league('football_unknown', 'Unaffiliated Cup', undefined, 'ZZ', 3),
]

describe('groupLeaguesByRegion', () => {
  it('groups the catalog by its canonical region', () => {
    const groups = groupLeaguesByRegion(CATALOG, [])
    expect(groups.find((g) => g.region === 'England')!.leagues.map((l) => l.name)).toEqual([
      'Premier League',
      'Championship',
      'FA Cup',
    ])
  })

  it('orders competitions within a region by importance, then alphabetically', () => {
    const england = groupLeaguesByRegion(CATALOG, []).find((g) => g.region === 'England')!
    expect(england.leagues.map((l) => l.tier)).toEqual([1, 2, 2])
    expect(england.leagues[1].name).toBe('Championship')
  })

  it('orders regions by weight, and parks the unnamed-region bucket last', () => {
    const groups = groupLeaguesByRegion(CATALOG, [])
    expect(groups[0].region).toBe('England')
    expect(groups.at(-1)!.region).toBe('Other')
  })

  it('does NOT reorder regions when the selection changes — rows must not move under the highlight', () => {
    const before = groupLeaguesByRegion(CATALOG, []).map((g) => g.region)
    const after = groupLeaguesByRegion(CATALOG, ['football_eliteserien', 'football_champions_league']).map((g) => g.region)
    expect(after).toEqual(before)
  })

  it('counts how many of each region’s competitions are followed', () => {
    const groups = groupLeaguesByRegion(CATALOG, ['football_premier_league', 'football_fa_cup', 'football_la_liga'])
    expect(groups.find((g) => g.region === 'England')!.selectedCount).toBe(2)
    expect(groups.find((g) => g.region === 'Spain')!.selectedCount).toBe(1)
    expect(groups.find((g) => g.region === 'Norway')!.selectedCount).toBe(0)
  })

  it('files a supranational competition under International, not its nominal region — the same group onboarding put it in', () => {
    const groups = groupLeaguesByRegion(CATALOG, [])
    expect(groups.find((g) => g.region === 'Europe')).toBeUndefined()
    expect(groups.find((g) => g.region === INTERNATIONAL_GROUP_LABEL)!.leagues.map((l) => l.id)).toEqual([
      'football_champions_league',
    ])
  })

  it('renders one region at a time — no group holds the whole catalog', () => {
    const groups = groupLeaguesByRegion(CATALOG, [])
    expect(groups.length).toBeGreaterThan(1)
    for (const group of groups) expect(group.leagues.length).toBeLessThan(CATALOG.length)
  })
})

describe('initialRegion', () => {
  it('opens on wherever the user already follows the most competitions', () => {
    const groups = groupLeaguesByRegion(CATALOG, ['football_eliteserien'])
    expect(initialRegion(groups)).toBe('Norway')
  })

  it('falls back to the first region when nothing is followed', () => {
    expect(initialRegion(groupLeaguesByRegion(CATALOG, []))).toBe('England')
  })

  it('is null for an empty catalog', () => {
    expect(initialRegion([])).toBeNull()
  })
})

describe('selectedLeagues', () => {
  it('resolves stored ids against the catalog, in catalog order', () => {
    expect(selectedLeagues(CATALOG, ['football_la_liga', 'football_premier_league']).map((l) => l.name)).toEqual([
      'Premier League',
      'La Liga',
    ])
  })

  it('drops an id the catalog no longer knows from the DISPLAY only — the stored preference is not this function’s to edit', () => {
    const ids = ['football_premier_league', 'football_retired']
    expect(selectedLeagues(CATALOG, ids).map((l) => l.id)).toEqual(['football_premier_league'])
    expect(ids).toEqual(['football_premier_league', 'football_retired'])
  })
})
