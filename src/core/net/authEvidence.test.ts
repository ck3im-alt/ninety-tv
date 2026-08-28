import { describe, expect, it } from 'vitest'
import { classifyHttpStatus, hasAuthRejectionMarker } from './authEvidence'

describe('classifyHttpStatus', () => {
  it('recognizes the spec\'s own way of refusing credentials', () => {
    expect(classifyHttpStatus(401)).toBe('auth-rejected')
    expect(classifyHttpStatus(403)).toBe('auth-rejected')
  })

  it('recognizes every assigned 5xx as the server reporting its own failure', () => {
    for (const status of [500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511]) {
      expect(classifyHttpStatus(status)).toBe('server-failure')
    }
  })

  it('flags unassigned 5xx and out-of-range codes as non-standard', () => {
    // The two measured on a real panel, plus the boundaries around them.
    expect(classifyHttpStatus(513)).toBe('non-standard')
    expect(classifyHttpStatus(884)).toBe('non-standard')
    expect(classifyHttpStatus(509)).toBe('non-standard')
    expect(classifyHttpStatus(512)).toBe('non-standard')
    expect(classifyHttpStatus(599)).toBe('non-standard')
    expect(classifyHttpStatus(600)).toBe('non-standard')
    expect(classifyHttpStatus(0)).toBe('non-standard')
  })

  it('leaves ordinary client-side codes uncommitted', () => {
    // 404 in particular: "this panel has no player_api.php" is a real and
    // common answer, and it is neither a login failure nor an outage.
    for (const status of [400, 404, 405, 410, 429, 200, 301]) {
      expect(classifyHttpStatus(status)).toBe('other')
    }
  })
})

describe('hasAuthRejectionMarker', () => {
  it('reads the structured flag panels bury in JSON, string or number', () => {
    expect(hasAuthRejectionMarker('{"user_info":{"auth":0,"status":"Disabled"}}')).toBe(true)
    expect(hasAuthRejectionMarker('{"user_info":{"auth":"0"}}')).toBe(true)
    expect(hasAuthRejectionMarker('{"auth":0}')).toBe(true)
  })

  it('does not fire on a healthy account', () => {
    expect(hasAuthRejectionMarker('{"user_info":{"auth":1,"status":"Active"}}')).toBe(false)
  })

  it('reads an explicit statement about credentials out of prose', () => {
    for (const body of [
      'Invalid username or password',
      'incorrect password',
      'Wrong credentials',
      'Authentication failed',
      'Unauthorized',
      'Access denied',
      '<html><body>Login failed</body></html>',
    ]) {
      expect(hasAuthRejectionMarker(body)).toBe(true)
    }
  })

  it('does not read a generic failure as a statement about credentials', () => {
    // The whole point of being narrow: none of these say the password is
    // wrong, and guessing that they do is worse than saying nothing.
    for (const body of [
      '',
      'Service temporarily unavailable',
      'Internal Server Error',
      'Bad Gateway',
      'stream not found',
      '{"message":"maintenance in progress"}',
    ]) {
      expect(hasAuthRejectionMarker(body)).toBe(false)
    }
  })

  it('still finds a prose message inside a JSON body that has no auth flag', () => {
    expect(hasAuthRejectionMarker('{"error":"Invalid credentials"}')).toBe(true)
  })
})
