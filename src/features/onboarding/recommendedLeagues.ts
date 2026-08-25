// Which football competitions onboarding's step 2 shows BEFORE the user
// asks to see all ~50. Pure and parameterized on the canonical catalog
// (GET /v1/competitions via data/sports/competitionsCatalog.ts) — this
// module contributes editorial ORDERING and one explicit id list, and
// resolves every name/badge/country/tier from that catalog. It deliberately
// hardcodes no competition metadata of its own; a competition missing from
// the catalog simply doesn't appear.
import type { LeagueDef } from '../../data/sports/leagues'

// The product's editorial "Big Five" definition. An explicit id list is
// correct here (unlike names/badges/tiers, which must come from the
// catalog): "the big five European domestic leagues" is a curatorial
// judgement, not something derivable from tier/country metadata — La Liga
// and the Eredivisie are both a country's top flight, and only one of them
// belongs in this row.
export const BIG_FIVE_COMPETITION_IDS: readonly string[] = [
  'football_premier_league',
  'football_la_liga',
  'football_bundesliga',
  'football_serie_a',
  'football_ligue_1',
]

// A supranational European competition, as the catalog itself describes it:
// no country of its own (countryCode null — see ninety-api's LeagueConfig)
// plus region 'Europe'. Derived rather than listed by id ON PURPOSE, so
// that when the canonical registry eventually gains a UEFA competition it
// doesn't carry today (the Conference League is the obvious candidate — it
// is genuinely absent from footballdata.io's Starter catalog, so Ninety
// tracks no such competition and this module must not invent a card for
// one), it appears here with no ninety-tv release needed.
function isUefaCompetition(league: LeagueDef): boolean {
  return league.countryCode == null && league.region === 'Europe'
}

// Deterministic ordering for the derived (non-editorially-ordered) groups:
// most important tier first, then alphabetically by name, then by id. Name
// before id so the visible order is the one a person would predict; id last
// purely so the sort can never depend on array order from the API.
function byPrestigeThenName(a: LeagueDef, b: LeagueDef): number {
  return (a.tier ?? 9) - (b.tier ?? 9) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
}

export function uefaCompetitions(catalog: readonly LeagueDef[]): LeagueDef[] {
  return catalog.filter(isUefaCompetition).sort(byPrestigeThenName)
}

// A country's own top-flight league, from catalog metadata only.
//
// Ranking: an actual league outranks a cup/qualifier (a Norwegian viewer
// should be offered Eliteserien, not the Norwegian Cup), then the best
// tier, then the same deterministic name/id tie-break as above.
//
// This also resolves the GB ambiguity correctly with no special case:
// England and Scotland share countryCode 'GB' (there is no separate ISO
// code for the home nations), and Premier League is the only tier-1 GB
// league in the catalog, so it wins over Scotland's Premiership on tier
// alone rather than on any hardcoded preference.
export function homeCountryLeague(catalog: readonly LeagueDef[], countryCode: string | null): LeagueDef | null {
  if (!countryCode) return null
  const code = countryCode.toUpperCase()
  const candidates = catalog.filter((l) => l.countryCode?.toUpperCase() === code)
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => {
    const aLeague = a.type === 'league' ? 0 : 1
    const bLeague = b.type === 'league' ? 0 : 1
    return aLeague - bLeague || byPrestigeThenName(a, b)
  })[0]
}

// Big Five + every tracked UEFA competition + the viewer's own top domestic
// league, in that editorial order, de-duplicated by competition id.
//
// A UK viewer's home league IS the Premier League, which is already in the
// Big Five — dedup means it renders once, not twice, and no eighth card is
// conjured up to keep the row a fixed length. An undetected country (or one
// with no tracked domestic league) simply contributes nothing.
export function buildRecommendedLeagues(catalog: readonly LeagueDef[], countryCode: string | null): LeagueDef[] {
  const byId = new Map(catalog.map((l) => [l.id, l]))
  const ordered: (LeagueDef | undefined)[] = [
    ...BIG_FIVE_COMPETITION_IDS.map((id) => byId.get(id)),
    ...uefaCompetitions(catalog),
    homeCountryLeague(catalog, countryCode) ?? undefined,
  ]

  const seen = new Set<string>()
  const result: LeagueDef[] = []
  for (const league of ordered) {
    if (!league || seen.has(league.id)) continue
    seen.add(league.id)
    result.push(league)
  }
  return result
}
