import { readStored, writeStored } from '../core/storage/localStore'
import type { SportKey } from './sports/types'

const PREFERENCES_KEY = 'ninety.sportPreferences'
const ONBOARDING_DONE_KEY = 'ninety.onboardingComplete'

export interface SportPreferences {
  sports: SportKey[]
  // League ids from data/sports/leagues.ts — only meaningful for football,
  // since that's the only sport with more than one league to choose from
  // in this catalog so far.
  footballLeagueIds: string[]
  // Country names (matching parseCategory's countryName, e.g. "United
  // Kingdom") — same vocabulary the existing Channels filter/hide-country
  // mechanism already uses. Empty means "no filtering", not "hide
  // everything" — same as never having selected anything.
  favoriteCountries: string[]
}

// What a user who skips onboarding (or an old install predating the
// Countries step) still gets — matches the onboarding screen's own
// pre-checked starting state.
export const DEFAULT_PREFERENCES: SportPreferences = {
  sports: ['football', 'f1'],
  footballLeagueIds: ['4328', '4480'], // Premier League, Champions League
  favoriteCountries: [],
}

export function loadPreferences(): SportPreferences {
  return readStored(PREFERENCES_KEY, DEFAULT_PREFERENCES)
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
