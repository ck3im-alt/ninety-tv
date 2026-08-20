import { describe, expect, it } from 'vitest'
import {
  STATIC_LEAGUES,
  LEGACY_FOOTBALL_LEAGUE_ID_ALIASES,
  footballLeaguesForPreferences,
  otherLeaguesForPreferences,
  type LeagueDef,
} from './leagues'

function footballLeague(overrides: Partial<LeagueDef> = {}): LeagueDef {
  return {
    id: 'football_premier_league',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    tsdbSport: 'Soccer',
    name: 'Premier League',
    region: 'England',
    countryCode: 'GB',
    tier: 1,
    badge: 'https://footballdata.io/img/league/england-premier-league.png',
    ninetyCompetitionId: 'football_premier_league',
    ...overrides,
  }
}

describe('STATIC_LEAGUES', () => {
  // Football is no longer hardcoded here (2026-08-20's Phase 1.1 audit) --
  // it's fetched from ninety-api's GET /v1/competitions (see
  // competitionsCatalog.ts). Only sports with no backend competition
  // registry entry at all belong here.
  it('contains only non-football entries', () => {
    for (const league of STATIC_LEAGUES) {
      expect(league.sportKey).not.toBe('football')
    }
  })

  it('has a unique id for every entry', () => {
    const ids = STATIC_LEAGUES.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every entry a non-empty display name', () => {
    for (const league of STATIC_LEAGUES) {
      expect(league.name.length).toBeGreaterThan(0)
    }
  })
})

describe('LEGACY_FOOTBALL_LEAGUE_ID_ALIASES', () => {
  it('maps exactly the original 7 pre-expansion TheSportsDB ids to canonical competitionIds', () => {
    expect(LEGACY_FOOTBALL_LEAGUE_ID_ALIASES).toEqual({
      '4328': 'football_premier_league',
      '4480': 'football_champions_league',
      '4335': 'football_la_liga',
      '4332': 'football_serie_a',
      '4331': 'football_bundesliga',
      '4334': 'football_ligue_1',
      '4481': 'football_europa_league',
    })
  })

  // UEFA Conference League ('5071') was never backed by ninety-api -- see
  // the alias table's own doc comment. Confirming its absence here is a
  // regression guard: silently adding an alias for it later would imply a
  // canonical competitionId that doesn't actually exist in the catalog.
  it('has no entry for UEFA Conference League (5071) -- it was never backed by ninety-api', () => {
    expect(LEGACY_FOOTBALL_LEAGUE_ID_ALIASES['5071']).toBeUndefined()
  })

  it('every alias target looks like a canonical competitionId, not another legacy TheSportsDB id', () => {
    for (const target of Object.values(LEGACY_FOOTBALL_LEAGUE_ID_ALIASES)) {
      expect(target).toMatch(/^[a-z0-9_-]+$/)
      expect(target).not.toMatch(/^\d+$/) // TheSportsDB ids are bare numeric strings
    }
  })
})

describe('footballLeaguesForPreferences', () => {
  const catalog = [
    footballLeague(),
    footballLeague({ id: 'football_champions_league', name: 'UEFA Champions League', ninetyCompetitionId: 'football_champions_league' }),
    footballLeague({ id: 'norway-eliteserien', name: 'Eliteserien', region: 'Norway', countryCode: 'NO', tier: 2, ninetyCompetitionId: 'norway-eliteserien' }),
  ]

  it('returns only the followed ids, in catalog order', () => {
    const result = footballLeaguesForPreferences(['norway-eliteserien', 'football_premier_league'], catalog)
    expect(result.map((l) => l.id)).toEqual(['football_premier_league', 'norway-eliteserien'])
  })

  it('returns an empty array when no ids are followed', () => {
    expect(footballLeaguesForPreferences([], catalog)).toEqual([])
  })

  // The whole reason "a stored competition no longer exists" is handled
  // gracefully rather than throwing: a stale/removed id (or the orphaned
  // legacy '5071' left in place by migrateFootballLeagueIds) must not
  // crash the home feed, it should just contribute nothing.
  it('silently excludes ids not present in the catalog (stale/removed/never-migrated selections)', () => {
    const result = footballLeaguesForPreferences(['5071', 'football_premier_league', 'not-a-real-id'], catalog)
    expect(result.map((l) => l.id)).toEqual(['football_premier_league'])
  })

  // Competition-catalog resilience: a temporarily-failed or still-loading
  // GET /v1/competitions must degrade to "show nothing football-related
  // this render" rather than throwing and taking the whole home feed down
  // with it -- the caller (useHomeFeed.ts) passes an empty catalog in
  // exactly this situation while the fetch is in flight or has failed.
  it('returns an empty array (not a throw) when the catalog itself is empty, even with real followed ids', () => {
    expect(footballLeaguesForPreferences(['football_premier_league', 'football_champions_league'], [])).toEqual([])
  })

  // A catalog fetch that only partially succeeded (some competitions
  // missing, e.g. a truncated/incomplete API response) must still resolve
  // whichever followed ids it can, not all-or-nothing reject the ones it
  // has evidence for.
  it('resolves whichever followed ids are present when the catalog only contains some competitions', () => {
    const partialCatalog = [footballLeague()] // champions_league/eliteserien missing from this response
    const result = footballLeaguesForPreferences(['football_premier_league', 'football_champions_league'], partialCatalog)
    expect(result.map((l) => l.id)).toEqual(['football_premier_league'])
  })
})

describe('otherLeaguesForPreferences', () => {
  it('returns F1 when football is selected alongside it', () => {
    const result = otherLeaguesForPreferences(['football', 'f1'])
    expect(result.map((l) => l.id)).toEqual(['4370'])
  })

  it('returns nothing when f1 is not selected', () => {
    expect(otherLeaguesForPreferences(['football'])).toEqual([])
  })

  it('never includes football (that goes through footballLeaguesForPreferences instead)', () => {
    const result = otherLeaguesForPreferences(['football', 'f1'])
    expect(result.every((l) => l.sportKey !== 'football')).toBe(true)
  })
})
