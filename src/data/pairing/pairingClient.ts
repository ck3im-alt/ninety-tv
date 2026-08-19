// Client for Ninety's QR-based M3U pairing flow (../../ninety-api) — lets
// a TV show a QR code instead of requiring the M3U URL to be typed with a
// remote. See PlaylistSetupScreen's QR section / usePairingSession.ts for
// the flow this drives. Same "Ninety's own server, proper CORS, no
// dev-proxy needed" reasoning as sports/ninetyApiClient.ts.

const BASE_URL = import.meta.env.VITE_NINETY_API_URL as string | undefined

export interface PairingSession {
  pollSecret: string
  activationUrl: string
  expiresAt: string
}

export async function createPairingSession(): Promise<PairingSession> {
  if (!BASE_URL) throw new Error('VITE_NINETY_API_URL is not set (see .env.example)')
  const res = await fetch(`${BASE_URL}/api/pairing`, { method: 'POST' })
  if (!res.ok) throw new Error(`pairing session creation failed: ${res.status}`)
  return (await res.json()) as PairingSession
}

export type PairingPollResult =
  | { status: 'waiting' }
  | { status: 'ready'; m3uUrl: string }
  | { status: 'expired' }
  | { status: 'consumed' }

export async function pollPairingStatus(pollSecret: string): Promise<PairingPollResult> {
  if (!BASE_URL) throw new Error('VITE_NINETY_API_URL is not set (see .env.example)')
  const res = await fetch(`${BASE_URL}/api/pairing/status`, {
    headers: { Authorization: `Bearer ${pollSecret}` },
  })
  if (!res.ok) throw new Error(`pairing status poll failed: ${res.status}`)
  return (await res.json()) as PairingPollResult
}

// Best-effort: a dropped ack just means the session sits unused until it
// naturally expires (~10 min) rather than becoming reusable — see
// ninety-api's pairing_sessions design — so a network failure here is safe
// to swallow rather than surface to the user.
export async function ackPairing(pollSecret: string): Promise<void> {
  if (!BASE_URL) return
  try {
    await fetch(`${BASE_URL}/api/pairing/ack`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pollSecret}` },
    })
  } catch {
    // See comment above — intentionally not surfaced.
  }
}
