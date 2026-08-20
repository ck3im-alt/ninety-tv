// Golf/tennis/MMA/basketball were dropped (2026-08-13): no broadcast-data
// provider exists for them (see channelMatch.ts's history — Sportmonks
// only covers football/cricket/F1, and the golf-specific APIs researched
// have no TV-channel data at all), and TheSportsDB's free-tier data for
// them was unreliable (single event per league, placeholder timestamps).
// Users who follow those sports elsewhere can favorite the channel that
// airs them directly — see the "Live on your favorite channels" section.
export type SportKey = 'football' | 'f1'

// A completed match's outcome from one team's own perspective (already
// oriented for home/away — see ninety-api's teamForm.ts). Oldest -> newest
// left to right, so the right-most entry is always the most recent result.
export type TeamFormResult = 'W' | 'D' | 'L'

export interface SportEvent {
  id: string
  sportKey: SportKey
  sportLabel: string
  league: string
  // Our internal LeagueDef.id (leagues.ts) — stable across both data
  // providers (TheSportsDB/api-football use their own, different id
  // spaces) and across a league's display name possibly differing slightly
  // between the two. Used to look up editorial weights like hero-scoring
  // prestige (see heroScoring.ts) without fragile string-matching on
  // `league`.
  leagueId: string
  leagueBadge?: string
  // Copied from LeagueDef.tier at mapping time (see mapEvent.ts) — lets
  // heroScoring.ts weight prestige without doing its own leagueId lookup
  // against a competitions catalog, which (since 2026-08-20) is fetched
  // asynchronously and isn't guaranteed to be populated/current at
  // scoring time the way a synchronous lookup would assume. Undefined for
  // sports with no tier concept (e.g. F1).
  leagueTier?: 1 | 2 | 3
  // Team fixtures (football/tennis) have home/away; single-entrant events
  // (F1 sessions, golf rounds, UFC cards) only have `title`.
  title: string
  homeTeam?: string
  awayTeam?: string
  homeBadge?: string
  awayBadge?: string
  // Last-5 completed-results form, server-computed by ninety-api from
  // footballdata.io's own results (see teamForm.ts) — never fetched or
  // derived on the TV. Undefined when ninety-api hasn't computed it yet for
  // this team (new team, or the API is being extended to a sport that
  // doesn't have it); a present-but-short array (fewer than 5 entries)
  // means genuinely fewer than 5 trustworthy completed matches exist, not
  // a loading state — never padded.
  homeForm?: TeamFormResult[]
  awayForm?: TeamFormResult[]
  venue?: string
  venueCity?: string
  referee?: string
  // Round/matchweek number, when the source has one (league fixtures do;
  // one-off events like F1 sessions or UFC cards don't).
  round?: string
  dateTimeUtc: string | null
  timeLabel: string
  backgroundUrl?: string
  isLive: boolean
  // True when isLive is a timing guess (no real live signal exists for
  // this sport on the free API — see liveHeuristic.ts), false/undefined
  // when it's a real live score from livescore.php (football only).
  // Never render a score/clock next to a heuristic-live event — there
  // isn't one, only a start-time guess.
  isLiveHeuristic?: boolean
  // Per-side scores (not a combined "2–1" string) so the UI can place
  // each next to its own team's row. Real football live data only.
  homeScore?: string
  awayScore?: string
  // Match clock/period — "67'", "2nd Set", "HT". Real football live data
  // only; heuristic-live events never get one (see isLiveHeuristic).
  liveClock?: string
  // Real linear TV channels ninety-api's own EPG resolver has already
  // matched to this event (see ninetyApiClient.ts) — carried on the event
  // itself so channelMatch.ts can check the user's playlist against these
  // directly, with no second network round-trip needed (unlike the old
  // Sportmonks flow, which had to re-fetch and re-find the fixture just to
  // get its broadcaster list). Undefined for non-football events, which
  // have no ninety-api resolution at all.
  broadcasts?: {
    logicalChannelId: string
    name: string
    country: string | null
    confidence: number
    classification: 'CONFIRMED' | 'PROBABLE' | 'AMBIGUOUS' | 'UNKNOWN' | 'REJECTED'
  }[]
}
