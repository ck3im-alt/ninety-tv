import { readStored, writeStored } from '../core/storage/localStore'
import { fetchWithTimeout } from '../core/net/fetchWithTimeout'

const DEVICE_CREDENTIAL_KEY = 'ninety.device.credential'

export function notifyDeviceCredentialChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ninety:device-credential-changed'))
}

export function saveDeviceCredential(credential: string, notify = true): boolean {
  const saved = writeStored(DEVICE_CREDENTIAL_KEY, credential)
  if (saved && notify) notifyDeviceCredentialChanged()
  return saved
}

export function loadDeviceCredential(): string | null {
  return readStored<string | null>(DEVICE_CREDENTIAL_KEY, null)
}

export interface DeviceEntitlement {
  active: boolean
  reason: 'trial' | 'subscription' | 'device_not_linked' | 'device_revoked' | 'inactive' | 'invalid_device_credential'
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
    return { active: false, reason: 'invalid_device_credential', accessEndsAt: null, serverNow: '' }
  }
  if (!response.ok) throw new Error(`device entitlement failed: ${response.status}`)
  return response.json() as Promise<DeviceEntitlement>
}

export interface DevicePurchaseSession {
  activationUrl: string
  expiresAt: string
}

export async function createDevicePurchaseSession(signal?: AbortSignal): Promise<DevicePurchaseSession> {
  const credential = loadDeviceCredential()
  const baseUrl = import.meta.env.VITE_NINETY_API_URL as string | undefined
  if (!credential || !baseUrl) throw new Error('device purchase session is unavailable')
  const response = await fetchWithTimeout(`${baseUrl}/api/device/purchase-session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}` },
    signal,
  })
  if (!response.ok) throw new Error(`device purchase session failed: ${response.status}`)
  return response.json() as Promise<DevicePurchaseSession>
}
