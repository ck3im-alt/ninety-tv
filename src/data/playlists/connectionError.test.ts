// The fallback policy and the failure classification, tested directly.
// connectPlaylist.test.ts proves the flow uses these; this proves the rules
// themselves are the ones we meant to write — especially the negative ones,
// which a flow test can only demonstrate one example of at a time.
import { describe, expect, it } from 'vitest'
import { ConnectionError, allowsM3uFallback, combineConnectFailures, toConnectionError } from './connectionError'
import { EmptyPlaylistError } from './connectPlaylist'
import { XtreamError } from '../xtream/xtreamClient'
import { HttpStatusError, NetworkUnreachableError } from '../../core/net/devCorsProxy'
import { RequestTimeoutError } from '../../core/net/fetchWithTimeout'

describe('toConnectionError', () => {
  it('maps every XtreamError code onto a connection category', () => {
    const mapped = (code: XtreamError['code']) => toConnectionError(new XtreamError(code, 'x')).code
    expect(mapped('AUTH_FAILED')).toBe('AUTH_FAILED')
    expect(mapped('NETWORK')).toBe('UNREACHABLE')
    expect(mapped('TIMEOUT')).toBe('TIMEOUT')
    expect(mapped('MALFORMED_RESPONSE')).toBe('UNSUPPORTED_RESPONSE')
    expect(mapped('HTTP_ERROR')).toBe('PROVIDER_ERROR')
    expect(mapped('EMPTY_PLAYLIST')).toBe('EMPTY_PLAYLIST')
  })

  it('carries the HTTP status across, so a later attempt can weigh it', () => {
    expect(toConnectionError(new XtreamError('HTTP_ERROR', 'x', 513)).status).toBe(513)
    expect(toConnectionError(new HttpStatusError(884, '')).status).toBe(884)
  })

  it('reads a bare HTTP status the same way the Xtream client does', () => {
    expect(toConnectionError(new HttpStatusError(401, '')).code).toBe('AUTH_FAILED')
    expect(toConnectionError(new HttpStatusError(403, '')).code).toBe('AUTH_FAILED')
    expect(toConnectionError(new HttpStatusError(500, '')).code).toBe('PROVIDER_ERROR')
    expect(toConnectionError(new HttpStatusError(884, '')).code).toBe('PROVIDER_ERROR')
  })

  it('lets an auth marker in the body override an uninformative status', () => {
    expect(toConnectionError(new HttpStatusError(456, 'Invalid credentials')).code).toBe('AUTH_FAILED')
    expect(toConnectionError(new HttpStatusError(200, '{"user_info":{"auth":0}}')).code).toBe('AUTH_FAILED')
    expect(toConnectionError(new HttpStatusError(456, 'Server is temporarily unavailable')).code).toBe('PROVIDER_ERROR')
  })

  it('separates "nobody answered" from "the answer was an error"', () => {
    expect(toConnectionError(new NetworkUnreachableError('TypeError: Failed to fetch', false)).code).toBe('UNREACHABLE')
    expect(toConnectionError(new RequestTimeoutError(12_000)).code).toBe('TIMEOUT')
  })

  it('recognizes EmptyPlaylistError without importing it back', () => {
    expect(toConnectionError(new EmptyPlaylistError()).code).toBe('EMPTY_PLAYLIST')
  })

  it('treats an unrecognized failure as an unusable response, not an unreachable host', () => {
    // Almost always a parse failure — we got bytes, they just weren't a
    // playlist. Calling that "could not reach the server" sends the user to
    // check their network for no reason.
    expect(toConnectionError(new SyntaxError('Unexpected token <')).code).toBe('UNSUPPORTED_RESPONSE')
  })

  it('passes an existing ConnectionError through unchanged', () => {
    const original = new ConnectionError('AUTH_FAILED', 401)
    expect(toConnectionError(original)).toBe(original)
  })

  it('never puts technical detail in the user-facing message', () => {
    const err = toConnectionError(new NetworkUnreachableError('TypeError: Failed to fetch https://u:p@host', true))
    expect(err.message).toBe('Could not reach the provider server')
    expect(err.detail).toContain('TypeError')
  })
})

describe('allowsM3uFallback', () => {
  it('allows exactly the categories that say nothing about the M3U export', () => {
    expect(allowsM3uFallback(new ConnectionError('PROVIDER_ERROR'))).toBe(true)
    expect(allowsM3uFallback(new ConnectionError('UNSUPPORTED_RESPONSE'))).toBe(true)
    expect(allowsM3uFallback(new ConnectionError('EMPTY_PLAYLIST'))).toBe(true)
  })

  it('refuses to retry a host that never answered, or credentials already refused', () => {
    expect(allowsM3uFallback(new ConnectionError('UNREACHABLE'))).toBe(false)
    expect(allowsM3uFallback(new ConnectionError('TIMEOUT'))).toBe(false)
    expect(allowsM3uFallback(new ConnectionError('AUTH_FAILED'))).toBe(false)
  })
})

describe('combineConnectFailures', () => {
  it('treats two non-standard statuses from one live host as rejected credentials', () => {
    const combined = combineConnectFailures(new ConnectionError('PROVIDER_ERROR', 513), new ConnectionError('PROVIDER_ERROR', 884))
    expect(combined.code).toBe('AUTH_FAILED')
    expect(combined.message).toBe('Incorrect username or password')
  })

  it('does not do that for assigned server-failure statuses', () => {
    // The distinction the whole rule rests on: 500/502/503 are how a server
    // reports its own outage, so two of them are an outage, not a login.
    for (const [api, m3u] of [[500, 500], [502, 503], [503, 500]] as const) {
      expect(combineConnectFailures(new ConnectionError('PROVIDER_ERROR', api), new ConnectionError('PROVIDER_ERROR', m3u)).code)
        .toBe('PROVIDER_ERROR')
    }
  })

  it('does not do that when only one side is non-standard', () => {
    expect(combineConnectFailures(new ConnectionError('PROVIDER_ERROR', 513), new ConnectionError('PROVIDER_ERROR', 500)).code)
      .toBe('PROVIDER_ERROR')
    expect(combineConnectFailures(new ConnectionError('PROVIDER_ERROR', 404), new ConnectionError('PROVIDER_ERROR', 884)).code)
      .toBe('PROVIDER_ERROR')
  })

  it('does not do that when a status is missing on either side', () => {
    expect(combineConnectFailures(new ConnectionError('UNSUPPORTED_RESPONSE'), new ConnectionError('PROVIDER_ERROR', 884)).code)
      .toBe('UNSUPPORTED_RESPONSE')
  })

  it('takes an explicit auth verdict from either attempt', () => {
    expect(combineConnectFailures(new ConnectionError('AUTH_FAILED', 401), new ConnectionError('PROVIDER_ERROR', 500)).code)
      .toBe('AUTH_FAILED')
    expect(combineConnectFailures(new ConnectionError('PROVIDER_ERROR', 500), new ConnectionError('AUTH_FAILED', 401)).code)
      .toBe('AUTH_FAILED')
  })

  it('lets a network verdict from the second attempt outrank the first', () => {
    expect(combineConnectFailures(new ConnectionError('PROVIDER_ERROR', 500), new ConnectionError('UNREACHABLE')).code)
      .toBe('UNREACHABLE')
    expect(combineConnectFailures(new ConnectionError('PROVIDER_ERROR', 500), new ConnectionError('TIMEOUT')).code)
      .toBe('TIMEOUT')
  })

  it('prefers the more specific "we got a playlist, it was unusable" answer', () => {
    expect(combineConnectFailures(new ConnectionError('PROVIDER_ERROR', 500), new ConnectionError('EMPTY_PLAYLIST')).code)
      .toBe('EMPTY_PLAYLIST')
    expect(combineConnectFailures(new ConnectionError('PROVIDER_ERROR', 500), new ConnectionError('UNSUPPORTED_RESPONSE')).code)
      .toBe('UNSUPPORTED_RESPONSE')
  })

  it('otherwise stands by the primary attempt', () => {
    expect(combineConnectFailures(new ConnectionError('UNSUPPORTED_RESPONSE'), new ConnectionError('PROVIDER_ERROR', 500)).code)
      .toBe('UNSUPPORTED_RESPONSE')
  })
})
