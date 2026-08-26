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
  // --- Personalization identity/metadata (football, ninety-api only) ---
  //
  // Every field in this block is OPTIONAL AND MAY BE ABSENT, and not just
  // "for other sports": ninety-api gained them in the same week ninety-tv
  // did, so a TV running this build against a not-yet-deployed backend sees
  // none of them. Nothing may assume they exist — see
  // homePersonalization.ts, where each has an explicit neutral fallback so
  // a pre-upgrade backend produces a valid, finite ranking rather than NaN
  // or a crash. When they ARE present the extra signals switch on with no
  // second code path.
  //
  // Canonical ninety-api team ids (teams.id) — the ONLY identity
  // SportPreferences.favoriteTeamIds is ever compared against. Never match
  // a favorite by homeTeam/awayTeam display name.
  homeTeamId?: string
  awayTeamId?: string
  // The competition each side plays its LEAGUE football in, which is
  // frequently NOT this event's own competition: Bodø/Glimt's domestic
  // competition is Eliteserien even when this fixture is a Champions
  // League tie. Canonical competition ids, comparable directly against
  // SportPreferences.footballLeagueIds — this is what lets "I follow
  // Eliteserien" surface a Norwegian club's European nights without the
  // user having to also follow the Champions League.
  homeDomesticCompetitionId?: string
  awayDomesticCompetitionId?: string
  // How big a club each side is, 0..1, server-computed and deliberately
  // NOT league-table position: a mid-table Manchester United is still one
  // of the biggest draws in the sport, and a runaway leader in a small
  // league is not. Feeds matchup prominence (see matchupProminence in
  // homePersonalization.ts).
  homeTeamProminence?: number
  awayTeamProminence?: number
  // How much of a rivalry/occasion this specific pairing is, 0..1 — a
  // derby or a Clásico scores here where the same two clubs' prominence
  // alone would not distinguish it from any other fixture they play.
  rivalryImportance?: number
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
  // this sport/provider — see liveHeuristic.ts), false/undefined when
  // it's a real status from ninety-api's live-score poller (football) or
  // an actual live feed (any future sport that gets one). Never render a
  // score/clock next to a heuristic-live event — there isn't one, only a
  // start-time guess.
  isLiveHeuristic?: boolean
  // Football's canonical lifecycle state from ninety-api (see
  // eventStatus.ts there) — 'scheduled' | 'live' | 'halftime' | 'complete'
  // | 'cancelled' | 'postponed' | 'abandoned'. Undefined for sports with
  // no real status feed (F1), which only ever have isLive/isLiveHeuristic.
  // isLive is derived from this (true for 'live'/'halftime') rather than
  // being a separate source of truth — see mapNinetyEvent.
  status?: string
  // Per-side scores (not a combined "2–1" string) so the UI can place
  // each next to its own team's row. Real football live data only.
  homeScore?: string
  awayScore?: string
  // Match clock/period — "67'", "2nd Set", "HT". Real football live data
  // only; heuristic-live events never get one (see isLiveHeuristic).
  // footballdata.io has no minute/clock field at all (confirmed live,
  // 2026-08-24) — the only value this is ever actually set to today is
  // 'HT' for status === 'halftime'.
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
