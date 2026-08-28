// Curated per-competition artwork: the Match View header (Event Details)
// and Home's hero.
//
// Editorial data in the same spirit as heroScoring.ts's prestige overrides
// and leagues.ts's staticBackground: a hand-picked choice per competition,
// written down and easy to extend, never derived from anything the API
// sends. A competition with no entry here simply gets the generic gradient
// wash + arcs the header already draws (Match View) or the unbranded
// stadium fallback (Home) — this is an enhancement layer, not a
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
// (The Home hero family below works the same way, from its own directory.)
//
// Paths are relative to the app base, the same asset-path convention as
// leagues.ts's staticBackground and countryCodes.ts's flagSrc — resolved
// against import.meta.env.BASE_URL below so they work under both the packaged
// Tizen widget (file://) and a subpath deploy.
const MATCH_HERO_BY_COMPETITION: Record<string, string> = {
  football_premier_league: 'backgrounds/Match_hero/Premier_League.jpg',
  football_la_liga: 'backgrounds/Match_hero/La_liga.jpg',
  football_serie_a: 'backgrounds/Match_hero/Serie_A.jpg',
  football_bundesliga: 'backgrounds/Match_hero/Bundesliga.jpg',
  football_ligue_1: 'backgrounds/Match_hero/Ligue_1.jpg',
  football_champions_league: 'backgrounds/Match_hero/Champions_League.jpg',
  football_europa_league: 'backgrounds/Match_hero/Europa_League.jpg',
  'norway-eliteserien': 'backgrounds/Match_hero/Eliteserien.jpg',
  'sweden-allsvenskan': 'backgrounds/Match_hero/Allsvenskan.jpg',
  'denmark-superliga': 'backgrounds/Match_hero/Superliga_DK.jpg',
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

// The Home hero family — a SECOND, deliberately different composition, not
// the same photos reused. Home lays the fixture title, competition name and
// Watch Now button over the LEFT of a full-bleed 1920×560 hero and darkens
// that side with a left-to-right scrim (.hero::before in HomeScreen.css),
// so these frames are shot dark and empty on the left with the lit stand
// structure out on the right, clear of the text. A Match_hero banner used
// here would put one of its two lit edges directly under the title, which
// is exactly why the two directories exist rather than one shared set.
//
// Sources are ~1773–2172 px wide at roughly 5:2 to 2:1; Home crops them
// cover/centre (.hero-background-image), so the safe area is the middle
// band of each frame in both families.
//
// denmark-superliga has a Match_hero banner but no Home hero yet, and so
// falls through to mapEvent.ts's unbranded fallback rather than borrowing
// another league's stadium — a wrong-league photo reads as a bug on Home,
// where the competition name sits right on top of it.
const HOME_HERO_BY_COMPETITION: Record<string, string> = {
  football_premier_league: 'backgrounds/League_main_hero/Premier_League.jpg',
  football_la_liga: 'backgrounds/League_main_hero/La_liga.jpg',
  football_serie_a: 'backgrounds/League_main_hero/Serie_A.jpg',
  football_bundesliga: 'backgrounds/League_main_hero/Bundesliga.jpg',
  football_ligue_1: 'backgrounds/League_main_hero/Ligue_1.jpg',
  football_champions_league: 'backgrounds/League_main_hero/Champions_League.jpg',
  football_europa_league: 'backgrounds/League_main_hero/Europa_League.jpg',
  'norway-eliteserien': 'backgrounds/League_main_hero/Eliteserien.jpg',
  'sweden-allsvenskan': 'backgrounds/League_main_hero/Allsvenskan.jpg',
}

// null, same contract as competitionMatchHero: the caller decides what an
// uncovered competition gets (mapEvent.ts falls back to provider artwork
// first, then the generic stadium).
export function competitionHomeHero(leagueId: string | undefined): string | null {
  if (!leagueId) return null
  const path = HOME_HERO_BY_COMPETITION[leagueId]
  return path ? `${import.meta.env.BASE_URL}${path}` : null
}

// Test-only views of which competitions are covered, so a test can assert
// across the whole set without reaching into module internals.
export const MATCH_HERO_COMPETITION_IDS = Object.keys(MATCH_HERO_BY_COMPETITION)
export const HOME_HERO_COMPETITION_IDS = Object.keys(HOME_HERO_BY_COMPETITION)
