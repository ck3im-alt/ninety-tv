// Which event becomes the Home hero, and what order the "Live now & coming
// up" feed renders in.
//
// TWO RANKINGS, NOT ONE — and the difference is the whole design:
//
//   HERO answers "what would I most likely want to put on right now?"
//   Live and "kicks off within the hour" are ONE candidate pool, because a
//   viewer switching the TV on at 20:40 for a 21:00 Manchester United -
//   Liverpool wants that build-up, not whatever mediocre match happens to
//   be in its 35th minute. Inside that pool, relevance decides.
//
//   THE FEED answers "what is on?" It is a chronological statement, so it
//   is grouped strictly: everything live, then everything starting soon,
//   then everything later. A more relevant future match NEVER climbs above
//   a live one here — personalization only orders WITHIN a group, and
//   within a group only among near-simultaneous kickoffs.
//
// So the same two events can legitimately appear as hero = Manchester
// United - Liverpool (21:00) while the feed's first card is Tromsø - Molde
// (live). That is intended, and there is a test that pins it.
//
// THE ELIGIBILITY WALL. The hero's time window is a GATE, not a score. An
// event 61 minutes away is not in the pool at all, so no amount of
// relevance — a favorite team, a Champions League final, both — can lift it
// over something live. A single blended score cannot express that, which is
// why this file gates first and scores second.
import {
  EMPTY_PERSONALIZATION_CONTEXT,
  eventTiming,
  kickoffMs,
  getScoreBreakdown,
  scoreFeedCandidate,
  scoreHeroCandidate,
  type EventTiming,
  type PersonalizationContext,
  type ScoreBreakdown,
} from './homePersonalization'
import type { SportEvent } from './types'

// Re-exported so callers have one import for "the Home ranking", and so the
// 60-minute boundary is quotable by its Home-facing name.
export { STARTING_SOON_WINDOW_MS, eventTiming } from './homePersonalization'
export type { EventTiming, PersonalizationContext } from './homePersonalization'

// Two kickoffs are "the same slot" when they are within this of each other.
// A tolerance rather than an exact timestamp match because two matches in
// the same round are rarely scheduled to the same second, and because the
// feed's rule — chronology first, relevance only among simultaneous
// fixtures — is meaningless without one.
export const SAME_SLOT_TOLERANCE_MS = 5 * 60 * 1000

// ---------------------------------------------------------------------------
// FEED
// ---------------------------------------------------------------------------

// The three chronological bands the feed renders in, in this order. They
// are also what the cards use to label themselves — 'starting-soon' is what
// puts "STARTING SOON · 21:00" on a card instead of a bare kickoff time.
export type FeedGroup = 'live' | 'starting-soon' | 'coming-up'

export interface HomeFeedItem {
  event: SportEvent
  group: FeedGroup
}

function feedGroupFor(timing: EventTiming): FeedGroup | null {
  if (timing === 'live') return 'live'
  if (timing === 'starting-soon') return 'starting-soon'
  if (timing === 'upcoming') return 'coming-up'
  // 'past' (kicked off, never went live, or finished) and 'unknown' (no
  // kickoff time at all) have no place in a "what's on" feed.
  return null
}

// Sorts by relevance, breaking ties deterministically: earlier kickoff
// first, then event id. Determinism matters more than it looks — this runs
// again on every ~60s background refresh, and a non-deterministic tiebreak
// would visibly reshuffle cards under the user's hand for no reason.
function byRelevance(context: PersonalizationContext) {
  return (a: SportEvent, b: SportEvent): number => {
    const byScore = scoreFeedCandidate(b, context) - scoreFeedCandidate(a, context)
    if (byScore !== 0) return byScore
    const byTime = (kickoffMs(a) ?? Number.MAX_SAFE_INTEGER) - (kickoffMs(b) ?? Number.MAX_SAFE_INTEGER)
    if (byTime !== 0) return byTime
    return a.id.localeCompare(b.id)
  }
}

// Splits a chronologically-sorted list into kickoff clusters: a new cluster
// starts as soon as an event is more than the tolerance away from the one
// that OPENED the current cluster (not from its predecessor, which would
// let a long chain of 4-minute gaps merge an entire evening into one
// "slot"). Deterministic and transitive, unlike doing the same thing inside
// a comparator.
function clusterByKickoff(events: readonly SportEvent[]): SportEvent[][] {
  const sorted = [...events].sort(
    (a, b) => (kickoffMs(a) ?? Number.MAX_SAFE_INTEGER) - (kickoffMs(b) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
  )
  const clusters: SportEvent[][] = []
  let anchor: number | null = null
  for (const event of sorted) {
    const start = kickoffMs(event)
    if (clusters.length === 0 || anchor == null || start == null || start - anchor > SAME_SLOT_TOLERANCE_MS) {
      clusters.push([event])
      anchor = start
      continue
    }
    clusters[clusters.length - 1].push(event)
  }
  return clusters
}

// Everything currently live, most relevant first. No clustering: a live
// match's kickoff time says nothing useful about it any more, so relevance
// is the only sensible order (with continuity — "you were just watching
// this" — as one of the signals feeding it).
export function rankLiveEvents(events: readonly SportEvent[], context: PersonalizationContext): SportEvent[] {
  return [...events].sort(byRelevance(context))
}

// Scheduled events, chronological first and personalized only within a
// kickoff slot. This is the rule that stops a 21:30 giant from displacing
// an 18:30 fixture: they are in different clusters, and clusters are never
// reordered against each other.
export function rankByKickoffThenRelevance(events: readonly SportEvent[], context: PersonalizationContext): SportEvent[] {
  const compare = byRelevance(context)
  return clusterByKickoff(events).flatMap((cluster) => (cluster.length > 1 ? [...cluster].sort(compare) : cluster))
}

// ---------------------------------------------------------------------------
// DIVERSITY
// ---------------------------------------------------------------------------

// At most this many consecutive cards from one competition before the feed
// reaches for something else.
const MAX_CONSECUTIVE_SAME_COMPETITION = 2
// ...and only when the alternative is genuinely comparable. A run of
// Premier League cards that are all far more relevant than anything else on
// is not a bug to be broken up — it is the correct answer for a viewer who
// follows the Premier League.
const DIVERSITY_SCORE_TOLERANCE = 25

// Breaks up long single-competition runs WITHIN one already-ordered block,
// without ever moving the first card and without crossing a group or
// cluster boundary (callers apply it per block, so it structurally cannot).
//
// Deliberately conservative: it only ever promotes an event that is within
// DIVERSITY_SCORE_TOLERANCE of the one it displaces, so the feed's top
// result and any genuinely dominant run are untouched. If this ever needs
// to grow teeth, it is one pure function with its own tests rather than a
// rule tangled into the sort.
export function applyDiversity(events: readonly SportEvent[], context: PersonalizationContext): SportEvent[] {
  if (events.length <= MAX_CONSECUTIVE_SAME_COMPETITION) return [...events]

  const remaining = [...events]
  const result: SportEvent[] = []
  let runCompetition: string | null = null
  let runLength = 0

  while (remaining.length > 0) {
    let index = 0
    if (runCompetition != null && runLength >= MAX_CONSECUTIVE_SAME_COMPETITION && remaining[0].leagueId === runCompetition) {
      const bestScore = scoreFeedCandidate(remaining[0], context)
      const alternative = remaining.findIndex(
        (event) => event.leagueId !== runCompetition && bestScore - scoreFeedCandidate(event, context) <= DIVERSITY_SCORE_TOLERANCE,
      )
      if (alternative !== -1) index = alternative
    }
    const [picked] = remaining.splice(index, 1)
    result.push(picked)
    if (picked.leagueId === runCompetition) runLength += 1
    else {
      runCompetition = picked.leagueId
      runLength = 1
    }
  }
  return result
}

// The whole feed, in render order: live, then starting soon, then later
// today. Each band is ordered by its own rule (see above) and diversified
// independently, so diversification can never move a card across a band.
export function rankHomeFeed(
  events: readonly SportEvent[],
  context: PersonalizationContext,
  now: number,
): HomeFeedItem[] {
  const live: SportEvent[] = []
  const startingSoon: SportEvent[] = []
  const comingUp: SportEvent[] = []
  // De-duplicated by id: the caller assembles this from several fetches
  // (the urgent all-competitions window, the rest of today, F1) whose
  // windows can legitimately overlap, and a duplicate would surface as a
  // duplicate React key.
  const seen = new Set<string>()

  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    const group = feedGroupFor(eventTiming(event, now))
    if (group === 'live') live.push(event)
    else if (group === 'starting-soon') startingSoon.push(event)
    else if (group === 'coming-up') comingUp.push(event)
  }

  return [
    ...applyDiversity(rankLiveEvents(live, context), context).map((event): HomeFeedItem => ({ event, group: 'live' })),
    ...applyDiversity(rankByKickoffThenRelevance(startingSoon, context), context).map(
      (event): HomeFeedItem => ({ event, group: 'starting-soon' }),
    ),
    ...applyDiversity(rankByKickoffThenRelevance(comingUp, context), context).map(
      (event): HomeFeedItem => ({ event, group: 'coming-up' }),
    ),
  ]
}

// ---------------------------------------------------------------------------
// HERO
// ---------------------------------------------------------------------------

// THE GATE. Live, or kicking off within the hour — nothing else, ever.
export function getWatchableNowCandidates(events: readonly SportEvent[], now: number): SportEvent[] {
  return events.filter((event) => {
    const timing = eventTiming(event, now)
    return timing === 'live' || timing === 'starting-soon'
  })
}

export interface HeroSelection {
  hero: SportEvent | null
  // Whether the hero is something the viewer can actually start watching —
  // it is both inside the watchable-now window AND has a real stream in
  // their playlist. Home's CTA reads "Watch Now" only when this is true;
  // otherwise it says "Event Preview", because a Watch Now button that
  // leads nowhere is worse than no button.
  isWatchableNow: boolean
}

// Whether Ninety can actually PLAY an event for this viewer right now.
// Deliberately a separate question from whether the event is relevant: a
// Champions League tie the user's playlist doesn't carry is still something
// Home should know about and rank, it just can't be sold as "Watch Now".
export type PlayabilityCheck = (event: SportEvent) => boolean
const ALWAYS_PLAYABLE: PlayabilityCheck = () => true

export function selectHero(
  events: readonly SportEvent[],
  context: PersonalizationContext = EMPTY_PERSONALIZATION_CONTEXT,
  now: number = Date.now(),
  isPlayable: PlayabilityCheck = ALWAYS_PLAYABLE,
): HeroSelection {
  const candidates = getWatchableNowCandidates(events, now)

  if (candidates.length > 0) {
    const ranked = [...candidates].sort((a, b) => {
      const byScore = scoreHeroCandidate(b, context, now) - scoreHeroCandidate(a, context, now)
      if (byScore !== 0) return byScore
      const byTime = (kickoffMs(a) ?? Number.MAX_SAFE_INTEGER) - (kickoffMs(b) ?? Number.MAX_SAFE_INTEGER)
      if (byTime !== 0) return byTime
      return a.id.localeCompare(b.id)
    })
    // Prefer the best candidate that can actually be played. Not a filter
    // applied before scoring: if NOTHING in the pool is playable the hero
    // is still the most relevant of them, shown as a preview rather than
    // replaced by a lesser event or by nothing at all.
    const playable = ranked.find(isPlayable)
    if (playable) return { hero: playable, isWatchableNow: true }
    return { hero: ranked[0], isWatchableNow: false }
  }

  // Nothing to watch yet, so the hero becomes TIME-LED: the next thing on,
  // not the biggest thing on. The candidate window is the earliest kickoff
  // slot; relevance then chooses inside it. An 18:30 fixture therefore
  // stays the hero over a 21:30 blockbuster — the blockbuster is not
  // something you can put on at 17:00, and the hero's job is to answer
  // "what now", not "what is the best match in my week".
  const upcoming = events.filter((event) => eventTiming(event, now) === 'upcoming')
  if (upcoming.length === 0) return { hero: null, isWatchableNow: false }
  const [earliestSlot] = clusterByKickoff(upcoming)
  const hero = [...earliestSlot].sort((a, b) => {
    const byScore = scoreHeroCandidate(b, context, now) - scoreHeroCandidate(a, context, now)
    return byScore !== 0 ? byScore : a.id.localeCompare(b.id)
  })[0]
  return { hero: hero ?? null, isWatchableNow: false }
}

// ---------------------------------------------------------------------------
// DIAGNOSTICS
// ---------------------------------------------------------------------------

export interface RankingExplanation {
  id: string
  title: string
  timing: EventTiming
  breakdown: ScoreBreakdown
}

// Why the order came out the way it did, itemized per event. A ranking with
// this many inputs is impossible to calibrate from the final order alone —
// this is what makes "why is that the hero?" answerable, in a test or from
// a dev console, without adding logging to the ranking itself.
//
// Never called in production: useHomeFeed only reaches for it behind
// `import.meta.env.DEV`, so it costs a packaged Tizen build nothing.
export function describeRanking(
  events: readonly SportEvent[],
  context: PersonalizationContext,
  now: number,
): RankingExplanation[] {
  return events
    .map((event) => ({
      id: event.id,
      title: event.title,
      timing: eventTiming(event, now),
      breakdown: getScoreBreakdown(event, context, { now, includeTemporal: true }),
    }))
    .sort((a, b) => b.breakdown.total - a.breakdown.total)
}
