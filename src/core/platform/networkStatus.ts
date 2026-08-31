// ONE application-level answer to "is this TV connected to a network?".
//
// Samsung's Smart TV quality requirements are specific about this: a
// network disconnect must be visibly reported to the viewer, the app must
// not freeze or spin indefinitely while disconnected, remote input must
// keep working, and reconnecting must recover into a usable app and clear
// the message. Samsung also documents that network state can change WHILE
// THE APP IS HIDDEN, so nothing here may assume it will observe every
// transition through a listener — `recheck()` exists precisely so the
// visibility handler can re-read the truth on resume.
//
// WHAT THIS DOES AND DOES NOT MEAN. This is the TV's own connectivity, and
// nothing else. It is deliberately NOT:
//   - "the user's IPTV provider is reachable" (a per-playlist failure, with
//     its own existing error UX in the playlist/player paths), or
//   - "ninety-api is reachable" (a per-request failure, with its own
//     existing loading/empty states on Home, Schedule and Match View).
// Those two stay exactly as they are. Conflating them would put a
// full-width "no network" banner over a TV that is perfectly online and
// merely has one dead provider — which is both wrong and unactionable.
//
// Platform sources, in priority order:
//   1. Samsung Product Network API (webapis.network) on real TV firmware.
//      This is the authoritative source and the one Samsung's requirement
//      is written against; it needs the network.public privilege declared
//      in config.xml.
//   2. navigator.onLine + the window online/offline events, for browser dev
//      and for any Samsung firmware that does not expose webapis.network.
//      Weaker (navigator.onLine only proves a link, not reachability) but
//      strictly better than nothing, and it is exactly right for `vite dev`.
//
// Everything is injectable so the whole thing is testable with a fake
// Samsung implementation and no globals.
import { getSamsungNetworkApi } from './samsungProductApi'
import type { SamsungNetworkApi } from './samsungProductApi'

export type NetworkStatus = 'online' | 'offline'

export interface NetworkMonitor {
  getStatus(): NetworkStatus
  // Fires only on a genuine CHANGE — see the dedupe in `publish` below.
  subscribe(listener: (status: NetworkStatus) => void): () => void
  // Re-read the platform right now and publish if it changed. Called on
  // resume from hidden, because Samsung documents that the app can miss
  // transitions that happen while it is in the background.
  recheck(): void
  dispose(): void
}

export interface NetworkMonitorOptions {
  // Injected in tests. Defaults to the real feature-detected accessor,
  // which returns null on anything that is not Samsung TV firmware.
  getSamsungApi?: () => SamsungNetworkApi | null
  // Injected in tests. `undefined` models a platform with no
  // navigator.onLine at all, which must not be read as "offline".
  getNavigatorOnline?: () => boolean | undefined
  addWindowListener?: (type: 'online' | 'offline', listener: () => void) => void
  removeWindowListener?: (type: 'online' | 'offline', listener: () => void) => void
}

function defaultNavigatorOnline(): boolean | undefined {
  if (typeof navigator === 'undefined') return undefined
  return typeof navigator.onLine === 'boolean' ? navigator.onLine : undefined
}

function defaultAddWindowListener(type: 'online' | 'offline', listener: () => void): void {
  if (typeof window === 'undefined') return
  window.addEventListener(type, listener)
}

function defaultRemoveWindowListener(type: 'online' | 'offline', listener: () => void): void {
  if (typeof window === 'undefined') return
  window.removeEventListener(type, listener)
}

export function createNetworkMonitor(options: NetworkMonitorOptions = {}): NetworkMonitor {
  const {
    getSamsungApi = getSamsungNetworkApi,
    getNavigatorOnline = defaultNavigatorOnline,
    addWindowListener = defaultAddWindowListener,
    removeWindowListener = defaultRemoveWindowListener,
  } = options

  const samsung = safely(() => getSamsungApi(), null)
  const listeners = new Set<(status: NetworkStatus) => void>()
  let disposed = false

  // OPTIMISTIC DEFAULT, deliberately. An unknown/unreadable platform must
  // resolve to 'online': the cost of being wrong that way is a missing
  // banner, while the cost of defaulting to 'offline' is covering a
  // perfectly working app with an error the viewer cannot dismiss. Every
  // read below follows the same rule.
  function read(): NetworkStatus {
    if (samsung) {
      const connected = safely(() => samsung.isConnectedToGateway(), true)
      return connected ? 'online' : 'offline'
    }
    const online = safely(() => getNavigatorOnline(), undefined)
    if (online === undefined) return 'online'
    return online ? 'online' : 'offline'
  }

  let status: NetworkStatus = read()

  // REPEATED IDENTICAL CALLBACKS MUST NOT REACH THE UI. Samsung firmware
  // is documented to fire the network-state listener more than once for a
  // single real transition, and the navigator fallback can double up too
  // (an `online` event on a monitor that already read `online` at
  // construction). Every publish path funnels through here, so the
  // subscriber — and therefore React state, and therefore the banner —
  // only ever sees a genuine edge.
  function publish(next: NetworkStatus): void {
    if (disposed || next === status) return
    status = next
    for (const listener of listeners) listener(status)
  }

  let samsungListenerId: number | null = null
  const onWindowOnline = () => publish('online')
  const onWindowOffline = () => publish('offline')

  if (samsung) {
    // The callback carries Samsung's own NetworkState enum value. Compared
    // against GATEWAY_DISCONNECTED rather than assumed numerically, because
    // the enum's numbering is the platform's to choose, not ours.
    samsungListenerId = safely(
      () =>
        samsung.addNetworkStateChangeListener((state) => {
          publish(state === samsung.NetworkState.GATEWAY_DISCONNECTED ? 'offline' : 'online')
        }),
      null,
    )
    if (samsungListenerId === null) {
      console.warn('[networkStatus] Samsung network listener could not be registered — falling back to navigator online/offline events.')
      addWindowListener('online', onWindowOnline)
      addWindowListener('offline', onWindowOffline)
    }
  } else {
    addWindowListener('online', onWindowOnline)
    addWindowListener('offline', onWindowOffline)
  }

  const usingWindowListeners = !samsung || samsungListenerId === null

  return {
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    recheck() {
      if (disposed) return
      publish(read())
    },
    dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
      if (samsung && samsungListenerId !== null) {
        safely(() => samsung.removeNetworkStateChangeListener(samsungListenerId), undefined)
      }
      if (usingWindowListeners) {
        removeWindowListener('online', onWindowOnline)
        removeWindowListener('offline', onWindowOffline)
      }
    },
  }
}

// Samsung Product API calls throw (rather than returning an error) when the
// privilege is missing or the firmware is older than the call — and a
// connectivity probe must never be the reason the app dies. Every crossing
// into `webapis` goes through here.
function safely<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch (err) {
    console.warn('[networkStatus] Samsung network call failed', err)
    return fallback
  }
}
