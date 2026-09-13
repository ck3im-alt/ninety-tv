import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchDeviceEntitlement, loadDeviceCredential, type DeviceEntitlement } from './deviceCredential'

export type DeviceEntitlementState =
  | { status: 'unpaired' | 'checking' | 'unavailable' }
  | { status: 'reauthenticate'; entitlement: DeviceEntitlement }
  | { status: 'active' | 'inactive'; entitlement: DeviceEntitlement }

const ACTIVE_REFRESH_MS = 5 * 60 * 1000
const INACTIVE_REFRESH_MS = 7_000

export function useDeviceEntitlement(): DeviceEntitlementState & { retry: () => void } {
  const [state, setState] = useState<DeviceEntitlementState>(() => loadDeviceCredential() ? { status: 'checking' } : { status: 'unpaired' })
  const requestId = useRef(0)
  const inFlight = useRef<Promise<void> | null>(null)

  const check = useCallback((): Promise<void> => {
    // Manual Check again, the credential event, and the scheduled refresh
    // can land together. Return the one live request instead of ever
    // overlapping entitlement calls.
    if (inFlight.current) return inFlight.current
    const run = (async () => {
      if (!loadDeviceCredential()) { setState({ status: 'unpaired' }); return }
      const id = ++requestId.current
      try {
        const entitlement = await fetchDeviceEntitlement()
        if (id !== requestId.current) return
        if (!entitlement) { setState({ status: 'unavailable' }); return }
        if (entitlement.reason === 'device_revoked' || entitlement.reason === 'device_not_linked' || entitlement.reason === 'invalid_device_credential') {
          setState({ status: 'reauthenticate', entitlement })
          return
        }
        setState({ status: entitlement.active ? 'active' : 'inactive', entitlement })
      } catch {
        if (id === requestId.current) setState({ status: 'unavailable' })
      }
    })()
    inFlight.current = run.finally(() => {
      inFlight.current = null
    })
    return inFlight.current
  }, [])

  useEffect(() => {
    void check()
    const onCredential = () => void check()
    window.addEventListener('ninety:device-credential-changed', onCredential)
    return () => {
      requestId.current += 1
      window.removeEventListener('ninety:device-credential-changed', onCredential)
    }
  }, [check])

  // Self-rescheduling by state transition: the timeout starts only after
  // the previous request has resolved and installed its result, so purchase
  // auto-unlock checks can never overlap even on a slow connection.
  useEffect(() => {
    if (state.status !== 'active' && state.status !== 'inactive') return
    const delay = state.status === 'inactive' ? INACTIVE_REFRESH_MS : ACTIVE_REFRESH_MS
    const timeout = setTimeout(() => void check(), delay)
    return () => clearTimeout(timeout)
  }, [check, state])

  useEffect(() => {
    if (state.status !== 'active' || !state.entitlement.accessEndsAt || !state.entitlement.serverNow) return
    const remaining = new Date(state.entitlement.accessEndsAt).getTime() - new Date(state.entitlement.serverNow).getTime()
    if (!Number.isFinite(remaining) || remaining > ACTIVE_REFRESH_MS) return
    // Re-check at the authoritative server boundary instead of allowing the
    // normal five-minute refresh cadence to overrun an expired trial.
    const timeout = setTimeout(() => void check(), Math.max(0, remaining) + 250)
    return () => clearTimeout(timeout)
  }, [check, state])

  return { ...state, retry: () => void check() }
}
