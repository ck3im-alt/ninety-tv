// GET /v1/competitions, verbatim — all 50 entries, in the order the
// deployed ninety-api actually returns them (re-fetched live 2026-08-28;
// ninety-api's own src/sports/leagues.ts is the source these values come
// from, byte-for-byte). Test-only: production code never builds LeagueDefs
// by hand, it maps the fetched catalog (competitionsCatalog.ts).
//
// THE WHOLE CATALOGUE RATHER THAN A SLICE, since 2026-08-28. This started
// as ~24 hand-picked rows covering the shapes the recommendation logic had
// to get right, which is no longer enough: the league browser now PAGES the
// remaining catalogue, so its page count, its ordering across a page break
// and its "only one page is mounted" invariant are only meaningful against
// the real size. The interesting shapes are all still in here, and are
// still what the fixture exists for:
//   - England and Scotland both carrying countryCode 'GB'
//   - GB cup competitions that must not outrank the Premier League
//   - a country (US) with seven competitions, whose best league is tier 2
//   - a country (PT) where a league and a cup share the same tier
//   - supranational UEFA entries with countryCode null / region 'Europe'
//   - non-UEFA supranational entries (CONMEBOL, FIFA) that must NOT be
//     treated as UEFA ones
//   - genuinely ambiguous names that only their region disambiguates: an
//     Austrian "Bundesliga", a Brazilian "Serie A", a Scottish
//     "Premiership"
//
// API ORDER IS PRESERVED, and load-bearing: it is grouped by market rather
// than sorted by anything, so a test that asserts an ordering rule fails if
// the code ever just passes the array through.
import type { LeagueDef } from '../../data/sports/leagues'

function league(
  id: string,
  name: string,
  countryCode: string | null,
  region: string,
  type: LeagueDef['type'],
  tier: 1 | 2 | 3,
): LeagueDef {
  return {
    id,
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    tsdbSport: 'Soccer',
    name,
    region,
    countryCode,
    type,
    tier,
    badge: `https://footballdata.io/img/league/${id}.png`,
    ninetyCompetitionId: id,
  }
}

export const TEST_CATALOG: LeagueDef[] = [
  league('football_premier_league', 'Premier League', 'GB', 'England', 'league', 1),
  league('england-championship', 'Championship', 'GB', 'England', 'league', 2),
  league('england-efl-league-one', 'EFL League One', 'GB', 'England', 'league', 3),
  league('england-national-league', 'National League', 'GB', 'England', 'league', 3),
  league('england-fa-cup', 'FA Cup', 'GB', 'England', 'cup', 2),
  league('england-league-cup', 'League Cup', 'GB', 'England', 'cup', 2),
  league('football_champions_league', 'UEFA Champions League', null, 'Europe', 'cup', 1),
  league('football_europa_league', 'UEFA Europa League', null, 'Europe', 'cup', 1),
  league('football_la_liga', 'La Liga', 'ES', 'Spain', 'league', 1),
  league('spain-segunda-division', 'Segunda División', 'ES', 'Spain', 'league', 3),
  league('spain-copa-del-rey', 'Copa del Rey', 'ES', 'Spain', 'cup', 2),
  league('football_bundesliga', 'Bundesliga', 'DE', 'Germany', 'league', 1),
  league('football_serie_a', 'Serie A', 'IT', 'Italy', 'league', 1),
  league('football_ligue_1', 'Ligue 1', 'FR', 'France', 'league', 1),
  league('france-coupe-de-la-ligue', 'Coupe de la Ligue', 'FR', 'France', 'cup', 3),
  league('norway-eliteserien', 'Eliteserien', 'NO', 'Norway', 'league', 2),
  league('sweden-allsvenskan', 'Allsvenskan', 'SE', 'Sweden', 'league', 2),
  league('sweden-superettan', 'Superettan', 'SE', 'Sweden', 'league', 3),
  league('denmark-superliga', 'Superliga', 'DK', 'Denmark', 'league', 2),
  league('netherlands-eredivisie', 'Eredivisie', 'NL', 'Netherlands', 'league', 2),
  league('portugal-ligapro', 'LigaPro', 'PT', 'Portugal', 'league', 3),
  league('portugal-portuguese-super-cup', 'Portuguese Super Cup', 'PT', 'Portugal', 'cup', 3),
  league('belgium-pro-league', 'Pro League', 'BE', 'Belgium', 'league', 2),
  league('austria-bundesliga', 'Bundesliga', 'AT', 'Austria', 'league', 2),
  league('switzerland-super-league', 'Super League', 'CH', 'Switzerland', 'league', 2),
  league('switzerland-swiss-cup', 'Swiss Cup', 'CH', 'Switzerland', 'cup', 3),
  league('scotland-premiership', 'Premiership', 'GB', 'Scotland', 'league', 2),
  league('scotland-scottish-league-cup', 'Scottish League Cup', 'GB', 'Scotland', 'cup', 3),
  league('usa-mls', 'MLS', 'US', 'USA', 'league', 2),
  league('usa-mls-next-pro', 'MLS Next Pro', 'US', 'USA', 'league', 3),
  league('usa-leagues-cup', 'Leagues Cup', 'US', 'USA', 'cup', 3),
  league('usa-us-open-cup', 'US Open Cup', 'US', 'USA', 'cup', 3),
  league('usa-usl-championship', 'USL Championship', 'US', 'USA', 'league', 3),
  league('usa-usl-league-one', 'USL League One', 'US', 'USA', 'league', 3),
  league('usa-usl-league-two', 'USL League Two', 'US', 'USA', 'league', 3),
  league('mexico-liga-mx', 'Liga MX', 'MX', 'Mexico', 'league', 2),
  league('mexico-copa-mx', 'Copa MX', 'MX', 'Mexico', 'cup', 3),
  league('brazil-serie-a', 'Serie A', 'BR', 'Brazil', 'league', 2),
  league('brazil-copa-do-brasil', 'Copa do Brasil', 'BR', 'Brazil', 'cup', 2),
  league('argentina-copa-argentina', 'Copa Argentina', 'AR', 'Argentina', 'cup', 2),
  league('canada-canadian-premier-league', 'Canadian Premier League', 'CA', 'Canada', 'league', 3),
  league('canada-canadian-championship', 'Canadian Championship', 'CA', 'Canada', 'cup', 3),
  league('south-america-copa-libertadores', 'America Copa Libertadores', null, 'South America', 'cup', 1),
  league('australia-a-league', 'A-League', 'AU', 'Australia', 'league', 2),
  league('new-zealand-premiership', 'Zealand Premiership', 'NZ', 'New Zealand', 'league', 3),
  league('international-world-cup', 'World Cup', null, 'International', 'international', 1),
  league('international-copa-america', 'Copa America', null, 'International', 'international', 1),
  league('international-uefa-euro-qualifiers', 'UEFA Euro Qualifiers', null, 'International', 'qualification', 2),
  league('international-wc-qualification-europe', 'WC Qualification Europe', null, 'International', 'qualification', 2),
  league('international-wc-qualification-asia', 'WC Qualification Asia', null, 'International', 'qualification', 2),
]
