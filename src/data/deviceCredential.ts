import { readStored, writeStored } from '../core/storage/localStore'
import { fetchWithTimeout } from '../core/net/fetchWithTimeout'

const DEVICE_CREDENTIAL_KEY = 'ninety.device.credential'

export function saveDeviceCredential(credential: string): boolean {
  const saved = writeStored(DEVICE_CREDENTIAL_KEY, credential)
  if (saved && typeof window !== 'undefined') window.dispatchEvent(new Event('ninety:device-credential-changed'))
  return saved
}

export function loadDeviceCredential(): string | null {
  return readStored<string | null>(DEVICE_CREDENTIAL_KEY, null)
}

export interface DeviceEntitlement {
  active: boolean
  reason: 'trial' | 'subscription' | 'device_not_linked' | 'device_revoked' | 'inactive'
  accessEndsAt: string | null
  serverNow: string
}

export async function fetchDeviceEntitlement(signal?: AbortSignal): Promise<DeviceEntitlement | null> {
  const credential = loadDeviceCredential()
  const baseUrl = import.meta.env.VITE_NINETY_API_URL as string | undefined
  if (!credential || !baseUrl) return null
  const response = await fetchWithTimeout(`${baseUrl}/api/device/entitlement`, {
    headers: { Authorization: `Bearer ${credential}` },
    signal,
  })
  if (response.status === 401) {
    return { active: false, reason: 'device_revoked', accessEndsAt: null, serverNow: '' }
  }
  if (!response.ok) throw new Error(`device entitlement failed: ${response.status}`)
  return response.json() as Promise<DeviceEntitlement>
}
