import type { SportKey } from './types'

// Football competitions are NO LONGER hardcoded here (removed 2026-08-20's
// Phase 1.1 audit) -- they're fetched at runtime from ninety-api's
// canonical registry (GET /v1/competitions, backed by its own
// sports/leagues.ts) via competitionsCatalog.ts. Before this change,
// ninety-tv maintained its own independently-hand-synced copy of the same
// 50-competition catalog, which is exactly the "two sources of truth"
// problem the backend registry was built to prevent -- see ninety-api's
// docs/THIRD_PARTY.md and this repo's git history around that date.
//
// STATIC_LEAGUES below is now only the sports that genuinely have no
// backend competition registry entry: F1, which is sourced entirely from
// TheSportsDB (a completely different provider/data model, not a football
// competition), and has no reason to ever come from ninety-api.
export interface LeagueDef {
  id: string
  sportKey: SportKey
  sportLabel: string
  tsdbSport: string // TheSportsDB's own `strSport` value, needed for livescore.php
  // Canonical display name -- for football entries this is fetched
  // straight from ninety-api's competition registry (NinetyCompetition.name
  // in ninetyApiClient.ts), not hand-authored here.
  name: string
  // The competition's own country/region (e.g. "England", "Scotland",
  // "Europe", "International") -- football only. Deliberately NOT the
  // viewing/EPG country: a Champions League match's Norwegian broadcaster
  // has nothing to do with this field. Kept separate on purpose so Phase 2
  // (EPG country expansion) can key broadcaster mappings on
  // (ninetyCompetitionId, viewingCountry) without this needing to change.
  region?: string
  // ISO-3166-1 alpha-2, null for supranational competitions (UEFA/
  // CONMEBOL/FIFA). England and Scotland both resolve to GB -- there's no
  // separate ISO code for the home nations, which is exactly why `region`
  // exists as the field that actually disambiguates them for display.
  countryCode?: string | null
  // Editorial competition-importance tier (1 = biggest, 3 = smallest),
  // football only -- drives heroScoring.ts's prestige weighting via
  // SportEvent.leagueTier (set at mapping time, see mapEvent.ts). Mirrors
  // ninety-api's LeagueConfig.tier.
  tier?: 1 | 2 | 3
  badge?: string // league crest, used by the onboarding sport-picker grid
  // Overrides whatever event image TheSportsDB provides for fixtures in
  // this league — used for leagues where we have a specific curated hero
  // shot we want every fixture to use, regardless of the actual teams
  // playing. Public path (served from /public), not an API-sourced URL.
  staticBackground?: string
  // Ninety's own competition id (ninety-api's src/sports/leagues.ts) —
  // for a football LeagueDef fetched from the catalog this always equals
  // `id` (both are the backend's competitionId); kept as a separate field
  // rather than collapsed into `id` because non-football entries (F1)
  // legitimately have no backend-competition equivalent, so `id` alone
  // can't imply "this has backend fixture coverage" the way this
  // optional field can.
  ninetyCompetitionId?: string
}

export const STATIC_LEAGUES: LeagueDef[] = [
  {
    id: '4370',
    sportKey: 'f1',
    sportLabel: 'F1',
    tsdbSport: 'Motorsport',
    name: 'Formula 1',
    staticBackground: `${import.meta.env.BASE_URL}backgrounds/f1.jpg`,
  },
  // Golf/tennis/MMA/basketball dropped 2026-08-13 — see the note on
  // SportKey in types.ts for why.
]

// Maps TheSportsDB ids -- the only id space that existed before
// 2026-08-20 -- to ninety-api's canonical competitionId, for migrating
// SportPreferences.footballLeagueIds values saved before that date (see
// data/preferences.ts's migrateFootballLeagueIds). Deliberately covers
// only the 7 competitions Ninety tracked pre-expansion; every id added
// since has only ever existed in canonical form, so there's nothing to
// alias for them.
//
// UEFA Conference League ('5071') intentionally has NO entry here: it was
// never backed by ninety-api (footballdata.io's Starter catalog doesn't
// carry it at all -- confirmed live, see ninety-api's sports/leagues.ts),
// so there is no canonical id to migrate it to. A user who had it selected
// loses that one dead, always-non-functional selection on migration --
// every other selection is preserved untouched, and the raw legacy string
// is left in place rather than actively stripped out (see
// migrateFootballLeagueIds's own comment for why that's safe).
export const LEGACY_FOOTBALL_LEAGUE_ID_ALIASES: Record<string, string> = {
  '4328': 'football_premier_league',
  '4480': 'football_champions_league',
  '4335': 'football_la_liga',
  '4332': 'football_serie_a',
  '4331': 'football_bundesliga',
  '4334': 'football_ligue_1',
  '4481': 'football_europa_league',
}

// Pure and parameterized on the fetched football catalog -- see
// competitionsCatalog.ts for where that catalog actually comes from
// (a cached GET /v1/competitions fetch). Ids not present in
// footballLeagues (a stale/removed/never-existed selection) are silently
// excluded from the result, not an error -- see useHomeFeed.ts's handling
// of the "a stored competition no longer exists" case.
export function footballLeaguesForPreferences(footballLeagueIds: string[], footballLeagues: LeagueDef[]): LeagueDef[] {
  return footballLeagues.filter((l) => footballLeagueIds.includes(l.id))
}

// Non-football sports (just F1 today) only ever have one league each in
// STATIC_LEAGUES, so "selected sports" is the only filter needed -- no
// per-league id list exists for these the way footballLeagueIds does.
export function otherLeaguesForPreferences(sports: SportKey[]): LeagueDef[] {
  return STATIC_LEAGUES.filter((l) => l.sportKey !== 'football' && sports.includes(l.sportKey))
}
