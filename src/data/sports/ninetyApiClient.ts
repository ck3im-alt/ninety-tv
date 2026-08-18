// Client for Ninety's own backend (../ninety-api), which resolves canonical
// sports events to real linear TV channels via EPG matching — replaces
// Sportmonks entirely (both fixture listings AND broadcaster data) as of
// 2026-08-17. See NINETY_DATA_QUALITY_EPG_BLUEPRINT.md for the full
// architecture.
//
// Unlike Sportmonks/Xtream panels, this is Ninety's own server and sends
// proper CORS headers — no dev-proxy fallback needed here, direct fetch
// works both in `vite dev` and the packaged Tizen widget.

const BASE_URL = import.meta.env.VITE_NINETY_API_URL as string | undefined

async function getJson<T>(path: string): Promise<T> {
  if (!BASE_URL) throw new Error('VITE_NINETY_API_URL is not set (see .env.example)')
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) throw new Error(`ninety-api ${path} failed: ${res.status}`)
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
  status: string | null
  round_code: string | null
  competition_name: string | null
  home_team_name: string | null
  home_team_logo: string | null
  away_team_name: string | null
  away_team_logo: string | null
  broadcasts: NinetyBroadcast[]
}

export interface NinetyLogicalChannel {
  id: string
  name: string
  country: string | null
  broadcast_type: 'LINEAR' | 'STREAMING' | 'BOTH' | 'UNKNOWN'
}

// Omitting `date` returns a rolling upcoming window (see ninety-api's
// events route) rather than requiring a per-day loop like the old
// Sportmonks integration did.
export async function getEvents(params: { date?: string; country?: string } = {}) {
  const query = new URLSearchParams()
  if (params.date) query.set('date', params.date)
  if (params.country) query.set('country', params.country)
  const qs = query.toString()
  return getJson<{ events: NinetyEvent[] }>(`/v1/events${qs ? `?${qs}` : ''}`)
}

export async function getChannelCatalog(params: { country?: string } = {}) {
  const query = new URLSearchParams()
  if (params.country) query.set('country', params.country)
  const qs = query.toString()
  return getJson<{ version: string; channels: NinetyLogicalChannel[] }>(
    `/v1/channels/catalog${qs ? `?${qs}` : ''}`,
  )
}
