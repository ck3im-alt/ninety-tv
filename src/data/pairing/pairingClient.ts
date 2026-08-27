// Client for Ninety's QR-based M3U pairing flow (../../ninety-api) — lets
// a TV show a QR code instead of requiring the M3U URL to be typed with a
// remote. See PlaylistSetupScreen's QR section / usePairingSession.ts for
// the flow this drives. Same "Ninety's own server, proper CORS, no
// dev-proxy needed" reasoning as sports/ninetyApiClient.ts.

import { fetchWithTimeout } from '../../core/net/fetchWithTimeout'

// Shorter than the shared 12s default: these run on a ~2s cadence behind a
// QR code the viewer is staring at, so a stuck request should be given up
// on and retried well before the next tick would have fired anyway.
const POLL_TIMEOUT_MS = 8_000

// Read lazily rather than as a module-level const, for the same reason
// sports/ninetyApiClient.ts does (commit 1d0cb17): a top-level const
// freezes whatever VITE_NINETY_API_URL was at first import — before any
// test's beforeEach runs — which makes this module's tests pass only on a
// machine that happens to have a local .env and fail in CI, which runs
// `npm test` without one. Production behaviour is identical either way:
// Vite statically replaces import.meta.env.* at build time.
function getBaseUrl(): string | undefined {
  return import.meta.env.VITE_NINETY_API_URL as string | undefined
}

export interface PairingSession {
  pollSecret: string
  activationUrl: string
  expiresAt: string
}

export async function createPairingSession(signal?: AbortSignal): Promise<PairingSession> {
  const baseUrl = getBaseUrl()
  if (!baseUrl) throw new Error('VITE_NINETY_API_URL is not set (see .env.example)')
  const res = await fetchWithTimeout(`${baseUrl}/api/pairing`, { method: 'POST', signal })
  if (!res.ok) throw new Error(`pairing session creation failed: ${res.status}`)
  return (await res.json()) as PairingSession
}

export type PairingPollResult =
  | { status: 'waiting' }
  | { status: 'ready'; m3uUrl: string }
  | { status: 'expired' }
  | { status: 'consumed' }

export async function pollPairingStatus(pollSecret: string, signal?: AbortSignal): Promise<PairingPollResult> {
  const baseUrl = getBaseUrl()
  if (!baseUrl) throw new Error('VITE_NINETY_API_URL is not set (see .env.example)')
  // A poll that never settles would stall the whole pairing loop, which is
  // serialized (one request in flight at a time — see usePairingSession).
  // Bounded well inside a human's patience for a QR screen.
  const res = await fetchWithTimeout(`${baseUrl}/api/pairing/status`, {
    headers: { Authorization: `Bearer ${pollSecret}` },
    timeoutMs: POLL_TIMEOUT_MS,
    signal,
  })
  if (!res.ok) throw new Error(`pairing status poll failed: ${res.status}`)
  return (await res.json()) as PairingPollResult
}

// Best-effort: a dropped ack just means the session sits unused until it
// naturally expires (~10 min) rather than becoming reusable — see
// ninety-api's pairing_sessions design — so a network failure here is safe
// to swallow rather than surface to the user.
export async function ackPairing(pollSecret: string): Promise<void> {
  const baseUrl = getBaseUrl()
  if (!baseUrl) return
  try {
    await fetchWithTimeout(`${baseUrl}/api/pairing/ack`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pollSecret}` },
      timeoutMs: POLL_TIMEOUT_MS,
    })
  } catch {
    // See comment above — intentionally not surfaced.
  }
}
