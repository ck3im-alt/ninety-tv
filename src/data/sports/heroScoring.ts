// Picks which upcoming event becomes the Home screen's featured hero card.
// Previously this was just "chronologically soonest" (`upcoming[0]`), which
// has no sense of how big a game is — a Tuesday-night Conference League
// qualifier and a Champions League final would be ranked identically as
// long as they kicked off at the same time. This scores each candidate on
// three axes and picks the highest.
//
// Personalization (e.g. weighting a Norwegian team higher because the user
// picked Norway as a favorite country) is intentionally NOT part of this
// yet — it needs a team-nationality data source we don't have cheaply
// available, and was deliberately deferred rather than built on a shaky
// heuristic. `pickHero` takes no user-preference argument for now, but
// nothing here should make adding that later awkward: it would just become
// a fourth weighted term.
import type { SportEvent } from './types'

// Editorial judgment calls, not derived from any data source — same spirit
// as the curated background images (staticBackground in leagues.ts): an
// honest, documented choice, easy to retune, rather than pretending to be
// objective. Keyed by our internal LeagueDef.id (SportEvent.leagueId).
const LEAGUE_PRESTIGE: Record<string, number> = {
  '4480': 1.0, // UEFA Champions League
  '4328': 0.85, // Premier League
  '4335': 0.85, // La Liga
  '4481': 0.75, // UEFA Europa League
  '4332': 0.8, // Serie A
  '4331': 0.8, // Bundesliga
  '4334': 0.75, // Ligue 1
  '4370': 0.9, // F1
  '5071': 0.6, // UEFA Conference League
  '4337': 0.6, // Eredivisie
  '4344': 0.6, // Primeira Liga
  '4346': 0.55, // MLS
  '4329': 0.55, // Championship
}
const DEFAULT_LEAGUE_PRESTIGE = 0.5

// Stage within a competition — later rounds matter more than early
// qualifying. Matched by substring against whatever round text the source
// gave us (api-football's is human-readable, e.g. "3rd Qualifying Round";
// TheSportsDB's is a bare number and won't match anything here, which is
// fine — it just falls through to the neutral default). Order matters:
// checked top-to-bottom, so more specific phrases ("semi-final") must come
// before substrings they contain ("final").
const ROUND_KEYWORDS: Array<[pattern: string, weight: number]> = [
  ['final', 1.0], // catches "Final" but also correctly ranks below by being checked after semi/quarter
  ['semi', 0.85],
  ['quarter', 0.75],
  ['round of 16', 0.65],
  ['play-off', 0.55],
  ['playoff', 0.55],
  ['group', 0.6],
  ['qualifying', 0.35],
  ['regular season', 0.5],
]
const DEFAULT_ROUND_WEIGHT = 0.5

function roundWeight(round: string | undefined): number {
  if (!round) return DEFAULT_ROUND_WEIGHT
  const lower = round.toLowerCase()
  // "semi-final"/"quarter-final" contain "final" as a substring, so those
  // more specific patterns are listed first above and must win — find the
  // first (highest-priority) match rather than the literal first-in-string.
  for (const [pattern, weight] of ROUND_KEYWORDS) {
    if (lower.includes(pattern)) return weight
  }
  return DEFAULT_ROUND_WEIGHT
}

// Linear decay over the 3-day lookahead window (see FOOTBALL_LOOKAHEAD_DAYS
// in useHomeFeed.ts) — starting soon scores highest, but never drops to
// zero, so a big-enough prestige/round gap can still outrank something
// starting imminently. Floor at 0.1 rather than 0, so recency alone never
// fully vetoes an otherwise-huge match.
function recencyWeight(dateTimeUtc: string | null): number {
  if (!dateTimeUtc) return DEFAULT_ROUND_WEIGHT
  const hoursAway = (new Date(dateTimeUtc).getTime() - Date.now()) / (1000 * 60 * 60)
  if (hoursAway <= 0) return 1
  return Math.max(0.1, 1 - hoursAway / 72)
}

const WEIGHT_LEAGUE = 0.45
const WEIGHT_ROUND = 0.25
const WEIGHT_RECENCY = 0.3

function score(event: SportEvent): number {
  const leagueScore = LEAGUE_PRESTIGE[event.leagueId] ?? DEFAULT_LEAGUE_PRESTIGE
  return WEIGHT_LEAGUE * leagueScore + WEIGHT_ROUND * roundWeight(event.round) + WEIGHT_RECENCY * recencyWeight(event.dateTimeUtc)
}

// `events` should already be the chronologically-sorted upcoming list —
// ties in score fall back to whichever is sooner, since it's already in
// that order and Array.reduce keeps the first (earlier) of equal scores.
export function pickHero(events: SportEvent[]): SportEvent | null {
  if (events.length === 0) return null
  return events.reduce((best, ev) => (score(ev) > score(best) ? ev : best))
}

const WATCHABLE_WINDOW_MS = 60 * 60 * 1000 // 1 hour
// Events "at the same time" as the soonest one, when nothing is watchable
// yet — a small tolerance rather than an exact timestamp match, since two
// games in the same slot are rarely down to the same second.
const SAME_SLOT_TOLERANCE_MS = 5 * 60 * 1000 // 5 minutes

export interface HeroSelection {
  hero: SportEvent | null
  // True when the hero is live or starts within the hour — the Home
  // screen's CTA should say "Watch Now" only in that case. Recency isn't
  // just one factor among several here: a two-days-out Champions League
  // final should never outrank a lesser match happening imminently, since
  // the whole point of a "Watch Now" button is that you actually can.
  isWatchableNow: boolean
}

// Two-tier selection, not a single blended score:
// 1. Anything live, or starting within the hour, is "now" — pick the
//    best of those (prestige/round breaks ties) and mark it watchable.
// 2. Otherwise nothing is close enough to watch yet: fall back to the
//    single soonest upcoming time slot (plus a short tolerance for
//    near-simultaneous kickoffs) and pick the best among just that slot —
//    "next event", not "best event sometime in the next 3 days".
export function selectHero(liveNow: SportEvent[], upcoming: SportEvent[]): HeroSelection {
  const now = Date.now()
  const startingSoon = upcoming.filter((ev) => {
    if (!ev.dateTimeUtc) return false
    return new Date(ev.dateTimeUtc).getTime() - now <= WATCHABLE_WINDOW_MS
  })
  const nowCandidates = [...liveNow, ...startingSoon]
  if (nowCandidates.length > 0) {
    return { hero: pickHero(nowCandidates), isWatchableNow: true }
  }

  if (upcoming.length === 0) return { hero: null, isWatchableNow: false }
  // `upcoming` is already chronologically sorted, so its first entry's
  // time is the soonest slot.
  const soonestTime = new Date(upcoming[0].dateTimeUtc!).getTime()
  const nextSlot = upcoming.filter((ev) => new Date(ev.dateTimeUtc!).getTime() - soonestTime <= SAME_SLOT_TOLERANCE_MS)
  return { hero: pickHero(nextSlot), isWatchableNow: false }
}
