// DOES HOME HAVE ENOUGH FOOTBALL ON IT?
//
// The question this file answers sits between the content policy and the
// ranking, and it is a question about the PAGE rather than about any one
// event:
//
//   homeContentPolicy.ts        may this event participate in Home?
//   homeBroadcastEligibility.ts is it expected to be on TV anywhere?
//   homeFeedDensity.ts          is what survived those two enough to fill  <- here
//                               a Home screen, and if not, how much is
//                               missing?
//   homeRanking.ts              which one is the hero, and in what order?
//
// WHY DENSITY AND NOT EMPTINESS. Home's forward look-ahead used to fire on
// a boolean — "is there anything upcoming at all" — which reads a Home
// screen holding one qualifying fixture as a success. For a viewer on
// 'favorites_only' following three competitions that is the ordinary case,
// not the edge case: one Premier League match in the hero, an F1 card, and
// a "Live now & coming up" row with nothing in it. Technically not empty;
// obviously too sparse. Counting instead of asking yes/no is the whole
// change, and it is deliberately expressed here as a pure function of an
// already-fetched candidate list so the fetch layer stays a fetch layer.
//
// WHAT THIS FILE IS NOT:
//   - not a widening of the primary request. Today's broad, unfiltered,
//     all-competitions fetch is untouched and stays the way Ninety
//     discovers a favourite club playing outside its own league, a
//     Champions League final, or anything live. See useHomeFeed.ts.
//   - not Schedule. Every rule here is bounded: a fixed number of local
//     calendar days forward, the viewer's own competitions only, and never
//     more events than the shortfall it measured.
//   - not a ranking input. Nothing here scores anything; it decides how
//     many more candidates to go and get, and the existing ranking then
//     orders them exactly as it orders everything else.
import { isHomeFeedBroadcastEligible } from './homeBroadcastEligibility'
import { isHomeEventIncluded } from './homeContentPolicy'
import { eventTiming, kickoffMs, type PersonalizationContext } from './homePersonalization'
import type { HomeContentMode } from '../preferences'
import type { SportEvent } from './types'

// How much football a Home screen needs before it stops looking sparse.
//
// Measured off the layout rather than picked round: at 1920x1080 the page
// gutters take 2x96px and the rail's chevron another 44px + 12px gap,
// leaving ~1672px for 340px cards at a 16px gap (HomeScreen.css) — four
// whole cards, with the fifth cut off at the edge. The hero above the rail
// spends one further event (it is excluded from the row — see
// rowItemsExcludingHero), so ONE SCREENFUL OF HOME IS FIVE EVENTS, and every
// one of them has to come from somewhere.
export const MIN_VISIBLE_UPCOMING_FOOTBALL = 5

// How far forward the targeted expansion may look, in the viewer's own
// calendar days (see localDayRangeAhead).
//
// Longer than the three days it replaces, because the trigger changed with
// it: no longer "today is exhausted" but "this viewer's competitions are
// quiet", and a quiet week is exactly the case a three-day window answers
// with the same empty row. Still a bounded courtesy window — the request it
// drives is competition-filtered, and what comes back is capped by the
// measured shortfall below, so a longer horizon costs at most a few more
// cards, never a longer feed.
//
// SIX AND NOT SEVEN, though, and the reason is in the cards rather than in
// the fetch: Home labels a fixture from another day by weekday alone ("Sat
// 21:00" — see mapEvent's formatTimeLabel, via homeRowItems' cardTimeText),
// and the seventh day ahead carries the same weekday name as today. Six
// days is the longest window in which every card the row can show still
// names its own day unambiguously.
export const FORWARD_EXPANSION_DAYS = 6

// Everything the density question needs about the viewer, resolved once by
// the caller — the same context object the policy and the ranking already
// take, never a second idea of who the viewer is.
export interface HomeDensityInput {
  now: number
  mode: HomeContentMode
  context: PersonalizationContext
}

// Would this event actually show up on Home as something still to come?
//
// Three conditions, and each is a rule that already exists elsewhere —
// asked here rather than restated:
//
//   FOOTBALL ONLY. The expansion is a football mechanism (it fetches
//   competitions), so an F1 race weekend must not be able to answer "yes,
//   Home has plenty on" for a viewer whose football row is empty. That is
//   precisely the reported case.
//
//   STILL TO COME, via the ranking's own eventTiming rather than a local
//   `kickoff > now`. A match whose provider status is still 'scheduled'
//   twenty minutes after kick-off (the majority case — see liveHeuristic.ts)
//   is live, not upcoming, and counting it as upcoming would let a row that
//   is about to empty out look full.
//
//   VISIBLE, meaning it survives BOTH gates the feed applies: the viewer's
//   content mode and the backend's broadcast verdict. Counting raw
//   candidates is the bug this file exists to fix, and counting only
//   policy-allowed ones would repeat it one layer down — a fixture nobody
//   is expected to televise is removed from the feed just as surely as an
//   unfollowed competition is.
export function isVisibleUpcomingFootball(event: SportEvent, input: HomeDensityInput): boolean {
  if (event.sportKey !== 'football') return false
  const timing = eventTiming(event, input.now)
  if (timing !== 'starting-soon' && timing !== 'upcoming') return false
  if (!isHomeEventIncluded(event, input.mode, input.context)) return false
  return isHomeFeedBroadcastEligible(event, input.context)
}

export function countVisibleUpcomingFootball(events: readonly SportEvent[], input: HomeDensityInput): number {
  let count = 0
  for (const event of events) {
    if (isVisibleUpcomingFootball(event, input)) count += 1
  }
  return count
}

// How many more upcoming football events Home wants, or 0 when it has
// enough. The one number the fetch layer acts on: non-zero means make the
// targeted forward request, and its value is also the cap on what that
// request may contribute.
//
// Note what it does NOT count: live football. A live match is real content
// and the viewer can see it, but it is content with a deadline — a Home
// screen carrying two live matches and nothing after them empties out
// within the hour, which is the state this mechanism exists to get ahead of.
// The cap keeps the cost of that choice small: the worst case on a busy
// live afternoon is a handful of extra cards at the END of an already full
// row, and the ~60s refresh re-measures continuously as those matches
// finish.
export function forwardExpansionShortfall(events: readonly SportEvent[], input: HomeDensityInput): number {
  return Math.max(0, MIN_VISIBLE_UPCOMING_FOOTBALL - countVisibleUpcomingFootball(events, input))
}

// What the forward request is allowed to add to the candidate pool.
//
// MERGE AND DEDUPE, then take the nearest `limit`. Nearest rather than
// biggest on purpose: this is the "coming up" row, whose whole promise is
// chronological, and letting relevance pick here would put next Sunday's
// derby in front of tomorrow's fixture and then have the ranking put it
// back. Relevance still decides the ORDER within a kickoff slot — that is
// homeRanking's job, and it does it on the merged pool exactly as it does
// on the primary one.
//
// Filtered through the same visibility test that measured the shortfall, so
// the top-up delivers what it promised: an event the mode or the broadcast
// verdict would remove is not a card, and must not be counted as one.
export function selectForwardExpansion(
  incoming: readonly SportEvent[],
  existing: readonly SportEvent[],
  input: HomeDensityInput,
  limit: number,
): SportEvent[] {
  if (limit <= 0) return []
  const known = new Set(existing.map((event) => event.id))
  const additions: SportEvent[] = []
  for (const event of incoming) {
    if (known.has(event.id)) continue
    known.add(event.id)
    if (isVisibleUpcomingFootball(event, input)) additions.push(event)
  }
  additions.sort((a, b) => {
    const byKickoff = (kickoffMs(a) ?? Number.MAX_SAFE_INTEGER) - (kickoffMs(b) ?? Number.MAX_SAFE_INTEGER)
    return byKickoff !== 0 ? byKickoff : a.id.localeCompare(b.id)
  })
  return additions.slice(0, limit)
}
