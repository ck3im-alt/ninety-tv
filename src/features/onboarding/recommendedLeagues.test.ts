import { describe, expect, it } from 'vitest'
import { BIG_FIVE_COMPETITION_IDS, buildRecommendedLeagues, homeCountryLeague, uefaCompetitions } from './recommendedLeagues'
import { TEST_CATALOG } from './testCompetitionCatalog'

const ids = (leagues: { id: string }[]) => leagues.map((l) => l.id)

describe('uefaCompetitions', () => {
  it('picks up the tracked UEFA competitions from catalog metadata alone', () => {
    expect(ids(uefaCompetitions(TEST_CATALOG))).toEqual(['football_champions_league', 'football_europa_league'])
  })

  it('does not treat other supranational competitions as UEFA ones', () => {
    const result = ids(uefaCompetitions(TEST_CATALOG))
    expect(result).not.toContain('south-america-copa-libertadores')
    expect(result).not.toContain('international-world-cup')
  })

  it('picks up a UEFA competition the catalog gains later, with no code change', () => {
    // The Conference League is genuinely absent from the canonical registry
    // (footballdata.io's Starter catalog doesn't carry it), so no card is
    // fabricated for it today — but the derivation is metadata-driven, so
    // one appears the moment ninety-api starts tracking it.
    const withConference = [
      ...TEST_CATALOG,
      {
        id: 'europe-uefa-conference-league',
        sportKey: 'football' as const,
        sportLabel: 'FOOTBALL',
        tsdbSport: 'Soccer',
        name: 'UEFA Conference League',
        region: 'Europe',
        countryCode: null,
        type: 'cup' as const,
        tier: 2 as const,
      },
    ]
    expect(ids(uefaCompetitions(withConference))).toEqual([
      'football_champions_league',
      'football_europa_league',
      'europe-uefa-conference-league',
    ])
  })
})

describe('homeCountryLeague', () => {
  it('resolves the Nordic markets to their top flight', () => {
    expect(homeCountryLeague(TEST_CATALOG, 'NO')?.id).toBe('norway-eliteserien')
    expect(homeCountryLeague(TEST_CATALOG, 'SE')?.id).toBe('sweden-allsvenskan')
    expect(homeCountryLeague(TEST_CATALOG, 'DK')?.id).toBe('denmark-superliga')
  })

  it('resolves NL/BE/US the same way', () => {
    expect(homeCountryLeague(TEST_CATALOG, 'NL')?.id).toBe('netherlands-eredivisie')
    expect(homeCountryLeague(TEST_CATALOG, 'BE')?.id).toBe('belgium-pro-league')
    expect(homeCountryLeague(TEST_CATALOG, 'US')?.id).toBe('usa-mls')
  })

  it('picks the Premier League for GB, not Scotland or a cup', () => {
    expect(homeCountryLeague(TEST_CATALOG, 'GB')?.id).toBe('football_premier_league')
  })

  it('prefers an actual league over a cup of the same tier', () => {
    expect(homeCountryLeague(TEST_CATALOG, 'PT')?.id).toBe('portugal-ligapro')
  })

  it('is case-insensitive about the detected code', () => {
    expect(homeCountryLeague(TEST_CATALOG, 'no')?.id).toBe('norway-eliteserien')
  })

  it('returns null for an unknown country, an untracked one, or no detection', () => {
    expect(homeCountryLeague(TEST_CATALOG, null)).toBeNull()
    expect(homeCountryLeague(TEST_CATALOG, 'JP')).toBeNull()
    expect(homeCountryLeague(TEST_CATALOG, 'ZZ')).toBeNull()
  })
})

describe('buildRecommendedLeagues', () => {
  it('always includes the Big Five, in editorial order, followed by UEFA', () => {
    const result = ids(buildRecommendedLeagues(TEST_CATALOG, null))
    expect(result.slice(0, 5)).toEqual([...BIG_FIVE_COMPETITION_IDS])
    expect(result.slice(5)).toEqual(['football_champions_league', 'football_europa_league'])
  })

  it('adds Eliteserien for a Norwegian TV', () => {
    expect(ids(buildRecommendedLeagues(TEST_CATALOG, 'NO'))).toEqual([
      'football_premier_league',
      'football_la_liga',
      'football_bundesliga',
      'football_serie_a',
      'football_ligue_1',
      'football_champions_league',
      'football_europa_league',
      'norway-eliteserien',
    ])
  })

  it('does not render the Premier League twice for a UK TV', () => {
    const result = ids(buildRecommendedLeagues(TEST_CATALOG, 'GB'))
    expect(result.filter((id) => id === 'football_premier_league')).toHaveLength(1)
    expect(result).toHaveLength(7)
  })

  it('has no duplicate ids for any detected country', () => {
    for (const code of [null, 'NO', 'GB', 'US', 'ES', 'DE', 'PT', 'JP']) {
      const result = ids(buildRecommendedLeagues(TEST_CATALOG, code))
      expect(new Set(result).size).toBe(result.length)
    }
  })

  it('does not crash — and still recommends — when the country is unknown or untracked', () => {
    expect(ids(buildRecommendedLeagues(TEST_CATALOG, 'JP'))).toHaveLength(7)
    expect(ids(buildRecommendedLeagues(TEST_CATALOG, ''))).toHaveLength(7)
  })

  it('silently omits Big Five entries the catalog does not contain', () => {
    const trimmed = TEST_CATALOG.filter((l) => l.id !== 'football_ligue_1')
    expect(ids(buildRecommendedLeagues(trimmed, null))).not.toContain('football_ligue_1')
  })

  it('returns nothing at all for an empty catalog rather than throwing', () => {
    expect(buildRecommendedLeagues([], 'NO')).toEqual([])
  })
})
