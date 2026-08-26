import type { RawSportsDbEvent } from './theSportsDbClient'
import type { NinetyEvent } from './ninetyApiClient'
import type { LeagueDef } from './leagues'
import type { SportEvent } from './types'
import { isHeuristicallyLive } from './liveHeuristic'
import { normalizeVenueName } from './humanText'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Last-resort background for any event with neither a league-level curated
// image (leagues.ts's staticBackground, e.g. Premier League/F1/golf) nor
// an API-provided one (TheSportsDB banners, sparse outside football;
// api-football's free tier has none at all) — user-provided generic
// "games" photo, replaces what used to fall through to a plain CSS
// gradient for e.g. Eredivisie/MLS/tennis/MMA/NBA fixtures.
const GENERAL_BACKGROUND = `${import.meta.env.BASE_URL}backgrounds/test_image.png`

function formatTimeLabel(dateTimeUtc: string | null): string {
  if (!dateTimeUtc) return ''
  const d = new Date(dateTimeUtc)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const hhmm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (isToday) return `Today ${hhmm}`
  return `${WEEKDAYS[d.getDay()]} ${hhmm}`
}

function timestampOf(ev: RawSportsDbEvent): string | null {
  if (ev.strTimestamp) return ev.strTimestamp.endsWith('Z') ? ev.strTimestamp : `${ev.strTimestamp}Z`
  if (ev.dateEvent && ev.strTime) return `${ev.dateEvent}T${ev.strTime}Z`
  return null
}

export function mapEvent(ev: RawSportsDbEvent, league: LeagueDef): SportEvent {
  const dateTimeUtc = timestampOf(ev)
  const isTeamFixture = Boolean(ev.strHomeTeam && ev.strAwayTeam)
  return {
    id: ev.idEvent,
    sportKey: league.sportKey,
    sportLabel: league.sportLabel,
    league: ev.strLeague,
    leagueId: league.id,
    leagueBadge: ev.strLeagueBadge ?? undefined,
    leagueTier: league.tier,
    title: isTeamFixture ? `${ev.strHomeTeam} vs ${ev.strAwayTeam}` : ev.strEvent,
    homeTeam: ev.strHomeTeam ?? undefined,
    awayTeam: ev.strAwayTeam ?? undefined,
    homeBadge: ev.strHomeTeamBadge ?? undefined,
    awayBadge: ev.strAwayTeamBadge ?? undefined,
    venue: normalizeVenueName(ev.strVenue),
    round: ev.intRound ?? undefined,
    dateTimeUtc,
    timeLabel: formatTimeLabel(dateTimeUtc),
    // A league-level curated background (currently just Premier League)
    // wins over whatever TheSportsDB provides per-event — otherwise prefer
    // a wide banner, falling back to thumb/poster, falling back to the
    // generic "games" photo so no fixture is left with only the plain CSS
    // gradient.
    backgroundUrl: league.staticBackground ?? ev.strBanner ?? ev.strThumb ?? ev.strPoster ?? GENERAL_BACKGROUND,
    isLive: false,
  }
}

// A 0..1 signal from the backend, or undefined when this deployment doesn't
// send it (or sends something unusable). UNDEFINED, never a substituted
// number: "we don't know how big this club is" and "this club scores 0.5"
// are different statements, and only the scorer (homePersonalization.ts)
// should decide what a missing signal is worth — encoding a fallback here
// would hide the difference from it. Non-finite values (a JSON null, a NaN
// from a broken backend computation) are treated as missing rather than
// propagated, so no score can ever become NaN downstream.
function unitSignal(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(1, Math.max(0, value))
}

// An id the backend may not send yet — '' and null both mean "absent" and
// must never become a matchable value (an empty-string team id would
// compare equal to another empty-string team id and invent a "same team"
// relationship out of two unknowns).
function optionalId(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

// ninety-api and TheSportsDB ids live in separate spaces — prefixed so a
// fixture from either provider can never collide as a React list key.
//
// As of 2026-08-24, ninety-api DOES have a real live match-state feed
// (its own liveScoreScheduler.ts polls footballdata.io's GET
// /fixtures/live) — status/home_score/away_score are real, server-tracked
// data, not a guess, so the time-window heuristic (liveHeuristic.ts) is
// only used as a defensive fallback for the (in practice essentially
// never, post-backfill) case of a null status. footballdata.io has no
// match-minute/clock field in any endpoint (confirmed live) — liveClock
// is only ever set to 'HT' for a halftime status, itself unconfirmed
// against a real payload (see ninety-api's liveScores.ts).
export function mapNinetyEvent(ev: NinetyEvent, league: LeagueDef): SportEvent {
  const title = ev.home_team_name && ev.away_team_name ? `${ev.home_team_name} vs ${ev.away_team_name}` : ev.competition_name ?? 'Match'
  const isLive =
    ev.status != null
      ? ev.status === 'live' || ev.status === 'halftime'
      : isHeuristicallyLive(league.sportKey, title, ev.start_time_utc)
  return {
    id: `ninety:${ev.id}`,
    sportKey: league.sportKey,
    sportLabel: league.sportLabel,
    league: ev.competition_name ?? league.sportLabel,
    leagueId: league.id,
    leagueBadge: league.badge,
    leagueTier: league.tier,
    title,
    homeTeam: ev.home_team_name ?? undefined,
    awayTeam: ev.away_team_name ?? undefined,
    homeBadge: ev.home_team_logo ?? undefined,
    awayBadge: ev.away_team_logo ?? undefined,
    homeForm: ev.home_team_form ?? undefined,
    awayForm: ev.away_team_form ?? undefined,
    // Every one of these is absent against a ninety-api deployment older
    // than 2026-08-26 — see NinetyEvent's own comment. They stay undefined
    // there, and homePersonalization.ts's neutral fallbacks keep Home
    // ranking correctly (just with fewer signals) rather than crashing.
    homeTeamId: optionalId(ev.home_team_id),
    awayTeamId: optionalId(ev.away_team_id),
    homeDomesticCompetitionId: optionalId(ev.home_team_domestic_competition_id),
    awayDomesticCompetitionId: optionalId(ev.away_team_domestic_competition_id),
    homeTeamProminence: unitSignal(ev.home_team_prominence),
    awayTeamProminence: unitSignal(ev.away_team_prominence),
    rivalryImportance: unitSignal(ev.rivalry_importance),
    venue: normalizeVenueName(ev.venue_name),
    round: ev.round_code ?? undefined,
    dateTimeUtc: ev.start_time_utc,
    timeLabel: formatTimeLabel(ev.start_time_utc),
    backgroundUrl: league.staticBackground ?? GENERAL_BACKGROUND,
    isLive,
    isLiveHeuristic: ev.status == null ? isLive : undefined,
    status: ev.status ?? undefined,
    homeScore: ev.home_score != null ? String(ev.home_score) : undefined,
    awayScore: ev.away_score != null ? String(ev.away_score) : undefined,
    liveClock: ev.status === 'halftime' ? 'HT' : undefined,
    // BOTH means the channel is available as linear AND streaming, so it
    // still counts as a valid linear-playlist match; STREAMING-only and
    // UNKNOWN do not.
    broadcasts: ev.broadcasts
      .filter((b) => b.broadcast_type === 'LINEAR' || b.broadcast_type === 'BOTH')
      .map((b) => ({
        logicalChannelId: b.logical_channel_id,
        name: b.name,
        country: b.country,
        confidence: b.confidence,
        classification: b.classification,
      })),
  }
}

