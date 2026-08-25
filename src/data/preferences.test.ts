import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeLocalStorage } from '../core/storage/testFakeLocalStorage'
import {
  DEFAULT_PREFERENCES,
  MAX_PREFERRED_COUNTRIES,
  loadPreferences,
  migrateFootballLeagueIds,
  savePreferences,
  withCountryToggled,
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
    }
    savePreferences(legacy)

    const loaded = loadPreferences()
    expect(loaded.footballLeagueIds).toEqual(['football_premier_league', 'football_champions_league', 'football_la_liga'])

    const persisted = JSON.parse(localStorage.getItem('ninety.sportPreferences')!) as SportPreferences
    expect(persisted.footballLeagueIds).toEqual(['football_premier_league', 'football_champions_league', 'football_la_liga'])
  })

  it('is idempotent across repeated loads -- a second load after migration changes nothing further', () => {
    savePreferences({ sports: ['football'], footballLeagueIds: ['4328'], favoriteCountries: [], streamType: 'auto' })

    const first = loadPreferences()
    const second = loadPreferences()
    expect(second).toEqual(first)
    expect(second.footballLeagueIds).toEqual(['football_premier_league'])
  })

  it('preserves other preference fields untouched by migration', () => {
    savePreferences({ sports: ['football', 'f1'], footballLeagueIds: ['4328'], favoriteCountries: ['Norway'], streamType: 'tv' })
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
    }
    savePreferences(alreadyCanonical)
    const loaded = loadPreferences()
    expect(loaded).toEqual(alreadyCanonical)
  })

  it('does not crash on a preferences object containing only the dead Conference League id', () => {
    savePreferences({ sports: ['football'], footballLeagueIds: ['5071'], favoriteCountries: [], streamType: 'auto' })
    const loaded = loadPreferences()
    // Left in place, not stripped -- see migrateFootballLeagueIds's own
    // comment for why this is the intended, non-destructive behavior. The
    // catalog itself simply won't contain a matching entry, so this
    // becomes an inert selection downstream (see leagues.test.ts's
    // footballLeaguesForPreferences coverage of that case).
    expect(loaded.footballLeagueIds).toEqual(['5071'])
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
