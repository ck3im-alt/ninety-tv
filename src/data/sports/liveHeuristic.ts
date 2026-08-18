import type { SportKey } from './types'

// TheSportsDB's free tier only has real live scores for football
// (verified directly: livescore.php returns null for Motorsport, only
// Soccer) — F1 (the only other followed sport now, see types.ts) has no
// live signal at all, so "live" is a guess: has the most recently-started
// session's scheduled time passed, but not so long ago that it's obviously
// over. No score/result is shown, only a LIVE badge — the guess is about
// timing, never a result.
//
// A race weekend session (practice/qualifying/race) is a real, specific
// scheduled time from TheSportsDB, unlike golf's date-only placeholder
// timestamps (the reason golf got dropped entirely rather than special-
// cased forever — see types.ts) — so a straightforward duration window
// from the actual start time is trustworthy here.
const ASSUMED_DURATION_MINUTES = 90
const RACE_DURATION_MINUTES = 150

// Race sessions run longer than practice/qualifying — the event title is
// the only signal available (no session-type field), so a simple keyword
// check on it.
function durationForEvent(title: string): number {
  return /\brace\b/i.test(title) ? RACE_DURATION_MINUTES : ASSUMED_DURATION_MINUTES
}

export function isHeuristicallyLive(_sportKey: SportKey, title: string, dateTimeUtc: string | null): boolean {
  if (!dateTimeUtc) return false
  const start = new Date(dateTimeUtc).getTime()
  if (Number.isNaN(start)) return false
  const now = Date.now()
  const duration = durationForEvent(title)
  return start <= now && now <= start + duration * 60_000
}
