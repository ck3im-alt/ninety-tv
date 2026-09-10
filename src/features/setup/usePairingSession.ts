import { useEffect, useRef, useState } from 'react'
import { ackPairing, createPairingSession, pollPairingStatus } from '../../data/pairing/pairingClient'
import { saveDeviceCredential } from '../../data/deviceCredential'

// Gap BETWEEN polls, not a fixed period. See the scheduling note below —
// with a serialized loop this is measured from the end of one poll to the
// start of the next, so a slow poll delays the next one instead of
// overlapping with it.
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
//
// SCHEDULING: a self-rescheduling setTimeout chain, NOT setInterval.
//
// This used to be `setInterval(async () => ...)`, which is a race rather
// than a schedule: setInterval fires on a fixed period regardless of
// whether the previous async callback has finished, and an async callback
// returns a promise the timer neither awaits nor knows about. The window
// that opens is not theoretical — the callback awaits onReceived(), which
// is the FULL playlist connection (fetch + parse + merge + persist of a
// playlist that can hold 30,000 channels, seconds of work on TV hardware).
// Every 2s during that, another poll fired, saw the same still-unacked
// READY session, and started a SECOND concurrent connection of the same
// playlist — repeatedly. The `lastFailedUrl` guard did not help: it is only
// set AFTER a connection resolves as rejected, so it is still null for the
// whole window that matters.
//
// The chain below schedules the next poll only from the completion of the
// previous one, so at most one poll — and at most one ready-processing
// operation — is ever in flight.
export function usePairingSession(
  onReceived: (m3uUrl: string, pollSecret: string) => Promise<boolean> | boolean,
  onPairedWithoutPlaylist?: () => void,
) {
  const [state, setState] = useState<State>({ status: 'loading', activationUrl: null })
  const [retryToken, setRetryToken] = useState(0)
  const onReceivedRef = useRef(onReceived)
  onReceivedRef.current = onReceived
  const onPairedRef = useRef(onPairedWithoutPlaylist)
  onPairedRef.current = onPairedWithoutPlaylist
  // Guards against React StrictMode's dev-only double-invoke of this
  // effect creating two sessions for one screen visit — see spec's "do not
  // create multiple pairing sessions unnecessarily". No effect in a real
  // (non-StrictMode) production build, which is all Tizen ever runs.
  const creatingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let pollHandle: ReturnType<typeof setTimeout> | undefined
    // Identifies the session generation a given async continuation belongs
    // to. `start()` re-runs on expiry/consumption, and an in-flight poll or
    // connection from the OLD session can resolve after the new one is
    // already up; without this it would be able to ack, stop polling, or
    // report a result against a session it has nothing to do with.
    let generation = 0
    // Belt-and-braces alongside the serialized chain: a stray caller (or a
    // future edit) can never get two polls overlapping.
    let inFlight = false
    // Tracks a URL that was already tried and rejected, so a stalled
    // (unfixed) bad submission doesn't get re-attempted every single poll
    // tick -- only a genuinely different (corrected) resubmission does.
    let lastFailedUrl: string | null = null

    // One poll, then schedule the next from its completion. Every early
    // return goes through scheduleNext() (or deliberately stops the loop),
    // so the chain can never silently die and leave the QR screen live but
    // no longer polling.
    async function pollOnce(myGeneration: number, pollSecret: string) {
      if (cancelled || myGeneration !== generation || inFlight) return
      inFlight = true
      try {
        const result = await pollPairingStatus(pollSecret)
        // Re-checked after EVERY await: this is the point a stale response
        // from a superseded session would otherwise take effect.
        if (cancelled || myGeneration !== generation) return

        if (result.status === 'paired') {
          // The credential came through the TV-only poll capability, never
          // the public QR token. Persist before acknowledging so a dropped
          // write cannot consume the only route to it.
          if (!saveDeviceCredential(result.deviceCredential)) return scheduleNext(myGeneration, pollSecret)
          if (result.m3uUrl) {
            if (result.m3uUrl === lastFailedUrl) return scheduleNext(myGeneration, pollSecret)
            const accepted = await onReceivedRef.current(result.m3uUrl, pollSecret)
            if (cancelled || myGeneration !== generation) return
            if (accepted) return
            lastFailedUrl = result.m3uUrl
            return scheduleNext(myGeneration, pollSecret)
          }
          if (result.playlistSetupComplete) {
            await ackPairing(pollSecret)
            if (cancelled || myGeneration !== generation) return
            onPairedRef.current?.()
            return
          }
          return scheduleNext(myGeneration, pollSecret)
        }

        if (result.status === 'ready') {
          if (result.m3uUrl === lastFailedUrl) return scheduleNext(myGeneration, pollSecret)
          const accepted = await onReceivedRef.current(result.m3uUrl, pollSecret)
          if (cancelled || myGeneration !== generation) return
          if (accepted) return // Connected: stop the chain for good.
          // Failed connection: remember it so the same broken URL is not
          // retried on every tick, and deliberately do NOT ack — the phone
          // page must stay valid so a corrected URL can be resubmitted.
          lastFailedUrl = result.m3uUrl
          return scheduleNext(myGeneration, pollSecret)
        }

        if (result.status === 'expired' || result.status === 'consumed') {
          // Regenerate. Bumping the generation first retires this chain, so
          // the old one cannot also schedule another poll.
          generation += 1
          void start()
          return
        }

        return scheduleNext(myGeneration, pollSecret) // 'waiting'
      } catch {
        // Transient network hiccup (including this poll's own timeout) —
        // try again on the next tick rather than tearing down the flow.
        if (cancelled || myGeneration !== generation) return
        return scheduleNext(myGeneration, pollSecret)
      } finally {
        inFlight = false
      }
    }

    function scheduleNext(myGeneration: number, pollSecret: string) {
      if (cancelled || myGeneration !== generation) return
      pollHandle = setTimeout(() => void pollOnce(myGeneration, pollSecret), POLL_INTERVAL_MS)
    }

    async function start() {
      const myGeneration = generation
      setState({ status: 'loading', activationUrl: null })
      try {
        const session = await createPairingSession()
        if (cancelled || myGeneration !== generation) return
        setState({ status: 'waiting', activationUrl: session.activationUrl })
        // Reset per session: a URL rejected against a previous session
        // should not be pre-emptively skipped on a brand-new one.
        lastFailedUrl = null
        scheduleNext(myGeneration, session.pollSecret)
      } catch {
        if (cancelled || myGeneration !== generation) return
        setState({ status: 'error', activationUrl: null })
      }
    }

    if (!creatingRef.current) {
      creatingRef.current = true
      void start()
    }

    return () => {
      cancelled = true
      creatingRef.current = false
      // Retires every in-flight continuation as well as the pending timer:
      // a poll already awaiting a response resolves into a generation check
      // that no longer matches and does nothing.
      generation += 1
      if (pollHandle) clearTimeout(pollHandle)
    }
  }, [retryToken])

  return {
    status: state.status,
    activationUrl: state.activationUrl,
    retry: () => setRetryToken((n) => n + 1),
  }
}

export { ackPairing }
