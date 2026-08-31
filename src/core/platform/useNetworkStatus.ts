import { useEffect, useRef, useState } from 'react'
import { createNetworkMonitor } from './networkStatus'
import type { NetworkMonitor, NetworkMonitorOptions, NetworkStatus } from './networkStatus'

export interface NetworkStatusHandle {
  status: NetworkStatus
  // Handed to the app-lifecycle handler so resuming from hidden re-reads
  // the platform — Samsung documents that connectivity can change while the
  // app is in the background, so the listener alone is not sufficient.
  // Stable across renders (ref-backed), so it can be a dependency without
  // re-running effects.
  recheck: () => void
}

// ONE monitor for the whole app, created once at App mount and disposed on
// unmount. Deliberately not a module-level singleton: a singleton would
// keep a Samsung listener registered across test files and would have no
// natural teardown point, which is exactly the listener leak Samsung's
// lifecycle requirements ask us not to create.
export function useNetworkStatus(options?: NetworkMonitorOptions): NetworkStatusHandle {
  const monitorRef = useRef<NetworkMonitor | null>(null)
  const [status, setStatus] = useState<NetworkStatus>('online')

  // Options are read once, at mount, matching usePlayerSession's convention
  // for injected collaborators — a monitor that needs a different platform
  // source needs a fresh mount, not a live swap.
  const optionsRef = useRef(options)

  useEffect(() => {
    const monitor = createNetworkMonitor(optionsRef.current)
    monitorRef.current = monitor
    // Seed from the monitor's own first read rather than assuming 'online':
    // an app launched while the TV is already disconnected must show the
    // notice immediately, not only after the first transition.
    setStatus(monitor.getStatus())
    const unsubscribe = monitor.subscribe(setStatus)
    return () => {
      unsubscribe()
      monitor.dispose()
      monitorRef.current = null
    }
  }, [])

  // Stable identity, so callers can depend on it freely.
  const recheckRef = useRef(() => monitorRef.current?.recheck())

  return { status, recheck: recheckRef.current }
}

export type { NetworkStatus }
