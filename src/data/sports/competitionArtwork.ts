// Curated per-competition artwork for the Match View header (Event Details).
//
// Editorial data in the same spirit as heroScoring.ts's prestige overrides
// and leagues.ts's staticBackground: a hand-picked choice per competition,
// written down and easy to extend, never derived from anything the API
// sends. A competition with no entry here simply gets the generic gradient
// wash + arcs the header already draws — this is an enhancement layer, not a
// requirement, so nothing breaks by being absent.
//
// Keyed by SportEvent.leagueId — ninety-api's CANONICAL competition id — and
// deliberately not by competition name. That is load-bearing rather than
// stylistic, and the catalog proves it: 'Bundesliga' is BOTH Germany's
// (football_bundesliga, which has artwork) and Austria's (austria-bundesliga,
// which does not); 'Serie A' is both Italy's (football_serie_a) and Brazil's
// (brazil-serie-a); and 'Premier League' is a substring of 'Canadian Premier
// League'. A name or substring match would hand German artwork to an Austrian
// fixture and English artwork to a Canadian one. This replaced exactly such a
// text match — an isChampionsLeague substring test that was the only way to
// get the single curated photo that existed before 2026-08-26.

// One matched, purpose-built family: ~2172×724 wide banners, dark through the
// middle (so the crests, team names and VS stay legible on top) with the lit
// stand structures out at the left and right edges, framing the matchup. They
// share one CSS treatment — cover, centred (see .event-header-backdrop-photo
// in EventDetailsScreen.css) — because they share one composition; centre is
// what keeps those lit edges in shot, where top-cropping would show only the
// near-black upper stands.
//
// To add another competition: drop a banner in public/backgrounds/Match_hero/
// following the same composition, then add one line here keyed by its
// canonical id from GET /v1/competitions. No other file needs to change.
//
// Paths are relative to the app base, the same asset-path convention as
// leagues.ts's staticBackground and countryCodes.ts's flagSrc — resolved
// against import.meta.env.BASE_URL below so they work under both the packaged
// Tizen widget (file://) and a subpath deploy.
const MATCH_HERO_BY_COMPETITION: Record<string, string> = {
  football_premier_league: 'backgrounds/Match_hero/Premier_League.png',
  football_la_liga: 'backgrounds/Match_hero/La_liga.png',
  football_serie_a: 'backgrounds/Match_hero/Serie_A.png',
  football_bundesliga: 'backgrounds/Match_hero/Bundesliga.png',
  football_ligue_1: 'backgrounds/Match_hero/Ligue_1.png',
  football_champions_league: 'backgrounds/Match_hero/Champions_League.png',
  football_europa_league: 'backgrounds/Match_hero/Europa_League.png',
  'norway-eliteserien': 'backgrounds/Match_hero/Eliteserien.png',
  'sweden-allsvenskan': 'backgrounds/Match_hero/Allsvenskan.png',
  'denmark-superliga': 'backgrounds/Match_hero/Superliga_DK.png',
}

// null — never a placeholder or a fallback image — for a competition with no
// curated artwork, which is the normal case for most of the 50-competition
// catalog. The caller uses that to choose between the photo treatment and the
// generic gradient-plus-arcs one.
export function competitionMatchHero(leagueId: string | undefined): string | null {
  if (!leagueId) return null
  const path = MATCH_HERO_BY_COMPETITION[leagueId]
  return path ? `${import.meta.env.BASE_URL}${path}` : null
}

// Test-only view of which competitions are covered, so a test can assert
// across the whole set without reaching into module internals.
export const MATCH_HERO_COMPETITION_IDS = Object.keys(MATCH_HERO_BY_COMPETITION)
