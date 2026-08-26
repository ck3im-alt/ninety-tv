// @vitest-environment jsdom
//
// The search field's request gate. ninety-api's /v1/teams answers a
// one-character `q` with a 400, so the first letter the viewer types must
// resolve to 'idle' — not 'loading', and above all not 'error'. Typing is
// not a mistake worth reporting back to them.
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTeamSearch } from './useTeamSearch'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ teams: [{ id: 't1', name: 'Manchester United' }] })))
  vi.stubEnv('VITE_NINETY_API_URL', 'https://api.example')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useTeamSearch', () => {
  it('stays idle with nothing typed', () => {
    const { result } = renderHook(() => useTeamSearch(''))
    expect(result.current.status).toBe('idle')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('stays idle for a single character instead of firing a request the backend would reject', () => {
    const { result } = renderHook(() => useTeamSearch('m'))
    expect(result.current.status).toBe('idle')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('never reports an error just because the query is too short', () => {
    const { result } = renderHook(() => useTeamSearch(' m '))
    expect(result.current.status).not.toBe('error')
    expect(result.current.status).not.toBe('loading')
  })

  it('searches once the query reaches two characters, and sends it as q=', async () => {
    const { result } = renderHook(() => useTeamSearch('manchester'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current).toEqual({ status: 'ready', teams: [expect.objectContaining({ name: 'Manchester United' })] })
    const query = new URLSearchParams((vi.mocked(fetch).mock.calls[0][0] as string).split('?')[1])
    expect(query.get('q')).toBe('manchester')
    expect(query.has('search')).toBe(false)
  })

  // Following teams is optional, and a backend without the route is a fact
  // about the deployment rather than a failure — see teamCatalog.ts.
  it('reports a missing /v1/teams route as unavailable, not as an error', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 404))
    const { result } = renderHook(() => useTeamSearch('manchester'))
    await waitFor(() => expect(result.current.status).toBe('unavailable'))
  })
})
