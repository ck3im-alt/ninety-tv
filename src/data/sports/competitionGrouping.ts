// The one rule for "is this competition supranational?", shared by every
// surface that groups the competition catalog for browsing.
//
// Two such surfaces exist right now and they are deliberately separate
// components — onboarding's fixed-height league browser
// (features/onboarding/browseCompetitions.ts) and Settings' region rail
// (features/settings/settingsLeagueRegions.ts). Their LAYOUT has no reason
// to be shared, and since 2026-08-28 they do not even share an interaction:
// onboarding pages a flat grid under a Domestic/International switch, while
// Settings still opens one region at a time. Their DATA SEMANTICS do have
// to match: a user who follows the Champions League from onboarding's
// International scope must find it in Settings' "International
// competitions" group, not filed under "Europe".
//
// Only the classification and its label live here — no grouping, no
// ordering, no UI, no focus behaviour — so sharing this costs neither
// surface any independence.
import type { LeagueDef } from './leagues'

export const INTERNATIONAL_GROUP_LABEL = 'International competitions'

// A supranational competition is one the registry gives no country of its
// own — UEFA, CONMEBOL and FIFA competitions all carry `country_code: null`
// while every domestic competition carries a real ISO2 code (see
// competitionsCatalog.ts's mapping of NinetyCompetition.country_code, which
// is always present and typed `string | null`). That single field is the
// whole classification; the regions those entries happen to use today
// ('Europe', 'International', 'South America') are NOT enumerated here, so a
// supranational competition in a new region classifies correctly the day the
// backend adds it.
//
// Undefined is treated the same as null. In production the field is always
// set; hand-built LeagueDefs that omit it are saying "no country", which is
// exactly what this returns true for.
export function isSupranationalCompetition(league: Pick<LeagueDef, 'countryCode'>): boolean {
  return league.countryCode == null
}
