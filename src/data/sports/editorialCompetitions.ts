// Ninety's editorial judgements about WHICH COMPETITIONS are which, as
// opposed to what they are called or who plays in them.
//
// The competition catalogue itself is and stays ninety-api's (GET
// /v1/competitions, via competitionsCatalog.ts) — names, badges, countries,
// regions and tiers all come from there. This module holds only the id sets
// that are a curatorial CHOICE Ninety makes on top of that catalogue and
// that more than one feature needs to agree on.
//
// It lives in the data layer rather than under a feature because both an
// onboarding screen (which competitions to pin) and Home's content policy
// (what counts as a marquee league) ask the same question, and a data
// module must never import from a feature. Before 2026-08-28 the Big Five
// list lived in features/onboarding/recommendedLeagues.ts; Home needed the
// same definition, and a second copy of it would have been free to drift.

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

// Membership-test form of the same list. Home's content policy asks this
// question once per candidate event on every derivation (and every ~60s
// background refresh), where a linear scan of the array would be pure
// waste; onboarding, which iterates the list in editorial order, keeps
// using the array above.
export const BIG_FIVE_COMPETITION_ID_SET: ReadonlySet<string> = new Set(BIG_FIVE_COMPETITION_IDS)

export function isBigFiveCompetition(competitionId: string | null | undefined): boolean {
  return competitionId != null && BIG_FIVE_COMPETITION_ID_SET.has(competitionId)
}
