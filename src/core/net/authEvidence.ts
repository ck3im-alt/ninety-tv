// What an HTTP failure from an IPTV provider actually tells us — split
// into independent pieces of evidence, so no single one gets mistaken for
// proof.
//
// WHY THIS EXISTS. Xtream panels do not agree on how to say "wrong
// username or password". The spec-conforming answer is 401/403, and some
// panels send it. Others answer HTTP 200 with `auth: 0` buried in the body.
// And a third group — measured on a real panel while investigating a
// playlist that refused to connect — answers with a status code no
// conforming server would ever emit: 513 from player_api.php and 884 from
// get.php, both with empty bodies, for credentials the panel simply did not
// like.
//
// Treating "not 401/403" as "the provider's server is broken" turned that
// third group into "Provider server returned an error", which sends the
// viewer hunting for an outage instead of checking their password. But
// hardcoding 513/884 as AUTH_FAILED would be just as wrong: those numbers
// are not a protocol, they are one panel's habit, and the next panel may
// genuinely be failing when it sends one.
//
// So nothing here concludes anything on its own. This module reports what
// the status says and what the body says; the caller decides — sometimes
// only after a SECOND request has produced evidence of its own (see
// data/playlists/connectionError.ts's combineConnectFailures).

export type HttpStatusEvidence =
  // The spec's own way of saying "not with those credentials".
  | 'auth-rejected'
  // Assigned codes that mean the server is reporting its own failure. A
  // provider sending one of these is describing an outage, not a login.
  | 'server-failure'
  // A code outside the assigned set: an unassigned 5xx (513), or a number
  // outside the 1xx–5xx range altogether (884). On its own this proves
  // nothing — it only says this endpoint is not speaking HTTP by the book,
  // which is exactly what panels do when they obscure a rejected login.
  | 'non-standard'
  // Everything else: 404 (endpoint not implemented here), 400, 429, …
  | 'other'

const AUTH_STATUSES = new Set([401, 403])

// Every 5xx code IANA has actually assigned. Anything else in that range is
// a number someone made up, which is the whole distinction this file turns
// on — 500 and 503 are outage reports, 513 is not.
const ASSIGNED_SERVER_FAILURE_STATUSES = new Set([500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511])

export function classifyHttpStatus(status: number): HttpStatusEvidence {
  if (AUTH_STATUSES.has(status)) return 'auth-rejected'
  if (ASSIGNED_SERVER_FAILURE_STATUSES.has(status)) return 'server-failure'
  // Unassigned 5xx (513) and everything above the range (884) alike.
  if (status >= 500) return 'non-standard'
  if (status < 100) return 'non-standard'
  return 'other'
}

// Only ever read from a bounded sample — an error body is not trusted to be
// small, and nothing here needs more than the first couple of KB.
const BODY_SAMPLE_LIMIT = 2048

// Deliberately narrow. It must be an explicit statement ABOUT CREDENTIALS,
// not merely an error: a panel that says "temporarily unavailable" has not
// told us the password is wrong, and guessing that it did is the exact
// mistake this whole module exists to avoid.
const AUTH_PHRASE =
  /\b(?:invalid|incorrect|wrong|bad|failed)\s+(?:log[-\s]?in|user(?:name)?|pass(?:word)?|credentials?|auth\w*)\b|\b(?:unauthori[sz]ed|authentication\s+failed|log[-\s]?in\s+failed|access\s+denied)\b/i

// Whether a response body explicitly says the credentials were rejected.
// Works on both the JSON panels return from player_api.php and the plain
// text/HTML get.php tends to produce.
export function hasAuthRejectionMarker(body: string): boolean {
  if (!body) return false
  const sample = body.slice(0, BODY_SAMPLE_LIMIT)
  const parsed = tryParseJson(sample)
  // A JSON body can carry BOTH the structured flag and a prose message, and
  // panels are inconsistent about which they populate — so a parsed body
  // that has no `auth` flag still falls through to the phrase check rather
  // than being treated as a clean bill of health.
  if (parsed !== undefined && jsonSaysAuthRejected(parsed)) return true
  return AUTH_PHRASE.test(sample)
}

function tryParseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown
  } catch {
    return undefined
  }
}

function jsonSaysAuthRejected(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const record = data as Record<string, unknown>
  const userInfo = typeof record.user_info === 'object' && record.user_info !== null
    ? (record.user_info as Record<string, unknown>)
    : undefined
  // Panels stringify this field about as often as they don't.
  return isZeroFlag(record.auth) || isZeroFlag(userInfo?.auth)
}

function isZeroFlag(value: unknown): boolean {
  return value === 0 || value === '0'
}
