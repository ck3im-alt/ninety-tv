// Client for Ninety's own backend (../ninety-api), which resolves canonical
// sports events to real linear TV channels via EPG matching — replaces
// Sportmonks entirely (both fixture listings AND broadcaster data) as of
// 2026-08-17. See NINETY_DATA_QUALITY_EPG_BLUEPRINT.md for the full
// architecture.
//
// Unlike Sportmonks/Xtream panels, this is Ninety's own server and sends
// proper CORS headers — no dev-proxy fallback needed here, direct fetch
// works both in `vite dev` and the packaged Tizen widget.

import type { TeamFormResult } from './types'

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

async function getJson<T>(path: string): Promise<T> {
  const baseUrl = getBaseUrl()
  if (!baseUrl) throw new Error('VITE_NINETY_API_URL is not set (see .env.example)')
  const res = await fetch(`${baseUrl}${path}`)
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
  // tracked competition", which is what useTodaysSchedule.ts relies on.
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
// Every field except `id` is optional here, and the naming is deliberately
// permissive (`name` OR `canonical_name`, `logo_url` OR `logo`): this
// endpoint is being built in the other repo at the same time as this
// client, so the mapping in teamCatalog.ts accepts either spelling rather
// than hard-failing on a shape that turns out to differ by one word. The
// alternative — guessing wrong and shipping a picker that renders blank
// names — is much worse than a couple of extra `??`s.
export interface NinetyTeam {
  id: string
  name?: string | null
  canonical_name?: string | null
  logo_url?: string | null
  logo?: string | null
  country_code?: string | null
  // Which competition this club plays its league football in — the same id
  // space as NinetyCompetition.id, so it can be compared straight against a
  // user's followed competitions.
  domestic_competition_id?: string | null
  prominence?: number | null
}

export interface GetTeamsParams {
  // Single id or several, same comma-separated convention as
  // GetEventsParams.competitionId. Omitted means "no competition filter".
  competitionId?: string | string[]
  // Free-text lookup, when the backend supports it. A backend that ignores
  // the parameter simply returns an unfiltered page, which the caller
  // filters locally — see teamCatalog.ts.
  search?: string
  limit?: number
}

export async function getTeams(params: GetTeamsParams = {}) {
  const query = new URLSearchParams()
  if (params.competitionId) {
    const value = Array.isArray(params.competitionId) ? params.competitionId.join(',') : params.competitionId
    if (value) query.set('competition_id', value)
  }
  if (params.search) query.set('search', params.search)
  if (params.limit != null) query.set('limit', String(params.limit))
  const qs = query.toString()
  return getJson<{ teams: NinetyTeam[] }>(`/v1/teams${qs ? `?${qs}` : ''}`)
}
