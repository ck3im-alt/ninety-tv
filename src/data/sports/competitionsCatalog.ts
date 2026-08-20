// Fetches Ninety's football competition catalog from ninety-api's
// GET /v1/competitions -- the canonical registry (see ninety-api's
// sports/leagues.ts) -- instead of hand-duplicating all 50 competitions in
// this repo (removed 2026-08-20's Phase 1.1 audit, see leagues.ts). Only
// football is sourced this way: F1 has no ninety-api competition registry
// entry at all (different provider, not a football competition) and stays
// in leagues.ts's STATIC_LEAGUES.
import { getCompetitions, type NinetyCompetition } from './ninetyApiClient'
import type { LeagueDef } from './leagues'

function toLeagueDef(c: NinetyCompetition): LeagueDef {
  return {
    id: c.id,
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    tsdbSport: 'Soccer',
    name: c.name,
    region: c.region,
    countryCode: c.country_code,
    tier: c.tier,
    badge: c.badge_url,
    ninetyCompetitionId: c.id,
  }
}

let cache: LeagueDef[] | null = null
let inFlight: Promise<LeagueDef[]> | null = null

// Cached for the session and de-duplicated across concurrent callers
// (CompetitionsScreen, OnboardingSportsScreen, and useHomeFeed can all
// mount/fire around the same time) -- the catalog only changes on a
// Ninety deploy, never mid-session, so one fetch per app session is
// correct, not stale data.
export async function loadFootballCompetitions(): Promise<LeagueDef[]> {
  if (cache) return cache
  if (!inFlight) {
    inFlight = getCompetitions()
      .then(({ competitions }) => {
        cache = competitions.map(toLeagueDef)
        return cache
      })
      .catch((err) => {
        // Don't cache a failure -- allow the next caller (or a retry from
        // the same caller) to try again rather than being stuck with a
        // permanently-broken catalog for the rest of the session.
        inFlight = null
        throw err
      })
  }
  return inFlight
}

// Test-only escape hatch -- production code never needs to invalidate this
// mid-session.
export function __resetFootballCompetitionsCacheForTests(): void {
  cache = null
  inFlight = null
}
