// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDevicePurchaseSession,
  fetchDeviceEntitlement,
  loadDeviceCredential,
  saveDeviceCredential,
} from './deviceCredential'

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
}) as Response

beforeEach(() => {
  localStorage.clear()
  vi.stubEnv('VITE_NINETY_API_URL', 'https://api.example')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('device credential API', () => {
  it('persists the credential before notifying listeners', () => {
    const listener = vi.fn(() => expect(loadDeviceCredential()).toBe('private-credential'))
    window.addEventListener('ninety:device-credential-changed', listener, { once: true })
    expect(saveDeviceCredential('private-credential')).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('maps a rejected credential separately from an expired entitlement', async () => {
    saveDeviceCredential('private-credential')
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'invalid device credential' }, 401))
    await expect(fetchDeviceEntitlement()).resolves.toMatchObject({ active: false, reason: 'invalid_device_credential' })
  })

  it('requests the exact server-provided purchase URL using bearer auth', async () => {
    saveDeviceCredential('private-credential')
    const session = { activationUrl: 'https://ninety.tv/continue/random-token', expiresAt: '2030-01-01T00:00:00Z' }
    vi.mocked(fetch).mockResolvedValue(jsonResponse(session, 201))

    await expect(createDevicePurchaseSession()).resolves.toEqual(session)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.example/api/device/purchase-session')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer private-credential' })
    expect(String(url)).not.toContain('private-credential')
  })
})
