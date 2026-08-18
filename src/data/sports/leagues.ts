import type { SportKey } from './types'

// TheSportsDB league IDs and badge URLs, each confirmed by direct lookup
// (lookupleague.php) against the live API before being added — not
// guessed from naming conventions.
export interface LeagueDef {
  id: string
  sportKey: SportKey
  sportLabel: string
  tsdbSport: string // TheSportsDB's own `strSport` value, needed for livescore.php
  badge?: string // league crest, used by the onboarding sport-picker grid
  // Overrides whatever event image TheSportsDB provides for fixtures in
  // this league — used for leagues where we have a specific curated hero
  // shot we want every fixture to use, regardless of the actual teams
  // playing. Public path (served from /public), not an API-sourced URL.
  staticBackground?: string
  // Ninety's own competition id (ninety-api's src/sports/leagues.ts) —
  // only set for leagues ninety-api's fixture source (footballdata.io)
  // actually covers, per a live authenticated check against the API (not
  // hardcoded from marketing tier numbers, which have been unreliable).
  // Sportmonks (€80/month) was dropped entirely 2026-08-17 in favor of
  // ninety-api. Ninety upgraded footballdata.io from Free to Starter on
  // 2026-08-17→18, which added Bundesliga/Serie A/Ligue 1 coverage (all
  // three now set below). UEFA Conference League still has no
  // ninetyCompetitionId — verified live that footballdata.io's Starter
  // catalog does not carry it at all (not a Ninety omission) — see
  // docs/THIRD_PARTY.md in ninety-api.
  ninetyCompetitionId?: string
}

export const LEAGUES: LeagueDef[] = [
  {
    id: '4328',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    tsdbSport: 'Soccer',
    badge: 'https://r2.thesportsdb.com/images/media/league/badge/gasy9d1737743125.png',
    staticBackground: '/backgrounds/premier-league.jpg',
    ninetyCompetitionId: 'football_premier_league',
  }, // English Premier League
  {
    id: '4480',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    tsdbSport: 'Soccer',
    badge: 'https://r2.thesportsdb.com/images/media/league/badge/facv1u1742998896.png',
    staticBackground: '/backgrounds/Champions_League.jpeg',
    ninetyCompetitionId: 'football_champions_league',
  }, // UEFA Champions League
  {
    id: '4335',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    tsdbSport: 'Soccer',
    badge: 'https://r2.thesportsdb.com/images/media/league/badge/ja4it51687628717.png',
    ninetyCompetitionId: 'football_la_liga',
  }, // Spanish La Liga
  {
    id: '4332',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    tsdbSport: 'Soccer',
    badge: 'https://r2.thesportsdb.com/images/media/league/badge/67q3q21679951383.png',
    ninetyCompetitionId: 'football_serie_a',
  }, // Italian Serie A
  {
    id: '4331',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    tsdbSport: 'Soccer',
    badge: 'https://r2.thesportsdb.com/images/media/league/badge/teqh1b1679952008.png',
    ninetyCompetitionId: 'football_bundesliga',
  }, // German Bundesliga
  {
    id: '4334',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    tsdbSport: 'Soccer',
    badge: 'https://r2.thesportsdb.com/images/media/league/badge/9f7z9d1742983155.png',
    ninetyCompetitionId: 'football_ligue_1',
  }, // French Ligue 1
  {
    id: '4481',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    tsdbSport: 'Soccer',
    badge: 'https://r2.thesportsdb.com/images/media/league/badge/mlsr7d1718774547.png',
    staticBackground: '/backgrounds/test_image.png',
    ninetyCompetitionId: 'football_europa_league',
  }, // UEFA Europa League
  {
    id: '5071',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    tsdbSport: 'Soccer',
    badge: 'https://r2.thesportsdb.com/images/media/league/badge/ymfo5j1718775759.png',
    // Filename is misleading: the file literally named "Europa_League.png"
    // on disk actually shows the green UEFA CONFERENCE LEAGUE stadium
    // signage — verified by opening it directly, not assumed from its name.
    staticBackground: '/backgrounds/Europa_League.png',
  }, // UEFA Conference League — no ninety-api coverage yet
  {
    id: '4370',
    sportKey: 'f1',
    sportLabel: 'F1',
    tsdbSport: 'Motorsport',
    staticBackground: '/backgrounds/f1.jpg',
  }, // Formula 1
  // Golf/tennis/MMA/basketball dropped 2026-08-13 — see the note on
  // SportKey in types.ts for why.
]

// Football leagues specifically, in the order/grouping the onboarding
// sport-picker screen shows them.
export const FOOTBALL_LEAGUES = LEAGUES.filter((l) => l.sportKey === 'football')

export function leaguesForSportFilter(filterId: string): LeagueDef[] {
  if (filterId === 'all') return LEAGUES
  return LEAGUES.filter((l) => l.sportKey === filterId)
}

// Home feed uses this: only the specific football leagues the user picked
// during onboarding (not all 12 in the catalog — that would both flood
// the free API with requests and ignore what they actually chose), plus
// every league for any other sport they selected (those sports only have
// one league each in this catalog, so there's nothing to narrow further).
export function leaguesForPreferences(prefs: { sports: SportKey[]; footballLeagueIds: string[] }): LeagueDef[] {
  const result: LeagueDef[] = []
  for (const sport of prefs.sports) {
    if (sport === 'football') {
      result.push(...LEAGUES.filter((l) => l.sportKey === 'football' && prefs.footballLeagueIds.includes(l.id)))
    } else {
      result.push(...LEAGUES.filter((l) => l.sportKey === sport))
    }
  }
  return result
}
