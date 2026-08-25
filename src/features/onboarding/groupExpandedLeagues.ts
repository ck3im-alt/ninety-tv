// Turns the canonical competition catalog into the GROUPED "All leagues"
// catalogue that onboarding step 2 appends below the recommendations when
// the user opens "More leagues".
//
// Pure and parameterized on the fetched catalog (GET /v1/competitions) —
// this module classifies and orders, it never hardcodes a second league
// list, a competition name, or a country mapping. Everything comes from
// LeagueDef's own countryCode/region/tier/type, which are ninety-api's
// LeagueConfig fields passed straight through (see competitionsCatalog.ts).
import { INTERNATIONAL_GROUP_LABEL, isSupranationalCompetition } from '../../data/sports/competitionGrouping'
import type { LeagueDef } from '../../data/sports/leagues'
import { homeCountryLeague } from './recommendedLeagues'

export interface LeagueGroup {
  // Stable across renders and unique per group — used as the React key and
  // as the prefix for the group's own card focus keys.
  key: string
  label: string
  leagues: LeagueDef[]
}

export const INTERNATIONAL_GROUP_KEY = 'international'

// Re-exported so this module stays the single import for everything about
// the expanded catalogue's grouping. The classification itself, and this
// label, are shared with Settings' own league browser — see
// data/sports/competitionGrouping.ts for why only the SEMANTICS are shared
// and not the two components' layout.
export { INTERNATIONAL_GROUP_LABEL }

// Domestic competitions group by REGION, not countryCode. England and
// Scotland both carry countryCode 'GB' (there is no separate ISO code for
// the home nations), so grouping by code would collapse the Premiership and
// the FA Cup into one misleading "United Kingdom" bucket. `region` is
// ninety-api's own country field verbatim and is exactly the distinction
// the backend maintains for this purpose.
function regionGroupKey(region: string): string {
  return `region:${region}`
}

// Within a group: most important tier first, then actual leagues ahead of
// cups/qualifiers at the same tier, then alphabetically. Name-then-id last
// so ordering never depends on the order the API happened to return.
function byTierThenKindThenName(a: LeagueDef, b: LeagueDef): number {
  const tier = (a.tier ?? 9) - (b.tier ?? 9)
  if (tier !== 0) return tier
  const kind = (a.type === 'league' ? 0 : 1) - (b.type === 'league' ? 0 : 1)
  if (kind !== 0) return kind
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
}

interface Options {
  // The full catalog, exactly as fetched.
  leagues: readonly LeagueDef[]
  // Already visible in the pinned "Recommended leagues" row — excluded from
  // the catalogue below so no competition is ever rendered twice (which
  // would also mean two focusables sharing one `league-<id>` focus key).
  recommendedLeagueIds: readonly string[]
  // Canonical ISO2-ish code for the TV's own country, or null. Only used
  // for group ORDER; a competition's own grouping never depends on it.
  viewerCountryCode?: string | null
}

// The viewer's own domestic region, when it can be derived without
// guessing. Reuses homeCountryLeague — the same resolution that already
// decides which domestic league to recommend — so "home" means exactly the
// same thing in both places. For GB that resolves to the Premier League and
// therefore 'England' rather than an invented England-vs-Scotland tiebreak
// of this module's own; for a country with no tracked competition it
// resolves to null and the home-first ordering is simply skipped.
function homeRegion(leagues: readonly LeagueDef[], viewerCountryCode: string | null | undefined): string | null {
  const home = homeCountryLeague(leagues, viewerCountryCode ?? null)
  return home?.region ?? null
}

// Group order: the viewer's own region first (when derivable), then the
// international competitions, then every remaining region alphabetically.
// Empty groups never reach this — see the filter in groupExpandedLeagues.
function groupSortWeight(group: LeagueGroup, home: string | null): number {
  if (home && group.key === regionGroupKey(home)) return 0
  if (group.key === INTERNATIONAL_GROUP_KEY) return 1
  return 2
}

export function groupExpandedLeagues({ leagues, recommendedLeagueIds, viewerCountryCode }: Options): LeagueGroup[] {
  const excluded = new Set(recommendedLeagueIds)
  const seen = new Set<string>()

  const byKey = new Map<string, LeagueGroup>()
  for (const league of leagues) {
    if (excluded.has(league.id)) continue
    // Defensive: a catalog that ever returned the same id twice must not
    // produce two cards with the same focus key.
    if (seen.has(league.id)) continue
    seen.add(league.id)

    const supranational = isSupranationalCompetition(league)
    const key = supranational ? INTERNATIONAL_GROUP_KEY : regionGroupKey(league.region ?? 'Other')
    const label = supranational ? INTERNATIONAL_GROUP_LABEL : (league.region ?? 'Other')
    const group = byKey.get(key)
    if (group) group.leagues.push(league)
    else byKey.set(key, { key, label, leagues: [league] })
  }

  const home = homeRegion(leagues, viewerCountryCode)
  return [...byKey.values()]
    .filter((group) => group.leagues.length > 0)
    .map((group) => ({ ...group, leagues: [...group.leagues].sort(byTierThenKindThenName) }))
    .sort((a, b) => groupSortWeight(a, home) - groupSortWeight(b, home) || a.label.localeCompare(b.label))
}
