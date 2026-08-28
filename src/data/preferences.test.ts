import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeLocalStorage } from '../core/storage/testFakeLocalStorage'
import {
  DEFAULT_PREFERENCES,
  LEGACY_HOME_CONTENT_MODE,
  MAX_PREFERRED_COUNTRIES,
  RECOMMENDED_HOME_CONTENT_MODE,
  loadPreferences,
  migrateFootballLeagueIds,
  savePreferences,
  withCountryToggled,
  withPrimaryCountry,
  withTeamToggled,
  type SportPreferences,
} from './preferences'

beforeEach(() => {
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
})

describe('migrateFootballLeagueIds', () => {
  it('maps every legacy TheSportsDB id to its canonical competitionId', () => {
    const result = migrateFootballLeagueIds(['4328', '4480'])
    expect(result).toEqual(['football_premier_league', 'football_champions_league'])
  })

  it('leaves already-canonical ids untouched', () => {
    const result = migrateFootballLeagueIds(['football_premier_league', 'norway-eliteserien'])
    expect(result).toEqual(['football_premier_league', 'norway-eliteserien'])
  })

  it('leaves an unrecognized legacy id (e.g. 5071, UEFA Conference League) as-is rather than dropping or throwing', () => {
    const result = migrateFootballLeagueIds(['5071', '4328'])
    expect(result).toEqual(['5071', 'football_premier_league'])
  })

  it('is idempotent -- running it twice produces the same result as running it once', () => {
    const once = migrateFootballLeagueIds(['4328', '4480', '5071'])
    const twice = migrateFootballLeagueIds(once)
    expect(twice).toEqual(once)
  })

  it('dedupes if both the legacy and canonical id were already present', () => {
    const result = migrateFootballLeagueIds(['4328', 'football_premier_league'])
    expect(result).toEqual(['football_premier_league'])
  })

  it('handles an empty array', () => {
    expect(migrateFootballLeagueIds([])).toEqual([])
  })
})

describe('loadPreferences', () => {
  it('returns DEFAULT_PREFERENCES (already canonical) for a brand-new user, without writing to storage', () => {
    const prefs = loadPreferences()
    expect(prefs).toEqual(DEFAULT_PREFERENCES)
    expect(localStorage.getItem('ninety.sportPreferences')).toBeNull()
  })

  it('migrates legacy TheSportsDB ids on load and persists the migrated version', () => {
    const legacy: SportPreferences = {
      sports: ['football', 'f1'],
      footballLeagueIds: ['4328', '4480', '4335'],
      favoriteCountries: [],
      streamType: 'auto',
      favoriteTeamIds: [],
      homeContentMode: 'all',
    }
    savePreferences(legacy)

    const loaded = loadPreferences()
    expect(loaded.footballLeagueIds).toEqual(['football_premier_league', 'football_champions_league', 'football_la_liga'])

    const persisted = JSON.parse(localStorage.getItem('ninety.sportPreferences')!) as SportPreferences
    expect(persisted.footballLeagueIds).toEqual(['football_premier_league', 'football_champions_league', 'football_la_liga'])
  })

  it('is idempotent across repeated loads -- a second load after migration changes nothing further', () => {
    savePreferences({ sports: ['football'], footballLeagueIds: ['4328'], favoriteCountries: [], streamType: 'auto', favoriteTeamIds: [], homeContentMode: 'all' })

    const first = loadPreferences()
    const second = loadPreferences()
    expect(second).toEqual(first)
    expect(second.footballLeagueIds).toEqual(['football_premier_league'])
  })

  it('preserves other preference fields untouched by migration', () => {
    savePreferences({ sports: ['football', 'f1'], footballLeagueIds: ['4328'], favoriteCountries: ['Norway'], streamType: 'tv', favoriteTeamIds: [], homeContentMode: 'all' })
    const loaded = loadPreferences()
    expect(loaded.sports).toEqual(['football', 'f1'])
    expect(loaded.favoriteCountries).toEqual(['Norway'])
    expect(loaded.streamType).toBe('tv')
  })

  it('fills in streamType "auto" for preferences persisted before the field existed, without writing back', () => {
    // A pre-streamType install's stored object simply lacks the field.
    localStorage.setItem(
      'ninety.sportPreferences',
      JSON.stringify({ sports: ['football'], footballLeagueIds: ['football_premier_league'], favoriteCountries: ['Norway'] }),
    )
    const loaded = loadPreferences()
    expect(loaded.streamType).toBe('auto')
    const persisted = JSON.parse(localStorage.getItem('ninety.sportPreferences')!) as Record<string, unknown>
    expect('streamType' in persisted).toBe(false)
  })

  it('normalizes an unrecognized stored streamType value to "auto"', () => {
    localStorage.setItem(
      'ninety.sportPreferences',
      JSON.stringify({ sports: [], footballLeagueIds: [], favoriteCountries: [], streamType: 'ppv-only' }),
    )
    expect(loadPreferences().streamType).toBe('auto')
  })

  it('preserves a legacy favoriteCountries list LONGER than the cap on load — never silently truncated', () => {
    const seven = ['Norway', 'Sweden', 'Denmark', 'United Kingdom', 'Germany', 'France', 'Spain']
    localStorage.setItem(
      'ninety.sportPreferences',
      JSON.stringify({ sports: [], footballLeagueIds: [], favoriteCountries: seven }),
    )
    expect(loadPreferences().favoriteCountries).toEqual(seven)
  })

  it('leaves an already-canonical stored selection untouched, with no rewrite', () => {
    const alreadyCanonical: SportPreferences = {
      sports: ['football'],
      footballLeagueIds: ['football_premier_league'],
      favoriteCountries: [],
      streamType: 'auto',
      favoriteTeamIds: [],
      homeContentMode: 'all',
    }
    savePreferences(alreadyCanonical)
    const loaded = loadPreferences()
    expect(loaded).toEqual(alreadyCanonical)
  })

  it('does not crash on a preferences object containing only the dead Conference League id', () => {
    savePreferences({ sports: ['football'], footballLeagueIds: ['5071'], favoriteCountries: [], streamType: 'auto', favoriteTeamIds: [], homeContentMode: 'all' })
    const loaded = loadPreferences()
    // Left in place, not stripped -- see migrateFootballLeagueIds's own
    // comment for why this is the intended, non-destructive behavior. The
    // catalog itself simply won't contain a matching entry, so this
    // becomes an inert selection downstream (see leagues.test.ts's
    // footballLeaguesForPreferences coverage of that case).
    expect(loaded.footballLeagueIds).toEqual(['5071'])
  })
})

// TEST 13 — the mandatory backwards-compatibility case. favoriteTeamIds
// arrived on 2026-08-26; every install that predates it has a stored
// preferences object without the field, and must keep working untouched.
describe('loadPreferences — favoriteTeamIds backwards compatibility', () => {
  it('loads a pre-favoriteTeamIds install successfully, with an empty list', () => {
    localStorage.setItem(
      'ninety.sportPreferences',
      JSON.stringify({
        sports: ['football', 'f1'],
        footballLeagueIds: ['football_premier_league'],
        favoriteCountries: ['Norway'],
        streamType: 'tv',
      }),
    )
    expect(loadPreferences().favoriteTeamIds).toEqual([])
  })

  it('preserves every other preference from that install — nothing is reset', () => {
    localStorage.setItem(
      'ninety.sportPreferences',
      JSON.stringify({
        sports: ['football', 'f1'],
        footballLeagueIds: ['football_premier_league', 'football_champions_league'],
        favoriteCountries: ['Norway', 'Sweden'],
        streamType: 'tv',
      }),
    )
    const loaded = loadPreferences()
    expect(loaded.sports).toEqual(['football', 'f1'])
    expect(loaded.footballLeagueIds).toEqual(['football_premier_league', 'football_champions_league'])
    expect(loaded.favoriteCountries).toEqual(['Norway', 'Sweden'])
    expect(loaded.streamType).toBe('tv')
  })

  // Same rule as streamType: a viewer who has never followed a team must
  // not have an empty list materialized into storage on their behalf.
  it('does not write the field back just because it was absent', () => {
    localStorage.setItem(
      'ninety.sportPreferences',
      JSON.stringify({ sports: ['football'], footballLeagueIds: ['football_premier_league'], favoriteCountries: [] }),
    )
    loadPreferences()
    const persisted = JSON.parse(localStorage.getItem('ninety.sportPreferences')!) as Record<string, unknown>
    expect('favoriteTeamIds' in persisted).toBe(false)
  })

  it('round-trips a real selection of canonical team ids', () => {
    savePreferences({
      sports: ['football'],
      footballLeagueIds: ['football_premier_league'],
      favoriteCountries: [],
      streamType: 'auto',
      favoriteTeamIds: ['team_manutd', 'team_glimt'],
      homeContentMode: 'all',
    })
    expect(loadPreferences().favoriteTeamIds).toEqual(['team_manutd', 'team_glimt'])
  })

  it('carries favoriteTeamIds through the legacy league-id migration untouched', () => {
    savePreferences({
      sports: ['football'],
      footballLeagueIds: ['4328'],
      favoriteCountries: [],
      streamType: 'auto',
      favoriteTeamIds: ['team_manutd'],
      homeContentMode: 'all',
    })
    const loaded = loadPreferences()
    expect(loaded.footballLeagueIds).toEqual(['football_premier_league'])
    expect(loaded.favoriteTeamIds).toEqual(['team_manutd'])
  })

  it('discards a corrupted stored value rather than letting it reach ranking', () => {
    localStorage.setItem(
      'ninety.sportPreferences',
      JSON.stringify({ sports: [], footballLeagueIds: [], favoriteCountries: [], favoriteTeamIds: 'not-an-array' }),
    )
    expect(loadPreferences().favoriteTeamIds).toEqual([])
  })

  it('drops non-string and empty entries, and de-duplicates', () => {
    localStorage.setItem(
      'ninety.sportPreferences',
      JSON.stringify({
        sports: [],
        footballLeagueIds: [],
        favoriteCountries: [],
        favoriteTeamIds: ['team_a', '', null, 7, 'team_a', 'team_b'],
        homeContentMode: 'all',
      }),
    )
    expect(loadPreferences().favoriteTeamIds).toEqual(['team_a', 'team_b'])
  })

  it('survives a stored object missing footballLeagueIds entirely, rather than throwing at startup', () => {
    localStorage.setItem('ninety.sportPreferences', JSON.stringify({ sports: ['football'] }))
    expect(() => loadPreferences()).not.toThrow()
    expect(loadPreferences().favoriteTeamIds).toEqual([])
  })
})

// The 2026-08-28 backwards-compatibility case, and the one with real teeth:
// homeContentMode does not merely default, it defaults to a DIFFERENT value
// for an existing install than for a new one. Getting that backwards would
// silently narrow the Home of everybody who upgraded.
describe('loadPreferences — homeContentMode backwards compatibility', () => {
  it('resolves a stored object with no homeContentMode to "all" — exactly the Home that install already had', () => {
    localStorage.setItem(
      'ninety.sportPreferences',
      JSON.stringify({
        sports: ['football', 'f1'],
        footballLeagueIds: ['football_premier_league'],
        favoriteCountries: ['Norway'],
        streamType: 'tv',
        favoriteTeamIds: ['team_a'],
      }),
    )
    expect(loadPreferences().homeContentMode).toBe(LEGACY_HOME_CONTENT_MODE)
    expect(loadPreferences().homeContentMode).toBe('all')
  })

  it('does NOT resolve a legacy install to the new-install default', () => {
    localStorage.setItem(
      'ninety.sportPreferences',
      JSON.stringify({ sports: ['football'], footballLeagueIds: [], favoriteCountries: [] }),
    )
    expect(loadPreferences().homeContentMode).not.toBe(DEFAULT_PREFERENCES.homeContentMode)
  })

  it('gives a brand-new install the recommended mode', () => {
    expect(loadPreferences().homeContentMode).toBe(RECOMMENDED_HOME_CONTENT_MODE)
    expect(DEFAULT_PREFERENCES.homeContentMode).toBe('highlights')
  })

  // The distinction above is intentional, so state it once as an invariant
  // rather than leaving it to look like an oversight.
  it('keeps the legacy fallback and the new-install default deliberately different', () => {
    expect(LEGACY_HOME_CONTENT_MODE).not.toBe(RECOMMENDED_HOME_CONTENT_MODE)
  })

  it('normalizes an unrecognized stored value to "all" rather than letting it reach the content policy', () => {
    localStorage.setItem(
      'ninety.sportPreferences',
      JSON.stringify({ sports: [], footballLeagueIds: [], favoriteCountries: [], homeContentMode: 'my-interests' }),
    )
    expect(loadPreferences().homeContentMode).toBe('all')
  })

  it.each([null, 7, {}, [], ''])('normalizes the corrupted stored value %p to "all"', (value) => {
    localStorage.setItem(
      'ninety.sportPreferences',
      JSON.stringify({ sports: [], footballLeagueIds: [], favoriteCountries: [], homeContentMode: value }),
    )
    expect(loadPreferences().homeContentMode).toBe('all')
  })

  // Same rule as streamType and favoriteTeamIds: nobody gets a
  // content-breadth choice materialized into storage on their behalf.
  it('does not write the field back just because it was absent', () => {
    localStorage.setItem(
      'ninety.sportPreferences',
      JSON.stringify({ sports: ['football'], footballLeagueIds: ['football_premier_league'], favoriteCountries: [] }),
    )
    loadPreferences()
    const persisted = JSON.parse(localStorage.getItem('ninety.sportPreferences')!) as Record<string, unknown>
    expect('homeContentMode' in persisted).toBe(false)
  })

  it('preserves every other preference from a pre-homeContentMode install', () => {
    localStorage.setItem(
      'ninety.sportPreferences',
      JSON.stringify({
        sports: ['football', 'f1'],
        footballLeagueIds: ['football_premier_league', 'football_champions_league'],
        favoriteCountries: ['Norway', 'Sweden'],
        streamType: 'tv',
        favoriteTeamIds: ['team_a', 'team_b'],
      }),
    )
    const loaded = loadPreferences()
    expect(loaded.sports).toEqual(['football', 'f1'])
    expect(loaded.footballLeagueIds).toEqual(['football_premier_league', 'football_champions_league'])
    expect(loaded.favoriteCountries).toEqual(['Norway', 'Sweden'])
    expect(loaded.streamType).toBe('tv')
    expect(loaded.favoriteTeamIds).toEqual(['team_a', 'team_b'])
  })

  it('round-trips each of the three real modes', () => {
    for (const mode of ['all', 'highlights', 'favorites_only'] as const) {
      savePreferences({ ...DEFAULT_PREFERENCES, homeContentMode: mode })
      expect(loadPreferences().homeContentMode).toBe(mode)
    }
  })

  // The legacy league-id migration is the one path that DOES write back.
  // It must carry the normalized mode with it rather than dropping the
  // field or inventing a different one.
  it('carries homeContentMode through the legacy league-id migration, and writes the normalized value', () => {
    localStorage.setItem(
      'ninety.sportPreferences',
      JSON.stringify({ sports: ['football'], footballLeagueIds: ['4328'], favoriteCountries: [], streamType: 'auto' }),
    )
    const loaded = loadPreferences()
    expect(loaded.footballLeagueIds).toEqual(['football_premier_league'])
    expect(loaded.homeContentMode).toBe('all')

    const persisted = JSON.parse(localStorage.getItem('ninety.sportPreferences')!) as SportPreferences
    expect(persisted.homeContentMode).toBe('all')
  })
})

describe('withTeamToggled', () => {
  it('adds a team that is not followed', () => {
    expect(withTeamToggled([], 'team_a')).toEqual(['team_a'])
    expect(withTeamToggled(['team_a'], 'team_b')).toEqual(['team_a', 'team_b'])
  })

  it('removes a team that is', () => {
    expect(withTeamToggled(['team_a', 'team_b'], 'team_a')).toEqual(['team_b'])
  })

  // Unlike countries, there is no cap: following a domestic club, a
  // European giant and a couple of local sides is an ordinary selection.
  it('has no cap — a football fan can follow as many clubs as they like', () => {
    let selected: string[] = []
    for (let i = 0; i < 25; i++) selected = withTeamToggled(selected, `team_${i}`)
    expect(selected).toHaveLength(25)
  })

  it('never mutates its input', () => {
    const input = ['team_a']
    withTeamToggled(input, 'team_b')
    withTeamToggled(input, 'team_a')
    expect(input).toEqual(['team_a'])
  })
})

describe('withCountryToggled (max-5 / primary ordering rule)', () => {
  it('appends a new country while under the cap — selection order is priority order', () => {
    expect(withCountryToggled([], 'Norway')).toEqual(['Norway'])
    expect(withCountryToggled(['Norway'], 'Sweden')).toEqual(['Norway', 'Sweden'])
  })

  it('removes a selected country when toggled again', () => {
    expect(withCountryToggled(['Norway', 'Sweden'], 'Sweden')).toEqual(['Norway'])
  })

  it('promotes the next country to primary when the primary is removed', () => {
    expect(withCountryToggled(['Norway', 'Sweden', 'Denmark'], 'Norway')).toEqual(['Sweden', 'Denmark'])
  })

  it('is a no-op at the cap — a sixth country cannot be added', () => {
    const five = ['Norway', 'Sweden', 'Denmark', 'United Kingdom', 'Germany']
    expect(five).toHaveLength(MAX_PREFERRED_COUNTRIES)
    expect(withCountryToggled(five, 'France')).toEqual(five)
  })

  it('a legacy over-cap list can still REMOVE freely, it just cannot grow', () => {
    const seven = ['Norway', 'Sweden', 'Denmark', 'United Kingdom', 'Germany', 'France', 'Spain']
    expect(withCountryToggled(seven, 'Italy')).toEqual(seven)
    expect(withCountryToggled(seven, 'Spain')).toEqual(seven.slice(0, 6))
  })

  it('never mutates its input', () => {
    const input = ['Norway']
    withCountryToggled(input, 'Sweden')
    withCountryToggled(input, 'Norway')
    expect(input).toEqual(['Norway'])
  })
})

describe('withPrimaryCountry (Settings-only re-ordering)', () => {
  it('promotes a selected country to primary', () => {
    expect(withPrimaryCountry(['Norway', 'Sweden', 'United Kingdom'], 'Sweden')).toEqual([
      'Sweden',
      'Norway',
      'United Kingdom',
    ])
  })

  it('preserves the relative order of every other selection', () => {
    expect(withPrimaryCountry(['Norway', 'Sweden', 'Denmark', 'Germany'], 'Germany')).toEqual([
      'Germany',
      'Norway',
      'Sweden',
      'Denmark',
    ])
  })

  it('is a no-op for the country that is already primary', () => {
    const selected = ['Norway', 'Sweden']
    expect(withPrimaryCountry(selected, 'Norway')).toEqual(selected)
  })

  it('is a no-op for a country that is not selected — it never adds one as a side effect', () => {
    const selected = ['Norway', 'Sweden']
    expect(withPrimaryCountry(selected, 'France')).toEqual(selected)
  })

  it('never changes how many countries are selected, so the cap cannot be bypassed through it', () => {
    const five = ['Norway', 'Sweden', 'Denmark', 'United Kingdom', 'Germany']
    expect(withPrimaryCountry(five, 'Germany')).toHaveLength(MAX_PREFERRED_COUNTRIES)
  })

  it('never mutates its input', () => {
    const input = ['Norway', 'Sweden']
    withPrimaryCountry(input, 'Sweden')
    expect(input).toEqual(['Norway', 'Sweden'])
  })
})
