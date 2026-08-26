import { readStored, writeStored } from '../core/storage/localStore'
import type { SportKey } from './sports/types'
import { LEGACY_FOOTBALL_LEAGUE_ID_ALIASES } from './sports/leagues'

const PREFERENCES_KEY = 'ninety.sportPreferences'
const ONBOARDING_DONE_KEY = 'ninety.onboardingComplete'

// How stream ranking should weigh linear TV channels vs event-specific
// feeds (what IPTV panels call "PPV") — a RANKING boost only, never a hard
// exclusion (see buildEventStreamOptions.ts's scoring). 'auto' means no
// boost either way: rank the best stream regardless of source type.
export type StreamTypePreference = 'auto' | 'tv' | 'event'

// Hard cap on how many preferred countries a user can SELECT going forward
// (onboarding + Settings, via withCountryToggled below). Deliberately not
// enforced against already-persisted data: a pre-existing install with more
// than five saved countries keeps all of them working (they all still rank
// as preferred) — the cap only stops the list from growing past five on
// future edits, so no user's stored preferences are ever silently
// truncated or corrupted by an app update.
export const MAX_PREFERRED_COUNTRIES = 5

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
  //
  // ORDERED: the first entry is the user's PRIMARY country, which ranks
  // above the other preferred countries in stream selection (see
  // buildEventStreamOptions.ts). This was already implicitly true for
  // viewer-market derivation ("the first favorite is the highest-ranked
  // market" — see viewerMarket.ts's deriveViewerMarkets); the primary
  // concept just makes the same ordering explicit rather than introducing
  // a separate persisted field that could drift out of sync with the list.
  favoriteCountries: string[]
  // See StreamTypePreference above. Absent in preferences persisted before
  // this field existed — normalized to 'auto' on load, never written back
  // just for that.
  streamType: StreamTypePreference
  // CANONICAL ninety-api team ids (teams.id — see GET /v1/teams via
  // data/sports/teamCatalog.ts), never team NAMES: a display name changes
  // with the provider's own catalog ("Bodo/Glimt" vs "Bodø/Glimt"), can
  // collide across countries, and would silently stop matching the moment
  // it did. Ids are the only identity the events feed also carries
  // (SportEvent.homeTeamId/awayTeamId).
  //
  // The STRONGEST personalization signal Home has (see
  // data/sports/homePersonalization.ts) — an explicit "I follow this club"
  // outranks any amount of generic club prominence.
  //
  // Optional, deliberately uncapped, and absent from every preferences
  // object persisted before 2026-08-26 — normalized to [] at read time
  // (see normalizeTeamIds), never written back just for that.
  favoriteTeamIds: string[]
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
  streamType: 'auto',
  favoriteTeamIds: [],
}

// One shared toggle rule for every place that edits the preferred-country
// list (onboarding + Settings), so the cap/primary behavior can't drift
// between screens:
// - toggling a selected country off removes it; if it was the primary
//   (index 0), the next selected country is promoted — the list stays
//   ordered, no gap.
// - toggling a new country on appends it (selection order IS priority
//   order), but only while under MAX_PREFERRED_COUNTRIES — at the cap the
//   toggle is a no-op and the caller's UI communicates the limit. A legacy
//   list already OVER the cap can still remove freely; it just can't grow.
export function withCountryToggled(selected: readonly string[], name: string): string[] {
  if (selected.includes(name)) return selected.filter((c) => c !== name)
  if (selected.length >= MAX_PREFERRED_COUNTRIES) return [...selected]
  return [...selected, name]
}

// Promotes an ALREADY-SELECTED country to primary (index 0), preserving the
// relative order of everything else.
//
// Onboarding can reasonably leave "first selected wins" as the only way to
// set a primary — you're choosing the list for the first time there. In
// Settings that rule is hostile: changing which of your five countries ranks
// highest would mean deselecting and reselecting several of them in the
// right order, and getting the order wrong silently changes stream ranking.
//
// A no-op for a country that isn't selected (nothing to promote) and for one
// that is already primary — so a caller can wire it to a button that's
// always mounted without special-casing either.
export function withPrimaryCountry(selected: readonly string[], name: string): string[] {
  if (!selected.includes(name)) return [...selected]
  return [name, ...selected.filter((c) => c !== name)]
}

// Favorite teams have no cap (see SportPreferences.favoriteTeamIds): a
// football fan following a domestic club, a European giant and a couple of
// local sides is a completely normal selection, and there is no scarce
// resource here the way there is for preferred countries (which are an
// ORDERED priority list feeding stream selection). Selection order carries
// no meaning, so this simply appends.
//
// Shared by onboarding and Settings so the two can't drift, exactly like
// withCountryToggled above.
export function withTeamToggled(selected: readonly string[], teamId: string): string[] {
  if (selected.includes(teamId)) return selected.filter((id) => id !== teamId)
  return [...selected, teamId]
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

// Preferences persisted before streamType existed simply lack the field —
// filled in as 'auto' (and any unrecognized stored value is treated the
// same) at read time, never written back just for that: a user who has
// never expressed a stream-type preference shouldn't have one materialized
// into storage on their behalf.
function normalizeStreamType(stored: unknown): StreamTypePreference {
  return stored === 'tv' || stored === 'event' ? stored : 'auto'
}

// Preferences persisted before favoriteTeamIds existed simply lack the
// field; a corrupted/hand-edited store could also hold something that isn't
// an array of strings. Both normalize to a usable list at READ time rather
// than being written back — a user who has never followed a team shouldn't
// have an empty list materialized into storage on their behalf, and an
// existing install must keep every other preference it already had.
function normalizeTeamIds(stored: unknown): string[] {
  if (!Array.isArray(stored)) return []
  const ids = stored.filter((id): id is string => typeof id === 'string' && id.length > 0)
  return Array.from(new Set(ids))
}

export function loadPreferences(): SportPreferences {
  const stored = readStored(PREFERENCES_KEY, DEFAULT_PREFERENCES)
  // `?? []` rather than a bare read: everything below has to survive a
  // partially-shaped stored object (an older schema, a hand-edited store),
  // because failing here would take the whole app down at startup — App.tsx
  // calls this on every render.
  const migratedFootballLeagueIds = migrateFootballLeagueIds(stored.footballLeagueIds ?? [])

  // Only write back when migration actually changed something — a
  // brand-new user who has never saved anything falls back to
  // DEFAULT_PREFERENCES, which is already canonical, so this is a no-op
  // and nothing gets written to storage on their behalf before they've
  // made a real choice.
  if (JSON.stringify(migratedFootballLeagueIds) !== JSON.stringify(stored.footballLeagueIds)) {
    const migrated: SportPreferences = {
      ...stored,
      footballLeagueIds: migratedFootballLeagueIds,
      streamType: normalizeStreamType(stored.streamType),
      favoriteTeamIds: normalizeTeamIds(stored.favoriteTeamIds),
    }
    writeStored(PREFERENCES_KEY, migrated)
    return migrated
  }
  return { ...stored, streamType: normalizeStreamType(stored.streamType), favoriteTeamIds: normalizeTeamIds(stored.favoriteTeamIds) }
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
