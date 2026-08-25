// A representative slice of what GET /v1/competitions actually returns
// (verified live against the deployed ninety-api on 2026-08-25) —
// ninety-api's own src/sports/leagues.ts is the source these values come
// from, byte-for-byte. Test-only: production code never builds LeagueDefs
// by hand, it maps the fetched catalog (competitionsCatalog.ts).
//
// Deliberately includes the shapes the recommendation logic has to get
// right rather than only the easy cases:
//   - England and Scotland both carrying countryCode 'GB'
//   - GB cup competitions that must not outrank the Premier League
//   - a country (US) whose best league is tier 2, alongside tier-3 noise
//   - a country (PT) where a league and a cup share the same tier
//   - supranational UEFA entries with countryCode null / region 'Europe'
//   - a non-UEFA supranational entry (CONMEBOL) that must NOT be treated
//     as one
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
  // England (countryCode GB)
  league('football_premier_league', 'Premier League', 'GB', 'England', 'league', 1),
  league('england-championship', 'Championship', 'GB', 'England', 'league', 2),
  league('england-efl-league-one', 'EFL League One', 'GB', 'England', 'league', 3),
  league('england-fa-cup', 'FA Cup', 'GB', 'England', 'cup', 2),
  // Scotland (also countryCode GB — no separate ISO code for home nations)
  league('scotland-premiership', 'Premiership', 'GB', 'Scotland', 'league', 2),
  // UEFA
  league('football_champions_league', 'UEFA Champions League', null, 'Europe', 'cup', 1),
  league('football_europa_league', 'UEFA Europa League', null, 'Europe', 'cup', 1),
  // Big Five (rest)
  league('football_la_liga', 'La Liga', 'ES', 'Spain', 'league', 1),
  league('football_bundesliga', 'Bundesliga', 'DE', 'Germany', 'league', 1),
  league('football_serie_a', 'Serie A', 'IT', 'Italy', 'league', 1),
  league('football_ligue_1', 'Ligue 1', 'FR', 'France', 'league', 1),
  // Nordics
  league('norway-eliteserien', 'Eliteserien', 'NO', 'Norway', 'league', 2),
  league('sweden-allsvenskan', 'Allsvenskan', 'SE', 'Sweden', 'league', 2),
  league('sweden-superettan', 'Superettan', 'SE', 'Sweden', 'league', 3),
  league('denmark-superliga', 'Superliga', 'DK', 'Denmark', 'league', 2),
  // Low countries
  league('netherlands-eredivisie', 'Eredivisie', 'NL', 'Netherlands', 'league', 2),
  league('belgium-pro-league', 'Pro League', 'BE', 'Belgium', 'league', 2),
  // Portugal — a league and a cup sharing tier 3
  league('portugal-ligapro', 'LigaPro', 'PT', 'Portugal', 'league', 3),
  league('portugal-portuguese-super-cup', 'Portuguese Super Cup', 'PT', 'Portugal', 'cup', 3),
  // USA — best league is tier 2, surrounded by tier-3 entries
  league('usa-mls', 'MLS', 'US', 'USA', 'league', 2),
  league('usa-usl-championship', 'USL Championship', 'US', 'USA', 'league', 3),
  league('usa-us-open-cup', 'US Open Cup', 'US', 'USA', 'cup', 3),
  // Supranational but NOT UEFA
  league('south-america-copa-libertadores', 'America Copa Libertadores', null, 'South America', 'cup', 1),
  league('international-world-cup', 'World Cup', null, 'International', 'international', 1),
]
