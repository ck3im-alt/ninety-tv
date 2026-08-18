// Golf/tennis/MMA/basketball were dropped (2026-08-13): no broadcast-data
// provider exists for them (see channelMatch.ts's history — Sportmonks
// only covers football/cricket/F1, and the golf-specific APIs researched
// have no TV-channel data at all), and TheSportsDB's free-tier data for
// them was unreliable (single event per league, placeholder timestamps).
// Users who follow those sports elsewhere can favorite the channel that
// airs them directly — see the "Live on your favorite channels" section.
export type SportKey = 'football' | 'f1'

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
  // Team fixtures (football/tennis) have home/away; single-entrant events
  // (F1 sessions, golf rounds, UFC cards) only have `title`.
  title: string
  homeTeam?: string
  awayTeam?: string
  homeBadge?: string
  awayBadge?: string
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
  broadcasts?: { name: string; country: string | null }[]
}
