import type { SportEvent, SportKey } from './types'

// EFFECTIVE LIVE STATE — "is this match actually being played right now?"
//
// Deliberately a DIFFERENT question from `SportEvent.status`, which is and
// stays the provider's canonical verdict. Ninety never overwrites that;
// this file derives a UI-facing answer on top of it, and records whether
// that answer was inferred (`isLiveHeuristic`) so nothing downstream can
// mistake a timing guess for confirmed data.
//
// WHY INFERENCE IS NEEDED AT ALL. Two separate cases:
//
//  1. Sports with no live feed. TheSportsDB's free tier only has real live
//     scores for football (verified directly: livescore.php returns null
//     for Motorsport, only Soccer) — F1 has no live signal whatsoever, so
//     "live" can only ever be a guess about timing. No score/result is
//     shown, only a LIVE badge.
//
//  2. Football, where a live feed exists but is INCOMPLETE. Observed live
//     on 2026-08-27: Lillestrøm - Egnatia Rrogozhinë (Europa League) was
//     being played, but footballdata.io still reported it as `scheduled`
//     and omitted it from GET /fixtures/live entirely, while other ties
//     with the identical kickoff came back live. A provider that simply
//     never advances `scheduled -> live` must not make a match that is
//     visibly on TV vanish from Home, so a kicked-off `scheduled` fixture
//     inside a plausible in-play window is treated as live.
//
// A race weekend session (practice/qualifying/race) is a real, specific
// scheduled time from TheSportsDB, unlike golf's date-only placeholder
// timestamps (the reason golf got dropped entirely rather than special-
// cased forever — see types.ts) — so a straightforward duration window
// from the actual start time is trustworthy for F1 too.

// F1 practice/qualifying, and the floor for anything without a better
// answer.
const ASSUMED_DURATION_MINUTES = 90
const RACE_DURATION_MINUTES = 150

// FOOTBALL: 150 minutes from SCHEDULED kickoff, not 90.
//
// 90 was the old shared default and is simply wrong as a window measured
// from kickoff: 45 + first-half stoppage + ~15 half-time + 45 + second-half
// stoppage already lands near 115 minutes before a single VAR check, and a
// knockout tie going to extra time and penalties (Europa League qualifying,
// exactly the acceptance case above) runs past 140. At 90 a 19:00 match
// would disappear from Home at 20:30 while still being played — the precise
// failure this window exists to prevent.
//
// The ceiling is a deliberate trade: it is the point past which "the
// provider never updated the status" stops being the more likely
// explanation than "this match is over and nobody told us". Anything older
// falls back to past, as before.
const FOOTBALL_DURATION_MINUTES = 150

// Race sessions run longer than practice/qualifying — the event title is
// the only signal available (no session-type field), so a simple keyword
// check on it. Only consulted for sports that have no per-sport answer.
function durationForEvent(sportKey: SportKey, title: string): number {
  if (sportKey === 'football') return FOOTBALL_DURATION_MINUTES
  return /\brace\b/i.test(title) ? RACE_DURATION_MINUTES : ASSUMED_DURATION_MINUTES
}

// The provider positively saying the match is in play. Mirrors ninety-api's
// LIVE_STATUSES (sports/eventStatus.ts) — kept as a literal set here rather
// than imported because the two repos share no code, and drifting apart
// would silently change what counts as confirmed-live.
const PROVIDER_LIVE_STATUSES = new Set(['live', 'halftime'])

// The ONLY statuses a timing guess is allowed to speak over. An allow-list,
// not a deny-list of terminal states, and that direction is the safety
// property: ninety-api's canonical vocabulary is scheduled | live |
// halftime | complete | cancelled | postponed | abandoned (see
// sports/eventStatus.ts), but ingestFixtures.ts passes footballdata.io's
// own status string through largely untranslated, so an unrecognized value
// can reach the client. An unknown status is far more likely to be a new
// abnormal/terminal state ("suspended", "awarded") than a new synonym for
// "not started yet", and refusing to infer there costs nothing — it is
// exactly the behaviour Ninety had before this file existed.
//
// 'incomplete' is footballdata.io's own word for "not played yet";
// ingestFixtures.ts's mapUpcomingStatus normally rewrites it to
// 'scheduled', so it should never arrive, but it means precisely the same
// thing and is accepted rather than blocking a correct inference on a
// spelling.
const INFERABLE_STATUSES = new Set(['scheduled', 'incomplete'])

export function statusAllowsLiveInference(status: string | null | undefined): boolean {
  // Absent entirely: an F1 event (no status concept at all), or a football
  // event from a ninety-api old enough to predate live-score tracking.
  if (status == null || status === '') return true
  return INFERABLE_STATUSES.has(status)
}

// Whether the clock alone says this event is plausibly in play. Knows
// nothing about provider status — callers gate on that separately.
export function isHeuristicallyLive(
  sportKey: SportKey,
  title: string,
  dateTimeUtc: string | null,
  now: number = Date.now(),
): boolean {
  if (!dateTimeUtc) return false
  const start = new Date(dateTimeUtc).getTime()
  if (Number.isNaN(start)) return false
  const duration = durationForEvent(sportKey, title)
  return start <= now && now <= start + duration * 60_000
}

export interface EffectiveLiveState {
  // What the UI should treat as live.
  isLive: boolean
  // True ONLY when `isLive` came from the time window rather than from the
  // provider. Consumers use it to suppress anything that would imply
  // confirmed in-play data — a match clock above all (see homeRowItems.ts,
  // EventHeader.tsx, MultiviewPane.tsx). Never invent a score or a minute
  // for one of these; real score data, if the payload genuinely carries
  // any, still renders normally.
  isLiveHeuristic: boolean
}

// THE ONE PLACE that decides live-vs-not for an event, used both at mapping
// time (mapEvent.ts, which freezes the answer onto SportEvent.isLive) and
// at ranking time (homePersonalization.ts's eventTiming, which re-derives
// it against the current clock). Sharing it is what makes the two
// structurally incapable of disagreeing: same rules, only a different
// `now`.
export function effectiveLiveState(
  event: Pick<SportEvent, 'sportKey' | 'title' | 'dateTimeUtc'> & { status?: string | null },
  now: number = Date.now(),
): EffectiveLiveState {
  if (event.status != null && PROVIDER_LIVE_STATUSES.has(event.status)) {
    return { isLive: true, isLiveHeuristic: false }
  }
  const inferred =
    statusAllowsLiveInference(event.status) && isHeuristicallyLive(event.sportKey, event.title, event.dateTimeUtc, now)
  return { isLive: inferred, isLiveHeuristic: inferred }
}
