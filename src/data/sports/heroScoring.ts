// Ninety's ONE editorial judgement about sporting importance: how big a
// competition is, and how important a round within it is.
//
// It used to also pick the Home hero (pickHero/selectHero lived here), which
// is why it is called heroScoring. That job moved out in the 2026-08-26
// personalization pass — hero selection now needs the user's favorites,
// team prominence, rivalry and a hard time-eligibility rule, none of which
// belong in a prestige table. See:
//
//   homePersonalization.ts — what a single event is worth to THIS user
//   homeRanking.ts         — which event becomes the hero, and feed order
//   scheduleRanking.ts     — how the Schedule screen orders competitions
//
// All three read the two functions below rather than keeping their own
// idea of which competitions and rounds are big, so the app can never
// disagree with itself about it.
import type { SportEvent } from './types'

// Prestige comes from SportEvent.leagueTier -- set at mapping time
// (mapEvent.ts) from the competition catalog's `tier` field, itself
// fetched from ninety-api's canonical registry (sports/leagues.ts). Reading
// it off the event directly, rather than looking `event.leagueId` up
// against a catalog held here, matters specifically because that catalog
// (since 2026-08-20's Phase 1.1 audit) is fetched asynchronously from
// GET /v1/competitions -- an event can only ever exist once its league has
// already been resolved to build it, so leagueTier is always correctly
// populated by the time scoring runs; a separate byId lookup here would
// introduce exactly the kind of "is the catalog loaded yet" timing
// question this design avoids. It also can't drift the way the old
// hand-maintained per-league prestige map did (see git history) -- that
// map carried entries for league ids that no longer existed in the
// catalog and had to be hand-updated every time a competition was added;
// this reads directly from the one place competition identity is defined.
//
// Still an editorial judgment call, not derived from any data source —
// same spirit as the curated background images (staticBackground in
// leagues.ts): an honest, documented choice, easy to retune.
const TIER_PRESTIGE: Record<1 | 2 | 3, number> = {
  1: 0.85,
  2: 0.65,
  3: 0.45,
}
// Hand overrides for the couple of cases tier alone doesn't capture well.
// Keyed by leagueId (stable regardless of catalog source) rather than
// leagueTier, since these are about one specific competition/sport, not a
// whole tier. Kept intentionally tiny -- if this grows much further,
// that's a sign the tier boundaries themselves need retuning instead.
const LEAGUE_PRESTIGE_OVERRIDES: Record<string, number> = {
  football_champions_league: 1.0, // UEFA Champions League — the single biggest club fixture there is, above every other tier-1 competition
  '4370': 0.9, // F1 — not part of the football competition-tier system at all (different sport, no tier set on its LeagueDef)
}
const DEFAULT_LEAGUE_PRESTIGE = 0.5

// Exported (2026-08-26) so the Schedule screen can order competition groups
// by the SAME prestige judgement the hero already uses, rather than growing
// a second, independently-drifting table of "which competitions are big".
// Takes just the two identity fields rather than a whole SportEvent, so a
// caller ranking a competition GROUP can pass any fixture from it — or a
// synthesized {leagueId, leagueTier} — without pretending to have an event.
export function competitionPrestige(competition: Pick<SportEvent, 'leagueId' | 'leagueTier'>): number {
  const override = LEAGUE_PRESTIGE_OVERRIDES[competition.leagueId]
  if (override != null) return override
  return competition.leagueTier != null ? TIER_PRESTIGE[competition.leagueTier] : DEFAULT_LEAGUE_PRESTIGE
}

// Stage within a competition, as a small closed vocabulary rather than a
// weight — see parseRoundStage below for why the two are now separate.
export type RoundStage =
  | 'final'
  | 'semi-final'
  | 'quarter-final'
  | 'round-of-16'
  | 'play-off'
  | 'group'
  | 'qualifying'
  | 'regular-season'

// THE ONE PLACE that reads a competition's human-readable round text.
//
// This replaces a list of substring patterns scanned in priority order,
// which carried a real bug: "semi-final" CONTAINS "final", so a semifinal
// resolved to whichever of the two patterns happened to be checked first,
// and it was 'final' — every semifinal in the app scored as a final, and
// every quarter-final did too. Ordering a substring list correctly is a
// property nothing enforced and every future edit could silently break.
//
// So: normalize once (lowercase, every run of non-alphanumerics collapsed
// to a single space), then test WORD-ANCHORED patterns most-specific
// first. The order still matters — `\bfinal\b` genuinely does match the
// word "final" inside "semi final" — but now it is the only ordering rule,
// it is stated here, and it is covered by tests that assert the three
// stages resolve distinctly.
//
// Normalizing separators is what makes the real-world spellings collapse
// into one case each: "Semi-final", "Semi Final" and "Semifinals" all have
// to work, because the round text comes from a third-party feed and is not
// a controlled vocabulary. TheSportsDB's bare numeric rounds ("12") match
// nothing here and correctly resolve to null.
const STAGE_PATTERNS: Array<[stage: RoundStage, pattern: RegExp]> = [
  // Most specific first: both of these contain the word "final".
  ['semi-final', /\bsemi ?finals?\b/],
  ['quarter-final', /\bquarter ?finals?\b/],
  ['round-of-16', /\bround of 16\b|\blast 16\b|\br16\b/],
  ['final', /\bfinals?\b/],
  ['play-off', /\bplay ?offs?\b/],
  ['qualifying', /\bqualif/],
  ['group', /\bgroup\b/],
  ['regular-season', /\bregular season\b|\bmatchweek\b|\bmatchday\b/],
]

export function parseRoundStage(round: string | undefined | null): RoundStage | null {
  if (!round) return null
  const normalized = round.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (!normalized) return null
  for (const [stage, pattern] of STAGE_PATTERNS) {
    if (pattern.test(normalized)) return stage
  }
  return null
}

// Stage importance as a 0..1 weight — later rounds matter more than early
// qualifying. Consumed by scheduleRanking.ts (which blends it with
// competition prestige to order the Schedule screen's competition groups);
// Home's own ranking uses points on a different scale but the SAME
// parseRoundStage above, so the two can never disagree about what round a
// fixture is in.
const STAGE_WEIGHTS: Record<RoundStage, number> = {
  final: 1.0,
  'semi-final': 0.85,
  'quarter-final': 0.75,
  'round-of-16': 0.65,
  'play-off': 0.55,
  group: 0.6,
  qualifying: 0.35,
  'regular-season': 0.5,
}
const DEFAULT_ROUND_WEIGHT = 0.5

// Exported alongside competitionPrestige above, and for the same reason —
// "a semifinal matters more than a group game" is one editorial judgement,
// not one per screen.
export function roundSignificance(round: string | undefined): number {
  const stage = parseRoundStage(round)
  return stage ? STAGE_WEIGHTS[stage] : DEFAULT_ROUND_WEIGHT
}
