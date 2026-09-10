import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchDeviceEntitlement, loadDeviceCredential, type DeviceEntitlement } from './deviceCredential'

export type DeviceEntitlementState =
  | { status: 'unpaired' | 'checking' | 'unavailable' }
  | { status: 'active' | 'inactive'; entitlement: DeviceEntitlement }

const REFRESH_MS = 5 * 60 * 1000

export function useDeviceEntitlement(): DeviceEntitlementState & { retry: () => void } {
  const [state, setState] = useState<DeviceEntitlementState>(() => loadDeviceCredential() ? { status: 'checking' } : { status: 'unpaired' })
  const requestId = useRef(0)

  const check = useCallback(async () => {
    if (!loadDeviceCredential()) { setState({ status: 'unpaired' }); return }
    const id = ++requestId.current
    try {
      const entitlement = await fetchDeviceEntitlement()
      if (id !== requestId.current) return
      if (!entitlement) { setState({ status: 'unavailable' }); return }
      setState({ status: entitlement.active ? 'active' : 'inactive', entitlement })
    } catch {
      if (id === requestId.current) setState({ status: 'unavailable' })
    }
  }, [])

  useEffect(() => {
    void check()
    const interval = setInterval(() => void check(), REFRESH_MS)
    const onCredential = () => void check()
    window.addEventListener('ninety:device-credential-changed', onCredential)
    return () => {
      requestId.current += 1
      clearInterval(interval)
      window.removeEventListener('ninety:device-credential-changed', onCredential)
    }
  }, [check])

  useEffect(() => {
    if (state.status !== 'active' || !state.entitlement.accessEndsAt || !state.entitlement.serverNow) return
    const remaining = new Date(state.entitlement.accessEndsAt).getTime() - new Date(state.entitlement.serverNow).getTime()
    if (!Number.isFinite(remaining) || remaining > REFRESH_MS) return
    // Re-check at the authoritative server boundary instead of allowing the
    // normal five-minute refresh cadence to overrun an expired trial.
    const timeout = setTimeout(() => void check(), Math.max(0, remaining) + 250)
    return () => clearTimeout(timeout)
  }, [check, state])

  return { ...state, retry: () => void check() }
}
