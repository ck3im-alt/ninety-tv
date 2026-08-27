// The order of competitions in the Teams step's browser rail.
//
// THE RULE THIS ENCODES: league selection PRIORITIZES clubs, it never
// restricts which ones exist. Every competition in the catalogue is in the
// rail — a viewer who follows only Eliteserien can still walk down to La
// Liga and follow Real Madrid — but the ones they actually picked are at
// the top, where a remote reaches them first.
//
// Pure, and parameterized on the fetched catalog (GET /v1/competitions), so
// it hardcodes no competition names, ids or countries of its own.
import type { LeagueDef } from '../../data/sports/leagues'

// Within each half: most important tier first, then real leagues ahead of
// cups/qualifiers at the same tier (a club's LEAGUE is the sensible way to
// find it; nobody looks for Arsenal under the FA Cup), then alphabetically.
// Name-then-id last so the order never depends on what order the API
// happened to return.
function byTierThenKindThenName(a: LeagueDef, b: LeagueDef): number {
  const tier = (a.tier ?? 9) - (b.tier ?? 9)
  if (tier !== 0) return tier
  const kind = (a.type === 'league' ? 0 : 1) - (b.type === 'league' ? 0 : 1)
  if (kind !== 0) return kind
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
}

export function orderTeamRail(catalog: readonly LeagueDef[], selectedLeagueIds: ReadonlySet<string>): LeagueDef[] {
  const followed: LeagueDef[] = []
  const rest: LeagueDef[] = []
  const seen = new Set<string>()
  for (const league of catalog) {
    // Defensive: a catalog that ever returned the same id twice must not
    // produce two rail rows sharing one `teamgroup-<id>` focus key.
    if (seen.has(league.id)) continue
    seen.add(league.id)
    ;(selectedLeagueIds.has(league.id) ? followed : rest).push(league)
  }
  return [...followed.sort(byTierThenKindThenName), ...rest.sort(byTierThenKindThenName)]
}
