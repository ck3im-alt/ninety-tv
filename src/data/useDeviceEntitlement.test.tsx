// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeviceEntitlement } from './useDeviceEntitlement'

const { fetchDeviceEntitlement, loadDeviceCredential } = vi.hoisted(() => ({
  fetchDeviceEntitlement: vi.fn(),
  loadDeviceCredential: vi.fn(),
}))

vi.mock('./deviceCredential', () => ({ fetchDeviceEntitlement, loadDeviceCredential }))

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  loadDeviceCredential.mockReset().mockReturnValue('credential')
  fetchDeviceEntitlement.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useDeviceEntitlement', () => {
  it('auto-unlocks an inactive device with serialized polling', async () => {
    fetchDeviceEntitlement
      .mockResolvedValueOnce({ active: false, reason: 'inactive', accessEndsAt: null, serverNow: '2030-01-01T00:00:00Z' })
      .mockResolvedValueOnce({ active: true, reason: 'subscription', accessEndsAt: null, serverNow: '2030-01-01T00:00:07Z' })
    const { result } = renderHook(() => useDeviceEntitlement())
    await flush()
    expect(result.current.status).toBe('inactive')

    await act(async () => { await vi.advanceTimersByTimeAsync(7_000) })
    expect(fetchDeviceEntitlement).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('active')
  })

  it('does not classify an invalid credential as an expired trial', async () => {
    fetchDeviceEntitlement.mockResolvedValue({
      active: false,
      reason: 'invalid_device_credential',
      accessEndsAt: null,
      serverNow: '',
    })
    const { result } = renderHook(() => useDeviceEntitlement())
    await flush()
    expect(result.current.status).toBe('reauthenticate')
  })
})
