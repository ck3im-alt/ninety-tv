// Client for Ninety's own backend (../ninety-api), which resolves canonical
// sports events to real linear TV channels via EPG matching — replaces
// Sportmonks entirely (both fixture listings AND broadcaster data) as of
// 2026-08-17. See NINETY_DATA_QUALITY_EPG_BLUEPRINT.md for the full
// architecture.
//
// Unlike Sportmonks/Xtream panels, this is Ninety's own server and sends
// proper CORS headers — no dev-proxy fallback needed here, direct fetch
// works both in `vite dev` and the packaged Tizen widget.

import { fetchWithTimeout } from '../../core/net/fetchWithTimeout'
import type { TeamFormResult } from './types'
import type { BroadcastAvailability } from './broadcastAvailability'

// Read lazily (not as a module-level const) so `vi.stubEnv` in tests can
// override it per-test -- a top-level const freezes whatever
// VITE_NINETY_API_URL was at first import, before any test's beforeEach
// runs, which made this module's tests pass only on a machine that happens
// to have a local .env and fail everywhere else (CI runs `npm test` without
// one). Production behaviour is identical: Vite statically replaces
// import.meta.env.VITE_NINETY_API_URL at build time either way.
function getBaseUrl(): string | undefined {
  return import.meta.env.VITE_NINETY_API_URL as string | undefined
}

// Carries the HTTP status alongside the message so a caller can tell
// "this deployment does not have that endpoint yet" (404) from "the request
// failed" (anything else) — which matters while ninety-tv and ninety-api
// are being extended in parallel: the TV must degrade to a recoverable
// empty state against an older backend, not show a network error. Extends
// Error so every existing `err instanceof Error ? err.message : ...`
// handler keeps working unchanged.
export class NinetyApiError extends Error {
  readonly status: number
  constructor(path: string, status: number) {
    super(`ninety-api ${path} failed: ${status}`)
    this.name = 'NinetyApiError'
    this.status = status
  }
}

// True when the failure was specifically "this backend build doesn't serve
// that route" — the one case a caller should treat as a missing FEATURE
// rather than an error worth showing.
export function isEndpointUnavailable(err: unknown): boolean {
  return err instanceof NinetyApiError && (err.status === 404 || err.status === 501)
}

// Bounded, because Home, Schedule and Event Details all block their first
// paint on one of these. A backend that accepts the connection and then
// never answers (a cold Railway container, a dead middlebox holding the
// socket open) would otherwise leave the TV on a loading state with no
// timeout and no way back — see core/net/fetchWithTimeout.ts. A
// RequestTimeoutError propagates to the caller unchanged, so every existing
// `catch` still sees an Error; callers that keep a cache decide for
// themselves whether to discard it (they do not — see useHomeFeed).
async function getJson<T>(path: string): Promise<T> {
  const baseUrl = getBaseUrl()
  if (!baseUrl) throw new Error('VITE_NINETY_API_URL is not set (see .env.example)')
  const res = await fetchWithTimeout(`${baseUrl}${path}`)
  if (!res.ok) throw new NinetyApiError(path, res.status)
  return (await res.json()) as T
}

export interface NinetyBroadcast {
  logical_channel_id: string
  name: string
  country: string | null
  confidence: number
  classification: 'CONFIRMED' | 'PROBABLE' | 'AMBIGUOUS' | 'UNKNOWN' | 'REJECTED'
  broadcast_type: 'LINEAR' | 'STREAMING' | 'BOTH' | 'UNKNOWN'
}

export interface NinetyEvent {
  id: string
  start_time_utc: string
  // 'scheduled' | 'live' | 'halftime' | 'complete' | 'cancelled' |
  // 'postponed' | 'abandoned' (ninety-api's eventStatus.ts) -- kept fresh
  // by ninety-api's live-score poller while a match is in play, not just
  // at fixture-ingestion time. See mapEvent.ts's mapNinetyEvent for how
  // this drives SportEvent.isLive/status.
  status: string | null
  // Null until the match has actually kicked off; once live, both update
  // roughly every 60s for as long as any client is polling (see
  // ninety-api's liveScoreScheduler.ts).
  home_score: number | null
  away_score: number | null
  round_code: string | null
  competition_id: string | null
  competition_name: string | null
  home_team_name: string | null
  home_team_logo: string | null
  home_team_form: TeamFormResult[] | null
  away_team_name: string | null
  away_team_logo: string | null
  away_team_form: TeamFormResult[] | null
  venue_name: string | null
  broadcasts: NinetyBroadcast[]
  // --- Personalization block (ninety-api 2026-08-26 onwards) ---
  //
  // Declared `?:` rather than `| null` on purpose: these are ABSENT, not
  // null, from any deployment predating them, and ninety-tv is expected to
  // run against exactly that while the two repos are extended in parallel.
  // `| null` is included too because a present-but-unknown value (a team
  // with no domestic league on record) is genuinely null in the payload.
  // See mapEvent.ts's mapNinetyEvent for the normalization, and
  // types.ts's SportEvent for what each one means.
  home_team_id?: string | null
  away_team_id?: string | null
  home_team_domestic_competition_id?: string | null
  away_team_domestic_competition_id?: string | null
  home_team_prominence?: number | null
  away_team_prominence?: number | null
  rivalry_importance?: number | null
  // Sent by the same backend commit, and DELIBERATELY not mapped onto
  // SportEvent or fed into ranking. A raw league position does not model
  // sporting stakes: "1st" is only interesting next to who else is close,
  // how many games are left, and what is being fought over. Prominence
  // (how big a club is) and position (how it is doing right now) are kept
  // as separate concepts precisely so a future title-race / relegation /
  // qualification calculation can use this properly. Declared here so the
  // payload is documented in one place — not so it can be scored.
  home_team_table_position?: number | null
  away_team_table_position?: number | null
  // --- Objective broadcast availability (ninety-api 2026-08-26 onwards) ---
  //
  // "Is this fixture expected to be on TV anywhere?", answered server-side
  // out of evidence the TV has no access to. Optional for the same reason
  // as the block above and one more: this build is expected to ship BEFORE
  // the backend half does, so absent is the normal case for a while. Absent
  // means UNKNOWN — never "not broadcast". Typed as the shared union but
  // read through normalizeBroadcastAvailability (broadcastAvailability.ts),
  // which also catches a value this build has never heard of; the union is
  // documentation of today's vocabulary, not a runtime guarantee.
  //
  // `broadcast_availability_reason` is a short backend-authored explanation
  // ("no listings found in any tracked market"), for diagnostics and at most
  // a subdued line in Event Details — never parsed, never a ranking input.
  broadcast_availability?: BroadcastAvailability | null
  broadcast_availability_reason?: string | null
}

export interface NinetyExternalChannelId {
  source_id: string
  source_channel_id: string
}

export interface NinetyLogicalChannel {
  id: string
  name: string
  country: string | null
  broadcast_type: 'LINEAR' | 'STREAMING' | 'BOTH' | 'UNKNOWN'
  network_name: string | null
  channel_number: string | null
  channel_variant: string | null
  aliases: string[]
  external_ids: NinetyExternalChannelId[]
  source_names: string[]
}

export interface NinetyEventsPagination {
  has_more: boolean
  next_cursor: string | null
}

export interface GetEventsParams {
  date?: string
  // A viewer's ranked preferred broadcast markets (ISO2-ish codes, e.g.
  // 'NO' or ['NO', 'SE', 'GB']) -- see data/sports/viewerMarket.ts for how
  // these are derived from favoriteCountries. This ONLY narrows which
  // resolved channels appear in each event's `broadcasts` array; it never
  // removes events from the result (ninety-api's /v1/events country filter
  // is broadcast-narrowing only, not event-eligibility -- see Phase 2B).
  // Same single-or-several convention as competitionId below.
  country?: string | string[]
  // Accepts a single id or several (e.g. useHomeFeed.ts narrowing to just
  // the leagues a user follows, out of Ninety's full 50-competition
  // catalog) -- ninety-api's /v1/events takes a comma-separated
  // competition_id for the multi case. OMITTED entirely means "every
  // tracked competition", which is what useScheduleDay.ts relies on.
  competitionId?: string | string[]
  from?: string
  to?: string
  limit?: number
  cursor?: string
}

// Omitting `date`/`from`/`to` returns a rolling upcoming window (see
// ninety-api's events route) rather than requiring a per-day loop like the
// old Sportmonks integration did.
export async function getEvents(params: GetEventsParams = {}) {
  const query = new URLSearchParams()
  if (params.date) query.set('date', params.date)
  if (params.country) {
    const value = Array.isArray(params.country) ? params.country.join(',') : params.country
    if (value) query.set('country', value)
  }
  if (params.competitionId) {
    const value = Array.isArray(params.competitionId) ? params.competitionId.join(',') : params.competitionId
    if (value) query.set('competition_id', value)
  }
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (params.limit != null) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const qs = query.toString()
  return getJson<{ events: NinetyEvent[]; pagination: NinetyEventsPagination }>(
    `/v1/events${qs ? `?${qs}` : ''}`,
  )
}

// Fetches every page of GET /v1/events for the given filters, following
// next_cursor until has_more is false. Use this instead of a bare getEvents
// call whenever the result set might legitimately exceed one page (e.g. no
// competition_id filter) -- a single getEvents call is only safe to treat
// as "the whole feed" when the caller knows the filtered result is small.
export async function getAllEvents(params: GetEventsParams = {}): Promise<NinetyEvent[]> {
  const events: NinetyEvent[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await getEvents({ ...params, cursor })
    events.push(...page.events)
    if (!page.pagination.has_more || !page.pagination.next_cursor) break
    cursor = page.pagination.next_cursor
  }
  return events
}

export async function getChannelCatalog(params: { country?: string } = {}) {
  const query = new URLSearchParams()
  if (params.country) query.set('country', params.country)
  const qs = query.toString()
  return getJson<{ version: string; channels: NinetyLogicalChannel[] }>(
    `/v1/channels/catalog${qs ? `?${qs}` : ''}`,
  )
}

// ninety-api's canonical competition registry (its sports/leagues.ts) --
// added 2026-08-20's Phase 1.1 audit to replace ninety-tv's own hand-
// duplicated 50-competition catalog with a single fetch from the backend.
// See data/sports/competitionsCatalog.ts for the caching/conversion layer
// built on top of this.
export interface NinetyCompetition {
  id: string
  name: string
  country_code: string | null
  region: string
  type: 'league' | 'cup' | 'qualification' | 'international'
  tier: 1 | 2 | 3
  badge_url: string
  footballdata_league_id: number
}

export async function getCompetitions() {
  return getJson<{ competitions: NinetyCompetition[] }>('/v1/competitions')
}

// ninety-api's canonical TEAM registry (GET /v1/teams), added alongside the
// events personalization block above so the TV can offer a real
// "teams you follow" picker keyed on canonical ids rather than names.
//
// This is ninety-api's CONFIRMED payload (its /v1/teams route, 2026-08-26):
// `id`, `name` and `prominence` are always sent, the remaining fields are
// sent as null when the backend has nothing on record. It was written
// against a spec that had not shipped yet, hence the two deprecated aliases
// at the bottom — the real contract never uses them, but a dev deployment
// predating the route's final shape can, and tolerating them costs
// teamCatalog.ts two `??`s rather than a picker full of blank rows.
export interface NinetyTeam {
  id: string
  name: string
  logo: string | null
  country_code: string | null
  // Which competition this club plays its league football in — the SAME id
  // space as NinetyCompetition.id / GET /v1/competitions (e.g.
  // 'football_premier_league', 'norway-eliteserien'), so it is compared
  // straight against a viewer's followed competitions with no normalization
  // or name matching. See homePersonalization.ts's hasDomesticAffinity.
  domestic_competition_id: string | null
  // Display name for the id above. Lets a club from outside the viewer's
  // followed leagues still be labelled with its real league instead of a
  // catch-all heading — see teamSuggestions.ts's groupTeamsByCompetition.
  domestic_competition_name: string | null
  // 0..1, ninety-api's club-prominence signal.
  prominence: number
  /** @deprecated Pre-release spelling of `name`; tolerated, never sent by a current backend. */
  canonical_name?: string | null
  /** @deprecated Pre-release spelling of `logo`; tolerated, never sent by a current backend. */
  logo_url?: string | null
}

export interface GetTeamsParams {
  // Single id or several, same comma-separated convention as
  // GetEventsParams.competitionId. Omitted means "no competition filter".
  competitionId?: string | string[]
  // Free-text lookup. Named `search` here because that is what it does;
  // it goes ON THE WIRE as `q`, which is the parameter ninety-api's route
  // actually parses — sending `search` means sending an unfiltered page
  // request, which the caller then has to filter locally and which can make
  // a club past the first page unreachable.
  //
  // The backend needs at least 2 characters (it 400s below that) and does
  // its own case/accent folding, prefix-before-substring ordering. Callers
  // gate on teamCatalog.ts's MIN_TEAM_SEARCH_LENGTH rather than firing a
  // request that is going to be rejected.
  search?: string
  // Backend default 100, max 500.
  limit?: number
}

export async function getTeams(params: GetTeamsParams = {}) {
  const query = new URLSearchParams()
  if (params.competitionId) {
    const value = Array.isArray(params.competitionId) ? params.competitionId.join(',') : params.competitionId
    if (value) query.set('competition_id', value)
  }
  if (params.search) query.set('q', params.search)
  if (params.limit != null) query.set('limit', String(params.limit))
  const qs = query.toString()
  return getJson<{ teams: NinetyTeam[] }>(`/v1/teams${qs ? `?${qs}` : ''}`)
}
