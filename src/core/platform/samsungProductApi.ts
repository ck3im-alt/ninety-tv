// One feature-detected accessor per Samsung Product API surface this app
// uses, and nothing else.
//
// `webapis` is injected by the Samsung TV web runtime, NOT by Tizen's own
// `tizen` namespace and NOT by any browser. Every unit test, every
// `vite dev` session and every non-Samsung target therefore has no
// `window.webapis` at all — so these must be probes that return null, never
// assumptions that throw. That is the same rule keys.ts/deviceRegion.ts
// already follow for `window.tizen`.
//
// Kept as accessors rather than cached module-level constants because the
// runtime injects `webapis` asynchronously on some firmware: reading it
// once at module-evaluation time can legitimately observe `undefined` on a
// TV that will have it a moment later.

export interface SamsungNetworkApi {
  // Samsung's own enum. Only the two gateway states are consumed here; the
  // rest are declared so a narrowing switch reads honestly.
  NetworkState: {
    GATEWAY_DISCONNECTED: number
    GATEWAY_CONNECTED: number
    [key: string]: number
  }
  isConnectedToGateway(): boolean
  addNetworkStateChangeListener(callback: (state: number) => void): number
  removeNetworkStateChangeListener(listenerId: number): void
}

export interface SamsungAppCommonApi {
  AppCommonScreenSaverState: {
    SCREEN_SAVER_ON: number
    SCREEN_SAVER_OFF: number
    [key: string]: number
  }
  setScreenSaver(state: number, callback?: (result: unknown) => void): void
}

function webapis(): Partial<SamsungWebapis> | null {
  if (typeof window === 'undefined') return null
  return window.webapis ?? null
}

// Null on anything that is not a Samsung TV, and also null on a Samsung TV
// whose firmware exposes `webapis` without the network module — both are
// "cannot ask the platform", which callers must already handle.
export function getSamsungNetworkApi(): SamsungNetworkApi | null {
  const api = webapis()?.network
  if (!api) return null
  if (typeof api.addNetworkStateChangeListener !== 'function') return null
  if (typeof api.isConnectedToGateway !== 'function') return null
  if (!api.NetworkState) return null
  return api as SamsungNetworkApi
}

export function getSamsungAppCommonApi(): SamsungAppCommonApi | null {
  const api = webapis()?.appcommon
  if (!api) return null
  if (typeof api.setScreenSaver !== 'function') return null
  if (!api.AppCommonScreenSaverState) return null
  return api as SamsungAppCommonApi
}
