// What is ONE event worth to THIS viewer, right now?
//
// Pure, deterministic, React-free and `now`-injected — every temporal input
// is a parameter, never Date.now(), so a test can state a scenario as data
// ("20:40, this match is live, that one kicks off at 21:00") instead of
// mocking the clock. homeRanking.ts turns these scores into an order;
// nothing here knows what a hero or a feed row is.
//
// TWO THINGS THIS FILE DELIBERATELY IS NOT:
//
// 1. It is not the only thing that decides the hero. Time ELIGIBILITY is a
//    hard gate applied before scoring (see homeRanking.ts's
//    HERO_WATCHABLE_WINDOW_MS): a match 61 minutes away cannot out-score
//    its way into the hero while something is live. A single blended score
//    would let it, which is exactly the failure this design rejects.
//
// 2. It does not read favoriteCountries. That preference ranks which
//    BROADCAST MARKET a viewer would rather watch a stream from (language,
//    commentary, their own IPTV playlist's coverage — see
//    viewerMarket.ts/buildEventStreamOptions.ts). "I want Norwegian
//    commentary" is not "I am more interested in Norwegian football", and
//    conflating them would quietly narrow every recommendation this feature
//    exists to widen. Country stays in stream selection; it is not an
//    input here and must not become one.
import { competitionPrestige, parseRoundStage, type RoundStage } from './heroScoring'
import { effectiveLiveState } from './liveHeuristic'
import type { SportEvent } from './types'

// ---------------------------------------------------------------------------
// WEIGHTS
// ---------------------------------------------------------------------------
//
// Every number the ranking uses lives in this one object. They are an
// editorial calibration, not a derivation — the point of naming them here
// is that the whole system can be retuned by reading one table instead of
// hunting constants through the scoring code.
//
// The hierarchy they encode, strongest first:
//
//   explicit favorite team          a choice the user actually made
//   event's competition is favorite  ditto, one level less specific
//   participant's domestic league    "I follow Eliteserien" reaching a
//                                    Norwegian club's European night
//   learned viewing affinity         inferred, never stronger than stated
//   objective importance             prominence / competition / stage /
//                                    rivalry — how big the match is to
//                                    anyone, which is what keeps Home
//                                    useful for a user with no preferences
//                                    at all and stops favorites becoming a
//                                    filter bubble
//   temporal (hero only)             live vs. how soon it kicks off
//
// The single calibration target that fixes the shape: an explicit favorite
// team (100) must outrank the largest possible objective case a non-favorite
// match can build — the biggest matchup in football (~47) plus the biggest
// competition (~23) plus a final (30) plus maximum rivalry (25) is ~125, so
// a favorite team does NOT automatically beat a Champions League final; it
// does comfortably beat any ordinary big-club fixture (~92), which is
// exactly the intended balance. See the tests for the cases this pins down.
export const HOME_WEIGHTS = {
  // --- Explicit user choices ---
  favoriteTeam: 100,
  favoriteCompetition: 60,
  // Weaker than favoriting the competition the match is actually IN, and
  // much weaker than favoriting the club itself — it is an inference from
  // a related preference, not a stated one.
  domesticAffinity: 45,

  // --- Learned (implicit) affinity, see watchAffinity.ts ---
  // Capped well below the explicit equivalents on purpose: watching one
  // match must never come to outweigh ticking a box.
  learnedTeamMax: 30,
  learnedCompetitionMax: 12,
  // "You were watching this a few minutes ago" — strong among what is live
  // right now (that is the whole point), still far below an explicit
  // favorite so it can never hijack the hero from a followed club.
  continuity: 35,

  // --- Objective importance ---
  matchupProminenceMax: 50,
  // Competition points are derived from heroScoring's 0..1 prestige rather
  // than a second tier table (which would drift from it). The line is
  // chosen to land the documented anchors: tier 1 (prestige 0.85) -> 18,
  // tier 3 (0.45) -> 4, which puts tier 2 (0.65) at 11 and the Champions
  // League's editorial override (1.00) at 23. Clamped at 0 so a
  // hypothetical very low prestige can never subtract.
  competitionSlope: 35,
  competitionOffset: 11.75,
  stage: {
    final: 30,
    'semi-final': 22,
    'quarter-final': 15,
    'round-of-16': 9,
    'play-off': 5,
    group: 2,
    qualifying: 0,
    'regular-season': 0,
  } satisfies Record<RoundStage, number>,
  rivalryMax: 25,

  // --- Temporal (HERO ONLY — see scoreHeroCandidate) ---
  // Live scores highest, then decreasing bands out to the 60-minute
  // eligibility edge. The bands are close together on purpose: they are
  // meant to break ties between comparable matches, not to let "sooner"
  // overwhelm "much more relevant to you". The gap between live (30) and
  // the 45-60m band (12) is 18 points — less than one favorite-team boost,
  // more than a typical prominence difference.
  temporalLive: 30,
  temporalWithin15: 28,
  temporalWithin30: 24,
  temporalWithin45: 18,
  temporalWithin60: 12,
} as const

// A club with no prominence on record (every club, against a ninety-api
// deployment predating the field). Deliberately mid-scale rather than 0: an
// unknown club is not a small club, and scoring it as one would push every
// fixture from a competition the backend hasn't profiled to the bottom of
// Home. Because it applies uniformly when the whole field is missing, it
// contributes a constant that changes no ordering at all.
export const NEUTRAL_PROMINENCE = 0.5

// ---------------------------------------------------------------------------
// CONTEXT
// ---------------------------------------------------------------------------

// Everything about the VIEWER that scoring needs, resolved once by the
// caller. Sets rather than arrays because every lookup here is a membership
// test and a Home feed can hold a few hundred events — see
// buildPersonalizationContext for the conversion.
export interface PersonalizationContext {
  favoriteTeamIds: ReadonlySet<string>
  favoriteCompetitionIds: ReadonlySet<string>
  // Learned affinity, 0..1 per canonical id. Optional: an install with no
  // watch history (or with the feature unavailable) simply scores 0 for
  // these terms rather than needing a second code path.
  teamAffinity?: ReadonlyMap<string, number>
  competitionAffinity?: ReadonlyMap<string, number>
  // The event the viewer was watching moments ago, if any — see
  // watchAffinity.ts's recentlyWatchedEventId. Only meaningful for an event
  // that is still live.
  continuityEventId?: string | null
}

export function buildPersonalizationContext(input: {
  favoriteTeamIds?: readonly string[]
  favoriteCompetitionIds?: readonly string[]
  teamAffinity?: ReadonlyMap<string, number>
  competitionAffinity?: ReadonlyMap<string, number>
  continuityEventId?: string | null
}): PersonalizationContext {
  return {
    favoriteTeamIds: new Set(input.favoriteTeamIds ?? []),
    favoriteCompetitionIds: new Set(input.favoriteCompetitionIds ?? []),
    teamAffinity: input.teamAffinity,
    competitionAffinity: input.competitionAffinity,
    continuityEventId: input.continuityEventId ?? null,
  }
}

export const EMPTY_PERSONALIZATION_CONTEXT: PersonalizationContext = buildPersonalizationContext({})

// ---------------------------------------------------------------------------
// TEMPORAL STATE
// ---------------------------------------------------------------------------

// Where an event sits relative to the viewer's clock. 'starting-soon' is
// both a ranking input and a UI state (Home shows "STARTING SOON · 21:00"
// for exactly this set), so it is defined once, here, rather than each
// surface re-deriving its own idea of "soon".
export type EventTiming = 'live' | 'starting-soon' | 'upcoming' | 'past' | 'unknown'

// The one boundary the whole hero design rests on. An event is in the
// "watchable now" pool if it is live OR kicks off within this window; a
// match one millisecond past it is not, no matter how relevant.
//
// Sixty minutes because that is when a football broadcast's build-up
// starts: a viewer turning the TV on at 20:40 for a 21:00 kick-off wants
// the studio, not whatever else happens to be in its second half.
export const STARTING_SOON_WINDOW_MS = 60 * 60 * 1000

export function kickoffMs(event: Pick<SportEvent, 'dateTimeUtc'>): number | null {
  if (!event.dateTimeUtc) return null
  const ms = new Date(event.dateTimeUtc).getTime()
  return Number.isNaN(ms) ? null : ms
}

// The boundary is stated as `> now && <= now + window` — closed at the far
// end, so EXACTLY sixty minutes away is still "starting soon" and sixty
// minutes plus one millisecond is not. Stating it in milliseconds rather
// than rounded minutes is what makes that testable at all: rounding to
// whole minutes first would make the 60m/61m distinction depend on the
// seconds component of `now`.
export function eventTiming(
  event: Pick<SportEvent, 'dateTimeUtc' | 'isLive' | 'sportKey' | 'title'> & { status?: string },
  now: number,
): EventTiming {
  if (event.isLive) return 'live'
  const start = kickoffMs(event)
  if (start == null) return 'unknown'
  if (start <= now) {
    // KICKOFF HAS PASSED IS NOT THE SAME AS OVER, and this line is the
    // reason that invariant holds no matter which code path asks.
    //
    // `event.isLive` above is frozen at MAPPING time (mapEvent.ts), which
    // is up to one background-refresh cycle old; this function is the one
    // that runs against the live clock on every derivation. Deciding
    // 'past' from the kickoff timestamp alone therefore had two ways to
    // lose the same match: a provider that never advanced its status out
    // of 'scheduled' (the Lillestrøm - Egnatia case, 2026-08-27), and the
    // ordinary gap between a match kicking off and the next refetch.
    //
    // Same shared rule as the mapper — see liveHeuristic.ts. It speaks
    // only over 'scheduled'/absent statuses inside a sport-specific
    // in-play window, so 'complete', 'cancelled', 'postponed',
    // 'abandoned' and anything unrecognized still land squarely on 'past'.
    return effectiveLiveState(event, now).isLive ? 'live' : 'past'
  }
  return start - now <= STARTING_SOON_WINDOW_MS ? 'starting-soon' : 'upcoming'
}

// ---------------------------------------------------------------------------
// SIGNALS
// ---------------------------------------------------------------------------

// Prominence is a property of the PAIRING, not of the bigger club: Real
// Madrid against Barcelona has to score above Real Madrid against a club
// nobody outside its city has heard of, even though Real Madrid is exactly
// as prominent in both. Weighting the bigger side more (0.60/0.40) keeps a
// giant-vs-small fixture ahead of a mid-vs-mid one, which is also true.
export function matchupProminence(event: Pick<SportEvent, 'homeTeamProminence' | 'awayTeamProminence'>): number {
  const home = event.homeTeamProminence ?? NEUTRAL_PROMINENCE
  const away = event.awayTeamProminence ?? NEUTRAL_PROMINENCE
  const bigger = Math.max(home, away)
  const smaller = Math.min(home, away)
  return 0.6 * bigger + 0.4 * smaller
}

// Points for the competition itself — see HOME_WEIGHTS.competitionSlope.
export function competitionImportance(event: Pick<SportEvent, 'leagueId' | 'leagueTier'>): number {
  const points = HOME_WEIGHTS.competitionSlope * competitionPrestige(event) - HOME_WEIGHTS.competitionOffset
  return Math.max(0, points)
}

export function stageImportance(round: string | undefined): number {
  const stage = parseRoundStage(round)
  return stage ? HOME_WEIGHTS.stage[stage] : 0
}

// True when the event's OWN competition is one the viewer follows.
//
// Exported since 2026-08-28: Home's content policy (homeContentPolicy.ts)
// asks exactly this question — it is the ONLY thing 'favorites_only' lets
// through — and a second `favoriteCompetitionIds.has(event.leagueId)`
// written there would be free to drift from this one.
export function isFavoriteCompetitionEvent(event: SportEvent, context: PersonalizationContext): boolean {
  return context.favoriteCompetitionIds.has(event.leagueId)
}

// True when a PARTICIPANT plays its league football in a competition the
// viewer follows — the Bodø/Glimt-in-the-Champions-League case. The raw
// membership test, with no regard for what competition this fixture itself
// is in.
//
// Exported for the content policy, which needs the raw question ("does this
// event reach the viewer through a league they follow?") rather than the
// scoring one below.
export function hasDomesticCompetitionMembership(event: SportEvent, context: PersonalizationContext): boolean {
  const { favoriteCompetitionIds } = context
  return (
    (event.homeDomesticCompetitionId != null && favoriteCompetitionIds.has(event.homeDomesticCompetitionId)) ||
    (event.awayDomesticCompetitionId != null && favoriteCompetitionIds.has(event.awayDomesticCompetitionId))
  )
}

// The SCORING form of the same signal. Explicitly false when the event's own
// competition is already a favorite: that is the same interest, already paid
// for by favoriteCompetition above, and counting it twice would make a
// Premier League fixture between two Premier League clubs score as if the
// viewer had expressed two separate preferences. Inclusion has no such
// double-counting problem, which is why the policy uses the raw test and
// this one stays private to scoring.
function hasDomesticAffinity(event: SportEvent, context: PersonalizationContext): boolean {
  if (isFavoriteCompetitionEvent(event, context)) return false
  return hasDomesticCompetitionMembership(event, context)
}

// Is one of the viewer's EXPLICITLY favorited clubs playing in this event?
//
// Canonical ids only, never display names (see SportEvent.homeTeamId). It
// is exported because it is no longer only a scoring signal: the Home
// broadcast-eligibility layer uses this exact test — and only this one,
// never "the competition is a favorite" — to decide whether an event the
// backend does not expect to be televised is still worth telling the viewer
// about. Two callers, one definition, so they can never drift apart.
export function isFavoriteTeamEvent(event: SportEvent, context: PersonalizationContext): boolean {
  if (context.favoriteTeamIds.size === 0) return false
  return (
    (event.homeTeamId != null && context.favoriteTeamIds.has(event.homeTeamId)) ||
    (event.awayTeamId != null && context.favoriteTeamIds.has(event.awayTeamId))
  )
}

// The stronger of the two sides' learned affinity, not their sum: a viewer
// who watches one club a lot should not have every fixture involving two
// clubs they mildly recognise float above it.
function learnedTeamAffinity(event: SportEvent, context: PersonalizationContext): number {
  const affinity = context.teamAffinity
  if (!affinity || affinity.size === 0) return 0
  const home = event.homeTeamId != null ? (affinity.get(event.homeTeamId) ?? 0) : 0
  const away = event.awayTeamId != null ? (affinity.get(event.awayTeamId) ?? 0) : 0
  return Math.max(home, away)
}

// ---------------------------------------------------------------------------
// SCORING
// ---------------------------------------------------------------------------

// Every term, itemized. Kept as a real returned object rather than a debug
// log because a ranking that can only be inspected through its final order
// is a ranking nobody can calibrate: the tests assert against these fields
// directly, and the dev-only Home diagnostic prints them (see
// homeRanking.ts's describeRanking).
export interface ScoreBreakdown {
  favoriteTeam: number
  favoriteCompetition: number
  domesticAffinity: number
  learnedTeam: number
  learnedCompetition: number
  continuity: number
  matchupProminence: number
  competition: number
  stage: number
  rivalry: number
  // Zero for feed scoring — the feed expresses time through its GROUPS
  // (live, then starting soon, then later), never as points that could
  // reorder across them. See homeRanking.ts.
  temporal: number
  total: number
}

// What the viewer has told us, or what we have inferred about them.
export function scoreEventAffinity(event: SportEvent, context: PersonalizationContext): number {
  const breakdown = scoreEvent(event, context, 0)
  return (
    breakdown.favoriteTeam +
    breakdown.favoriteCompetition +
    breakdown.domesticAffinity +
    breakdown.learnedTeam +
    breakdown.learnedCompetition +
    breakdown.continuity
  )
}

// How big the match is to anyone — the half of the score that keeps Home
// useful for a viewer with no preferences at all, and that lets a Champions
// League final surface for someone who only follows the Premier League.
export function scoreObjectiveImportance(event: SportEvent): number {
  const breakdown = scoreEvent(event, EMPTY_PERSONALIZATION_CONTEXT, 0)
  return breakdown.matchupProminence + breakdown.competition + breakdown.stage + breakdown.rivalry
}

// Points for how watchable-right-now an event is. HERO ONLY: the feed must
// never express time as points (see ScoreBreakdown.temporal). `timing` is
// passed in rather than recomputed so the caller's single notion of "now"
// governs both eligibility and scoring.
function temporalPoints(event: SportEvent, now: number): number {
  const timing = eventTiming(event, now)
  if (timing === 'live') return HOME_WEIGHTS.temporalLive
  if (timing !== 'starting-soon') return 0
  const minutesAway = ((kickoffMs(event) as number) - now) / 60_000
  if (minutesAway <= 15) return HOME_WEIGHTS.temporalWithin15
  if (minutesAway <= 30) return HOME_WEIGHTS.temporalWithin30
  if (minutesAway <= 45) return HOME_WEIGHTS.temporalWithin45
  return HOME_WEIGHTS.temporalWithin60
}

// The whole score, itemized. `temporalWeight` is 1 for hero scoring and 0
// for feed scoring — one function, one set of weights, and the ONLY
// difference between the two rankings' scores is whether time is allowed to
// contribute points at all.
function scoreEvent(event: SportEvent, context: PersonalizationContext, temporalWeight: 0 | 1, now = 0): ScoreBreakdown {
  const favoriteTeam = isFavoriteTeamEvent(event, context) ? HOME_WEIGHTS.favoriteTeam : 0
  const favoriteCompetition = isFavoriteCompetitionEvent(event, context) ? HOME_WEIGHTS.favoriteCompetition : 0
  const domesticAffinity = hasDomesticAffinity(event, context) ? HOME_WEIGHTS.domesticAffinity : 0

  const learnedTeam = learnedTeamAffinity(event, context) * HOME_WEIGHTS.learnedTeamMax
  const learnedCompetition = (context.competitionAffinity?.get(event.leagueId) ?? 0) * HOME_WEIGHTS.learnedCompetitionMax
  // Continuity only means anything while the match is still going: "you
  // were watching this" is a reason to put a LIVE match back in front of
  // you, not a reason to feature a fixture that has since finished.
  const continuity = context.continuityEventId === event.id && event.isLive ? HOME_WEIGHTS.continuity : 0

  const prominence = matchupProminence(event) * HOME_WEIGHTS.matchupProminenceMax
  const competition = competitionImportance(event)
  const stage = stageImportance(event.round)
  const rivalry = (event.rivalryImportance ?? 0) * HOME_WEIGHTS.rivalryMax
  const temporal = temporalWeight === 1 ? temporalPoints(event, now) : 0

  const total =
    favoriteTeam +
    favoriteCompetition +
    domesticAffinity +
    learnedTeam +
    learnedCompetition +
    continuity +
    prominence +
    competition +
    stage +
    rivalry +
    temporal

  return {
    favoriteTeam,
    favoriteCompetition,
    domesticAffinity,
    learnedTeam,
    learnedCompetition,
    continuity,
    matchupProminence: prominence,
    competition,
    stage,
    rivalry,
    temporal,
    total,
  }
}

// Hero scoring — time contributes points. Only ever called on candidates
// that already passed the hard eligibility gate (homeRanking.ts), so the
// temporal term is a tie-breaker between comparable "watchable now"
// options, never a way for a distant match to buy its way in.
export function scoreHeroCandidate(event: SportEvent, context: PersonalizationContext, now: number): number {
  return scoreEvent(event, context, 1, now).total
}

// Feed scoring — time contributes NOTHING. The feed states time through its
// groups and its chronological order; letting it also add points here is
// precisely how an upcoming match would end up above a live one.
export function scoreFeedCandidate(event: SportEvent, context: PersonalizationContext): number {
  return scoreEvent(event, context, 0).total
}

// The itemized version, for tests and the dev-only diagnostic. Same code
// path as the real scorers above — never a parallel reimplementation that
// could report something the ranking doesn't actually use.
export function getScoreBreakdown(
  event: SportEvent,
  context: PersonalizationContext,
  options: { now?: number; includeTemporal?: boolean } = {},
): ScoreBreakdown {
  const includeTemporal = options.includeTemporal ?? options.now != null
  return scoreEvent(event, context, includeTemporal ? 1 : 0, options.now ?? 0)
}
