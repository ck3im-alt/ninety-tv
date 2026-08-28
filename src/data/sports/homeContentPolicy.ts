// MAY THIS EVENT APPEAR ON HOME AT ALL?
//
// A separate question from every other one Home asks, and deliberately
// answered before all of them:
//
//   homeContentPolicy.ts       may this event participate in Home?      <- here
//   homeBroadcastEligibility.ts is it expected to be on TV anywhere?
//   homePersonalization.ts      what is it worth to this viewer?
//   homeRanking.ts              which one is the hero, and in what order?
//
// INCLUSION IS NOT RANKING, and keeping them apart is the whole design.
// Ranking answers "which of these first"; a score can always be out-argued
// by a big enough number somewhere else. This file answers "is this allowed
// on screen", which is a structural statement the user made in Settings and
// which no amount of relevance, prominence or being-live may overturn. Same
// argument the hero's 60-minute window and the broadcast gate already make
// for themselves (see homeRanking.ts's header).
//
// WHAT THIS FILE IS NOT:
//   - not React, not async, not a network concern. It runs against events
//     that have ALREADY been fetched — Home's all-competitions candidate
//     fetch stays exactly as broad as it is (see useHomeFeed.ts), because a
//     Champions League final Ninety never fetched is a final Ninety cannot
//     rank, cannot explain and cannot offer under 'all' either.
//   - not stream/channel matching. Whether the viewer's playlist carries a
//     match is answered later and separately.
//   - not a reader of learned watch affinity. Affinity may REORDER what is
//     already included; letting it also unlock competitions would mean a
//     content-breadth setting the app quietly erodes the more you watch.
//   - not a reader of favoriteCountries. That is a broadcast-market
//     preference and must never become a football-interest signal — see
//     homePersonalization.ts's own header.
import { isBigFiveCompetition } from './editorialCompetitions'
import {
  hasDomesticCompetitionMembership,
  isFavoriteCompetitionEvent,
  isFavoriteTeamEvent,
  scoreObjectiveImportance,
  type PersonalizationContext,
} from './homePersonalization'
import type { HomeContentMode } from '../preferences'
import type { SportEvent } from './types'

// ---------------------------------------------------------------------------
// MARQUEE THRESHOLDS
// ---------------------------------------------------------------------------

// How prominent a club has to be before its ORDINARY league fixture counts
// as a highlight for someone who does not follow that league.
//
// 0.90 is not a guess: it is the floor of ninety-api's own documented
// top prominence band (sports/teamProminence.ts — "0.90-1.00 global
// megaclub: a neutral will watch this name anywhere"), which is precisely
// the property "outside highlight" means. In today's seed data that is Real
// Madrid, Barcelona, Manchester United, Liverpool, Bayern, Manchester City,
// PSG, Arsenal, Chelsea, Juventus, Milan and Inter — around a dozen clubs,
// and it moves when the BACKEND's editorial data moves rather than when
// someone edits a list of club names into this repo.
//
// NOT expressed with NEUTRAL_PROMINENCE's fallback. Scoring treats an
// unknown club as mid-scale because a missing field must not push a whole
// competition to the bottom of a ranking; a GATE has the opposite duty. An
// event carrying no prominence at all has produced no evidence of being a
// marquee occasion, so it does not pass here.
export const MARQUEE_CLUB_PROMINENCE = 0.9

// How objectively big a match has to be to qualify as a highlight on
// occasion alone, on scoreObjectiveImportance's existing scale (matchup
// prominence + competition + stage + rivalry — see homePersonalization.ts).
//
// Calibrated against real cases rather than picked round:
//
//   Champions League final, any two clubs        ~78-102   included
//   Champions League semi-final, big clubs         ~94      included
//   a top-flight derby with maximum rivalry        ~74      included
//   Champions League group game, megaclubs         ~74      included
//   Champions League round-of-16, small clubs      ~57      excluded
//   an ordinary Premier League fixture             ~40      excluded
//   a Champions League qualifier between minnows   ~44      excluded
//   a mid-table fixture in a smaller league        ~32      excluded
//
// Deliberately high. 'highlights' must not become 'all' with a different
// sort order, so the bar is set where only a genuine occasion clears it —
// and where the two failure directions are asymmetric: a missed highlight
// is a match the viewer can still find in Schedule, whereas a leaky rule
// quietly overrides a setting they deliberately chose.
export const OUTSIDE_HIGHLIGHT_IMPORTANCE = 70

// A giant playing its ordinary league football in one of Europe's Big Five.
// The competition test is Ninety's shared editorial one (see
// editorialCompetitions.ts) — the same definition onboarding pins its
// recommendation row to, never a second list.
//
// Both halves are required. A megaclub in a pre-season friendly or a minor
// cup is not the occasion this rule is for, and an ordinary Big Five
// fixture is exactly the "unrelated league" case the mode exists to remove.
export function isMarqueeBigFiveFixture(event: SportEvent): boolean {
  if (!isBigFiveCompetition(event.leagueId)) return false
  return (event.homeTeamProminence ?? 0) >= MARQUEE_CLUB_PROMINENCE || (event.awayTeamProminence ?? 0) >= MARQUEE_CLUB_PROMINENCE
}

// A genuinely exceptional occasion, whoever is playing: a late-stage tie in
// an elite competition, or a real rivalry between real clubs. Reuses the
// ranking's own objective term rather than re-deriving prestige/stage/
// rivalry weights, so "how big is this match" has exactly one definition in
// the app.
export function isExceptionalOccasion(event: SportEvent): boolean {
  return scoreObjectiveImportance(event) >= OUTSIDE_HIGHLIGHT_IMPORTANCE
}

// The complete "notable football from elsewhere" rule, named so the two
// halves can be tested and retuned as one idea.
export function isOutsideHighlight(event: SportEvent): boolean {
  return isMarqueeBigFiveFixture(event) || isExceptionalOccasion(event)
}

// ---------------------------------------------------------------------------
// THE POLICY
// ---------------------------------------------------------------------------

// Whether an already-fetched event may participate in Home under this
// viewer's content mode.
//
// NON-FOOTBALL IS NEVER FILTERED HERE. This preference is about football
// LEAGUE BREADTH, because football is the only sport with per-competition
// selections; F1 is governed by whether the sport itself is enabled, and a
// stricter football mode must not quietly remove the race weekend.
export function isHomeEventIncluded(event: SportEvent, mode: HomeContentMode, context: PersonalizationContext): boolean {
  if (event.sportKey !== 'football') return true

  switch (mode) {
    // Today's behaviour, unchanged: everything otherwise eligible may
    // appear, and favourites only decide the order.
    case 'all':
      return true

    // STRICT MEANS STRICT. The event's OWN competition, and nothing else —
    // not a favourite club playing elsewhere, not a club from a league you
    // follow having a European night, not prominence, not a Champions
    // League final. The viewer said "my leagues only"; reading that as "my
    // interests only" would be answering a question they did not ask.
    case 'favorites_only':
      return isFavoriteCompetitionEvent(event, context)

    // What you follow, plus football that is notable to anyone.
    case 'highlights':
      return (
        // 1. the event's own competition is one you follow
        isFavoriteCompetitionEvent(event, context) ||
        // 2. a club you explicitly follow is playing, wherever it is playing
        isFavoriteTeamEvent(event, context) ||
        // 3. a participant plays its league football in a competition you
        //    follow — "I follow Eliteserien" reaching Bodø/Glimt's
        //    Champions League nights without you also following the
        //    Champions League. The raw membership test, not the scoring
        //    one, because inclusion has no double-counting to avoid.
        hasDomesticCompetitionMembership(event, context) ||
        // 4. it is a genuine occasion in its own right
        isOutsideHighlight(event)
      )
  }
}

// The list form, for callers that filter a candidate pool. Kept here rather
// than written out at each call site so Home's hero and its feed cannot
// possibly be given different rules — the single invariant this whole layer
// exists to guarantee.
export function filterHomeEventsByMode(
  events: readonly SportEvent[],
  mode: HomeContentMode,
  context: PersonalizationContext,
): SportEvent[] {
  // 'all' removes nothing by definition, so the common case costs one
  // comparison instead of a pass over a few hundred events.
  if (mode === 'all') return [...events]
  return events.filter((event) => isHomeEventIncluded(event, mode, context))
}

// Why one event was or was not allowed, itemized — for the dev-only Home
// diagnostic (see useHomeFeed's __ninetyHomeContentPolicy). Composed from
// the same predicates the real path calls, never a parallel
// reimplementation that could report a decision Home did not make.
export interface HomeContentDecision {
  mode: HomeContentMode
  included: boolean
  favoriteCompetition: boolean
  favoriteTeam: boolean
  domesticMembership: boolean
  marqueeBigFive: boolean
  objectiveImportance: number
  exceptionalOccasion: boolean
}

export function describeHomeContentDecision(
  event: SportEvent,
  mode: HomeContentMode,
  context: PersonalizationContext,
): HomeContentDecision {
  return {
    mode,
    included: isHomeEventIncluded(event, mode, context),
    favoriteCompetition: isFavoriteCompetitionEvent(event, context),
    favoriteTeam: isFavoriteTeamEvent(event, context),
    domesticMembership: hasDomesticCompetitionMembership(event, context),
    marqueeBigFive: isMarqueeBigFiveFixture(event),
    objectiveImportance: scoreObjectiveImportance(event),
    exceptionalOccasion: isExceptionalOccasion(event),
  }
}
