import { readStored, writeStored } from '../storage/localStore'

const INSTALLATION_ID_KEY = 'ninety.device.installationId'

export interface PairingDeviceMetadata {
  // Continuity for this app installation only. The API must never treat this
  // resettable local value as physical-TV evidence for trial eligibility.
  installationId: string
  // Samsung ProductInfo DUID is the authoritative physical-TV trial signal.
  // It is optional because older/restricted TVs can deny ProductInfo access;
  // pairing must still proceed safely in that case.
  duid?: string
  // Network metadata only; MAC addresses are not a trial identity.
  mac?: string
  platform: 'samsung-tizen'
  model?: string
  modelCode?: string
  appVersion: string
}

function randomInstallationId(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

export function getInstallationId(): string {
  const stored = readStored<string | null>(INSTALLATION_ID_KEY, null)
  if (stored) return stored
  const created = randomInstallationId()
  writeStored(INSTALLATION_ID_KEY, created)
  return created
}

function safelyRead(reader: (() => string) | undefined): string | undefined {
  if (!reader) return undefined
  try {
    const value = reader()
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  } catch {
    return undefined
  }
}

export function formatMacAddress(value: string | undefined): string | null {
  if (!value) return null
  const compact = value.replace(/[^a-fA-F0-9]/g, '').toUpperCase()
  if (!/^[0-9A-F]{12}$/.test(compact)) return null
  return compact.match(/.{2}/g)!.join(':')
}

// Display-only support metadata. Keeping this separate from the full
// pairing object makes it impossible for a screen to accidentally render
// the DUID or installation id while still showing the same normalized MAC
// the phone receives from the API.
export function getDisplayMacAddress(): string | null {
  const network = typeof window === 'undefined' ? undefined : window.webapis?.network
  return formatMacAddress(safelyRead(network?.getMac?.bind(network)))
}

// Raw identifiers exist only in this short-lived request object. Callers
// must never log it. The API HMAC-fingerprints them before persistence.
export function collectPairingDeviceMetadata(): PairingDeviceMetadata {
  const samsung = typeof window === 'undefined' ? undefined : window.webapis
  const product = samsung?.productinfo
  const network = samsung?.network
  return {
    installationId: getInstallationId(),
    duid: safelyRead(product?.getDuid?.bind(product)),
    mac: safelyRead(network?.getMac?.bind(network)),
    platform: 'samsung-tizen',
    model: safelyRead(product?.getModel?.bind(product)),
    modelCode: safelyRead(product?.getModelCode?.bind(product)),
    appVersion: (import.meta.env.VITE_NINETY_APP_VERSION as string | undefined) ?? '0.1.0',
  }
}
