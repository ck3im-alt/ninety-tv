import { useEffect, useRef, useState } from 'react'
import { ackPairing, createPairingSession, pollPairingStatus } from '../../data/pairing/pairingClient'

const POLL_INTERVAL_MS = 2000

export type PairingSessionStatus = 'loading' | 'waiting' | 'error'

interface State {
  status: PairingSessionStatus
  activationUrl: string | null
}

// Owns the whole QR-pairing lifecycle for PlaylistSetupScreen: create a
// session on mount, poll roughly every 2s while waiting, hand the received
// M3U URL back to the caller (which feeds it into the screen's existing
// connect() — the same path manual entry uses), and transparently start a
// fresh session if this one expires before anything was scanned. Polling
// always stops on success, expiry-triggered-regeneration, unmount, or
// navigating away (the owning screen unmounting is what actually stops
// this hook, same as any other effect).
//
// onReceived returns whether the URL was actually accepted. A bad
// playlist URL shouldn't dead-end the pairing session -- the phone page
// stays valid (unconsumed) until the TV acks, so on a `false` return this
// keeps polling the same session, letting the user paste a corrected URL
// and resubmit within the same ~10 min window instead of having to
// rescan a QR that's already gone stale on the TV side.
export function usePairingSession(onReceived: (m3uUrl: string, pollSecret: string) => Promise<boolean> | boolean) {
  const [state, setState] = useState<State>({ status: 'loading', activationUrl: null })
  const [retryToken, setRetryToken] = useState(0)
  const onReceivedRef = useRef(onReceived)
  onReceivedRef.current = onReceived
  // Guards against React StrictMode's dev-only double-invoke of this
  // effect creating two sessions for one screen visit — see spec's "do not
  // create multiple pairing sessions unnecessarily". No effect in a real
  // (non-StrictMode) production build, which is all Tizen ever runs.
  const creatingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let pollHandle: ReturnType<typeof setInterval> | undefined
    let pollSecret: string | null = null
    // Tracks a URL that was already tried and rejected, so a stalled
    // (unfixed) bad submission doesn't get re-attempted every single poll
    // tick -- only a genuinely different (corrected) resubmission does.
    let lastFailedUrl: string | null = null

    async function start() {
      setState({ status: 'loading', activationUrl: null })
      try {
        const session = await createPairingSession()
        if (cancelled) return
        pollSecret = session.pollSecret
        setState({ status: 'waiting', activationUrl: session.activationUrl })

        pollHandle = setInterval(async () => {
          if (!pollSecret) return
          try {
            const result = await pollPairingStatus(pollSecret)
            if (cancelled) return
            if (result.status === 'ready') {
              if (result.m3uUrl === lastFailedUrl) return
              const accepted = await onReceivedRef.current(result.m3uUrl, pollSecret)
              if (cancelled) return
              if (accepted) {
                clearInterval(pollHandle)
              } else {
                lastFailedUrl = result.m3uUrl
              }
            } else if (result.status === 'expired' || result.status === 'consumed') {
              clearInterval(pollHandle)
              if (!cancelled) void start()
            }
            // 'waiting': keep polling, nothing to do.
          } catch {
            // Transient network hiccup — try again on the next tick rather
            // than tearing down the whole flow.
          }
        }, POLL_INTERVAL_MS)
      } catch {
        if (!cancelled) setState({ status: 'error', activationUrl: null })
      }
    }

    if (!creatingRef.current) {
      creatingRef.current = true
      void start()
    }

    return () => {
      cancelled = true
      creatingRef.current = false
      if (pollHandle) clearInterval(pollHandle)
    }
  }, [retryToken])

  return {
    status: state.status,
    activationUrl: state.activationUrl,
    retry: () => setRetryToken((n) => n + 1),
  }
}

export { ackPairing }
