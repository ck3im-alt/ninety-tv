// One vocabulary for "why couldn't we connect to this playlist", and the
// rules that decide when a second attempt is worth making.
//
// WHY THIS EXISTS. The two ways into a provider fail in two different
// dialects: the Xtream JSON API throws XtreamError, and a plain M3U URL
// throws whatever the fetch layer produced (HttpStatusError,
// NetworkUnreachableError, RequestTimeoutError) plus connectPlaylist's own
// EmptyPlaylistError. Connecting a get.php URL now touches BOTH — the API
// first, the M3U export as a fallback — so their failures have to be
// comparable before anything can reason about them together.
//
// The categories below are the ones the app actually behaves differently
// about; they are not a mirror of HTTP. Which of them permit a fallback is
// stated once, in allowsM3uFallback, rather than left to a try/catch that
// swallows everything.
import { XtreamError } from '../xtream/xtreamClient'
import { HttpStatusError, NetworkUnreachableError } from '../../core/net/devCorsProxy'
import { RequestTimeoutError } from '../../core/net/fetchWithTimeout'
import { classifyHttpStatus, hasAuthRejectionMarker } from '../../core/net/authEvidence'

export type ConnectionErrorCode =
  // The provider looked at these credentials and refused them.
  | 'AUTH_FAILED'
  // Nothing answered: DNS failure, host down, refused, or CORS in a browser
  // tab. Retrying the same host a different way cannot help.
  | 'UNREACHABLE'
  // Something is there but did not answer inside our bound.
  | 'TIMEOUT'
  // The host answered, reporting a failure of its own.
  | 'PROVIDER_ERROR'
  // The host answered with something we cannot use as a playlist — HTML
  // where JSON was promised, an unparseable body, the wrong JSON shape.
  | 'UNSUPPORTED_RESPONSE'
  // The host answered correctly, with no channels in it.
  | 'EMPTY_PLAYLIST'

// User-facing wording. Credential-free and URL-free by construction — a
// failed connect must never put a get.php link or a password on screen.
const MESSAGES: Record<ConnectionErrorCode, string> = {
  AUTH_FAILED: 'Incorrect username or password',
  UNREACHABLE: 'Could not reach the provider server',
  TIMEOUT: 'Provider server did not respond',
  PROVIDER_ERROR: 'Provider server returned an error',
  UNSUPPORTED_RESPONSE: 'Provider returned an unsupported response',
  EMPTY_PLAYLIST: 'No channels found in playlist',
}

export class ConnectionError extends Error {
  readonly code: ConnectionErrorCode
  // The HTTP status behind this failure, when there was one. Diagnostics
  // and cross-attempt reasoning only — never rendered.
  readonly status: number | null
  // Free-form technical detail, kept for the same reason: it is what makes
  // a dev-console report useful without any of it reaching the UI.
  readonly detail: string | null
  constructor(code: ConnectionErrorCode, status: number | null = null, detail: string | null = null) {
    super(MESSAGES[code])
    this.name = 'ConnectionError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

// Normalizes anything either connection path can throw.
//
// EmptyPlaylistError is matched by NAME rather than by instanceof,
// deliberately: it lives in connectPlaylist.ts, which imports this module,
// and reaching back for the class would close an import cycle for no gain.
// The name check is also what survives the `vi.mock(..., actual)` partial
// mocks the sync-coordinator tests build.
export function toConnectionError(err: unknown): ConnectionError {
  if (err instanceof ConnectionError) return err

  if (err instanceof XtreamError) {
    return new ConnectionError(fromXtreamCode(err.code), err.status, `${err.name}(${err.code})`)
  }

  if (err instanceof HttpStatusError) {
    // The plain-M3U path has no client of its own to interpret a status, so
    // it gets the same evidence treatment the Xtream client applies.
    if (classifyHttpStatus(err.status) === 'auth-rejected' || hasAuthRejectionMarker(err.body)) {
      return new ConnectionError('AUTH_FAILED', err.status, 'HttpStatusError')
    }
    return new ConnectionError('PROVIDER_ERROR', err.status, 'HttpStatusError')
  }

  if (err instanceof NetworkUnreachableError) return new ConnectionError('UNREACHABLE', null, err.detail)
  if (err instanceof RequestTimeoutError) return new ConnectionError('TIMEOUT', null, err.message)
  if (err instanceof Error && err.name === 'EmptyPlaylistError') {
    return new ConnectionError('EMPTY_PLAYLIST', null, err.name)
  }
  if (err instanceof Error && err.name === 'AbortError') return new ConnectionError('TIMEOUT', null, err.name)

  // Anything else got far enough to hand us bytes we could not turn into a
  // playlist — a parse failure, most often. "Unreachable" would be a lie.
  return new ConnectionError('UNSUPPORTED_RESPONSE', null, err instanceof Error ? `${err.name}: ${err.message}` : String(err))
}

function fromXtreamCode(code: XtreamError['code']): ConnectionErrorCode {
  switch (code) {
    case 'AUTH_FAILED':
      return 'AUTH_FAILED'
    case 'NETWORK':
      return 'UNREACHABLE'
    case 'TIMEOUT':
      return 'TIMEOUT'
    case 'MALFORMED_RESPONSE':
      return 'UNSUPPORTED_RESPONSE'
    case 'EMPTY_PLAYLIST':
      return 'EMPTY_PLAYLIST'
    case 'HTTP_ERROR':
      return 'PROVIDER_ERROR'
  }
}

// Whether a failed Xtream API attempt justifies re-trying the SAME url as a
// plain M3U playlist.
//
// Yes, for the three categories that all mean "player_api.php was not
// usable here" while saying nothing about whether get.php is:
//
//   PROVIDER_ERROR       the panel refused the API call — including the
//                        unassigned statuses some panels use for a rejected
//                        login, which the M3U attempt is exactly what
//                        resolves (see combineConnectFailures).
//   UNSUPPORTED_RESPONSE the endpoint answered with something that is not
//                        the Xtream API at all. A reverse proxy that only
//                        publishes get.php lands here.
//   EMPTY_PLAYLIST       the API reported zero live streams. Panels exist
//                        whose API is unpopulated while their M3U export is
//                        complete.
//
// No, for the three that would make the second request pointless or
// misleading:
//
//   UNREACHABLE  the M3U lives on the same host that just failed to resolve
//                or refused the connection. A second request buys nothing
//                and doubles the wait.
//   TIMEOUT      likewise, and the viewer has already waited the full bound
//                once.
//   AUTH_FAILED  the panel stated plainly that the credentials are wrong —
//                401/403, or an auth marker in the body. That is the
//                "strong evidence" case: there is nothing left to confirm,
//                and asking again with the same rejected credentials would
//                only delay telling the user so.
export function allowsM3uFallback(err: ConnectionError): boolean {
  return err.code === 'PROVIDER_ERROR' || err.code === 'UNSUPPORTED_RESPONSE' || err.code === 'EMPTY_PLAYLIST'
}

// The verdict once BOTH the Xtream API and the M3U export have failed.
//
// This is where the 513/884 panel finally gets classified. Neither status
// proves anything alone — but two different endpoints on a host that is
// plainly up, both answering the same credentials with a code no
// conforming server emits, is a rejected login and not an outage. An outage
// answers 500/502/503 from both; an unimplemented endpoint answers 404. So
// the rule is stated over the EVIDENCE, never over the specific numbers.
export function combineConnectFailures(api: ConnectionError, m3u: ConnectionError): ConnectionError {
  // Either side stating it outright settles it. In practice this is the M3U
  // side: an api AUTH_FAILED would not have been allowed to fall back.
  if (api.code === 'AUTH_FAILED') return api
  if (m3u.code === 'AUTH_FAILED') return m3u

  if (bothStatusesNonStandard(api, m3u)) {
    return new ConnectionError('AUTH_FAILED', m3u.status, `api ${api.status} + m3u ${m3u.status} both non-standard`)
  }

  // A network verdict from the second attempt outranks the first: if the
  // M3U request could not reach the host at all, "the provider returned an
  // error" is no longer the useful thing to say.
  if (m3u.code === 'UNREACHABLE' || m3u.code === 'TIMEOUT') return m3u

  // We did get a playlist, it just wasn't usable — more specific than
  // whatever the API said, so it wins.
  if (m3u.code === 'EMPTY_PLAYLIST' || m3u.code === 'UNSUPPORTED_RESPONSE') return m3u

  // Otherwise the primary attempt's failure stands.
  return api
}

function bothStatusesNonStandard(api: ConnectionError, m3u: ConnectionError): boolean {
  if (api.status === null || m3u.status === null) return false
  return classifyHttpStatus(api.status) === 'non-standard' && classifyHttpStatus(m3u.status) === 'non-standard'
}
