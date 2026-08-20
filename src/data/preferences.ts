import { readStored, writeStored } from '../core/storage/localStore'
import type { SportKey } from './sports/types'
import { LEGACY_FOOTBALL_LEAGUE_ID_ALIASES } from './sports/leagues'

const PREFERENCES_KEY = 'ninety.sportPreferences'
const ONBOARDING_DONE_KEY = 'ninety.onboardingComplete'

export interface SportPreferences {
  sports: SportKey[]
  // Competition ids from ninety-api's canonical registry (fetched via
  // data/sports/competitionsCatalog.ts) — only meaningful for football,
  // since that's the only sport with more than one league to choose from
  // in this catalog so far. Before 2026-08-20 these were TheSportsDB ids;
  // see migrateFootballLeagueIds below for how existing saved selections
  // are upgraded.
  footballLeagueIds: string[]
  // Country names (matching parseCategory's countryName, e.g. "United
  // Kingdom") — same vocabulary the existing Channels filter/hide-country
  // mechanism already uses. Empty means "no filtering", not "hide
  // everything" — same as never having selected anything.
  favoriteCountries: string[]
}

// What a user who skips onboarding (or an old install predating the
// Countries step) still gets — matches the onboarding screen's own
// pre-checked starting state. Canonical ninety-api competition ids (not
// TheSportsDB ids) since 2026-08-20 — see migrateFootballLeagueIds for how
// a pre-existing install's saved TheSportsDB-id selections get upgraded to
// match.
export const DEFAULT_PREFERENCES: SportPreferences = {
  sports: ['football', 'f1'],
  footballLeagueIds: ['football_premier_league', 'football_champions_league'],
  favoriteCountries: [],
}

// One-time migration: preferences saved before 2026-08-20 stored football
// league selections as TheSportsDB ids (the only id space that existed
// then, back when ninety-tv hardcoded its own competition catalog). Now
// that the catalog comes from ninety-api's GET /v1/competitions, those old
// ids need to become canonical competitionId values to keep matching
// anything.
//
// Idempotent by construction: mapping an id that's already canonical (not
// present in LEGACY_FOOTBALL_LEAGUE_ID_ALIASES) is a no-op, so running
// this again on already-migrated preferences changes nothing — safe to
// call unconditionally on every load rather than needing a separate
// "have we migrated yet" flag.
//
// An id with no known alias (in practice, only '5071' / UEFA Conference
// League — see leagues.ts's comment on the alias table for why) is left
// in the array as-is rather than stripped: it simply won't match any
// competition in the current catalog (which never included it in the
// first place), so it silently drops out of the *effective* selection
// without this function destructively rewriting the user's stored data or
// throwing on an id it doesn't recognize.
export function migrateFootballLeagueIds(ids: string[]): string[] {
  const migrated = ids.map((id) => LEGACY_FOOTBALL_LEAGUE_ID_ALIASES[id] ?? id)
  return Array.from(new Set(migrated))
}

export function loadPreferences(): SportPreferences {
  const stored = readStored(PREFERENCES_KEY, DEFAULT_PREFERENCES)
  const migratedFootballLeagueIds = migrateFootballLeagueIds(stored.footballLeagueIds)

  // Only write back (and only take the migrated copy) when migration
  // actually changed something — a brand-new user who has never saved
  // anything falls back to DEFAULT_PREFERENCES, which is already
  // canonical, so this is a no-op and nothing gets written to storage on
  // their behalf before they've made a real choice.
  if (JSON.stringify(migratedFootballLeagueIds) !== JSON.stringify(stored.footballLeagueIds)) {
    const migrated: SportPreferences = { ...stored, footballLeagueIds: migratedFootballLeagueIds }
    writeStored(PREFERENCES_KEY, migrated)
    return migrated
  }
  return stored
}

export function savePreferences(prefs: SportPreferences): void {
  writeStored(PREFERENCES_KEY, prefs)
}

export function hasCompletedOnboarding(): boolean {
  return readStored(ONBOARDING_DONE_KEY, false)
}

export function markOnboardingComplete(): void {
  writeStored(ONBOARDING_DONE_KEY, true)
}
