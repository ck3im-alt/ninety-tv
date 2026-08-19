// Static, hand-curated broadcaster mapping — the fallback for any sport/
// league where no broadcast-rights API exists (everything except football,
// which gets real per-fixture data from ninety-api's own EPG resolver —
// see channelMatch.ts).
//
// Some sports don't need per-fixture broadcast data at all: the same
// handful of channels carry *every* event in that sport, in a given
// country, for a whole season (e.g. F1 is always Sky Sports F1 in the UK).
// That's a static fact, worth recording once here rather than querying an
// API that doesn't exist for it.
//
// Entries are looked up by sportKey (whole-sport mapping) or leagueId (a
// narrower override for a single competition, e.g. only golf's majors) —
// see broadcastersFor below for precedence. Station names are matched
// against playlist channel names with the exact same word-overlap logic
// ninety-api matches use (see namesOverlap in channelMatch.ts), so naming
// drift ("Sky Sports F1" vs "SKY SPORTS F1 HD") is tolerated the same way.
//
// Research discipline: only add an entry once you've actually confirmed
// that broadcaster currently holds the rights — don't guess from a
// station's name looking sport-appropriate.
import type { SportKey } from './types'

export interface BroadcasterMapping {
  sportKey: SportKey
  leagueId?: string // narrower than sportKey — only applies to that one LeagueDef.id
  country: string // must match countryCodes.ts's COUNTRY_NAMES values, e.g. "United Kingdom"
  stationNames: string[]
}

export const BROADCASTER_MAP: BroadcasterMapping[] = [
  // Formula 1 — confirmed 2026-08-14: Sky Sports F1 holds exclusive UK
  // live rights (Channel 4 only gets highlights, not live), ESPN holds US
  // rights.
  { sportKey: 'f1', country: 'United Kingdom', stationNames: ['Sky Sports F1'] },
  { sportKey: 'f1', country: 'United States', stationNames: ['ESPN'] },
]

// Every BROADCASTER_MAP entry potentially relevant to this event: matching
// sportKey is required for EVERY entry (including league-specific ones —
// today's real BROADCASTER_MAP data has zero leagueId entries, so this is a
// no-op tightening for current data, but it's the correct, defensive
// reading now that entries are selected as a whole set here rather than
// only ever compared one at a time), plus either a matching leagueId or a
// sport-wide (no leagueId) entry. This is a superset filter, not a
// decision: for a country with BOTH kinds of entry, broadcastersFor below
// still applies the same league-over-sport precedence it always has,
// scoped per country. Single source of truth for both broadcastersFor
// (station names) and countriesForBroadcasterMap (country buckets, used by
// channelMatch.ts to restrict its channel scan to relevant countries
// instead of the whole playlist) — neither reimplements this precedence
// independently.
function relevantEntries(sportKey: SportKey, leagueId: string): BroadcasterMapping[] {
  return BROADCASTER_MAP.filter((m) => m.sportKey === sportKey && (m.leagueId === leagueId || !m.leagueId))
}

// Whole-sport mappings apply to every league in that sport unless a
// leagueId-specific entry exists for the same country, in which case the
// narrower one wins (e.g. a golf major with its own single broadcaster
// deal, distinct from the sport's general coverage).
export function broadcastersFor(sportKey: SportKey, leagueId: string, country: string): string[] {
  const candidates = relevantEntries(sportKey, leagueId).filter((m) => m.country === country)
  const leagueMatch = candidates.find((m) => m.leagueId === leagueId)
  if (leagueMatch) return leagueMatch.stationNames
  const sportMatch = candidates.find((m) => !m.leagueId)
  return sportMatch?.stationNames ?? []
}

// Every country broadcastersFor could possibly return a non-empty result
// for, given this sportKey/leagueId — lets channelMatch.ts's
// matchViaBroadcasterMap restrict its channel scan to just these countries'
// buckets (via ChannelIndex.getChannelsForCountry) instead of the whole
// playlist. Skipping any other country is provably safe: broadcastersFor
// would have returned [] for it anyway, contributing zero matches.
export function countriesForBroadcasterMap(sportKey: SportKey, leagueId: string): string[] {
  return [...new Set(relevantEntries(sportKey, leagueId).map((m) => m.country))]
}
