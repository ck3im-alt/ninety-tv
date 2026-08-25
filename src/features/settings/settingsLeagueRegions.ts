// Groups the canonical competition catalog into the region rail Settings
// browses leagues through.
//
// The catalog is ~50 competitions. Rendering all of them at once — which is
// what the old Settings screen did, in an eight-column card grid — is both a
// wall of noise from a sofa and a focus graph with no sensible structure.
// One region at a time is the same interaction concept onboarding's league
// browser uses (features/onboarding/LeagueBrowser.tsx), and this is
// deliberately a SEPARATE implementation of it: onboarding's is a
// fixed-height first-run panel with its own focus chain, Settings' is a
// column inside a dense control pane. Sharing the components would couple
// two very different layouts for no benefit.
//
// What the two DO share is meaning, not markup: canonical ids, region,
// countryCode, and — via data/sports/competitionGrouping.ts — which
// competitions count as international. A league the user follows must be
// found in the same group on both screens.
//
// Identity still comes from ninety-api's registry via
// data/sports/competitionsCatalog.ts — canonical ids, badges, region,
// countryCode, tier and type. No Settings-specific league catalog exists.
import { INTERNATIONAL_GROUP_LABEL, isSupranationalCompetition } from '../../data/sports/competitionGrouping'
import type { LeagueDef } from '../../data/sports/leagues'

const UNGROUPED = 'Other'

export interface LeagueRegionGroup {
  region: string
  leagues: LeagueDef[]
  // How many of this region's competitions the user currently follows —
  // shown as a badge on the rail so "where are my selections" is answerable
  // without opening every region.
  selectedCount: number
}

// Ordering is deliberately INDEPENDENT of the user's current selection:
// biggest-competition regions first, then by how much the region carries,
// then alphabetically. Sorting by selection instead would make regions
// physically move while the user is selecting inside them — the row under
// the highlight would change identity mid-press.
export function groupLeaguesByRegion(leagues: readonly LeagueDef[], selectedIds: readonly string[]): LeagueRegionGroup[] {
  const selected = new Set(selectedIds)
  const groups = new Map<string, LeagueRegionGroup>()

  for (const league of leagues) {
    // Supranational competitions (UEFA/CONMEBOL/FIFA) are grouped together
    // rather than filed under the nominal region the registry gives them —
    // the Champions League under "Europe" and the Copa Libertadores under
    // "South America" would put the same kind of competition in two places,
    // and would disagree with where onboarding put it when the user picked
    // it. Same rule, one definition: see competitionGrouping.ts.
    const region = isSupranationalCompetition(league)
      ? INTERNATIONAL_GROUP_LABEL
      : league.region?.trim() || UNGROUPED
    let group = groups.get(region)
    if (!group) {
      group = { region, leagues: [], selectedCount: 0 }
      groups.set(region, group)
    }
    group.leagues.push(league)
    if (selected.has(league.id)) group.selectedCount += 1
  }

  for (const group of groups.values()) {
    // Within a region: most important competitions first (tier 1 before
    // tier 3, unranked last), then alphabetically so the order is total.
    group.leagues.sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9) || a.name.localeCompare(b.name))
  }

  return [...groups.values()].sort((a, b) => {
    if (a.region === UNGROUPED) return 1
    if (b.region === UNGROUPED) return -1
    return topTierCount(b) - topTierCount(a) || b.leagues.length - a.leagues.length || a.region.localeCompare(b.region)
  })
}

function topTierCount(group: LeagueRegionGroup): number {
  return group.leagues.filter((league) => league.tier === 1).length
}

// The region to open the browser on: wherever the user already follows the
// most competitions, falling back to the first region. Evaluated once when
// the pane mounts (see SportsLeaguesPane) rather than continuously, so
// selecting a league somewhere else never yanks the browser to another
// region mid-interaction.
export function initialRegion(groups: readonly LeagueRegionGroup[]): string | null {
  if (groups.length === 0) return null
  let best = groups[0]
  for (const group of groups) {
    if (group.selectedCount > best.selectedCount) best = group
  }
  return best.region
}

// The user's current selections, resolved against the catalog and kept in
// the catalog's own order so the "Selected" strip doesn't reshuffle every
// time something is added. Ids with no matching competition (a league that
// left the registry) are dropped from the DISPLAY only — never from the
// stored preference, which stays exactly as the user left it.
export function selectedLeagues(leagues: readonly LeagueDef[], selectedIds: readonly string[]): LeagueDef[] {
  const selected = new Set(selectedIds)
  return leagues.filter((league) => selected.has(league.id))
}
