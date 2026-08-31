import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNetworkMonitor } from './networkStatus'
import type { SamsungNetworkApi } from './samsungProductApi'

// Samsung's network-lifecycle requirements, exercised against an INJECTABLE
// fake Samsung Product Network API — `webapis` does not exist in Node, and
// the point is to prove the adapter's behaviour, not to prove that a mock
// returns what it was told to.

const GATEWAY_DISCONNECTED = 0
const GATEWAY_CONNECTED = 1

function createFakeSamsungNetwork(initiallyConnected = true) {
  const listeners = new Map<number, (state: number) => void>()
  let nextId = 1
  let connected = initiallyConnected
  const removed: number[] = []

  const api: SamsungNetworkApi = {
    NetworkState: { GATEWAY_DISCONNECTED, GATEWAY_CONNECTED },
    isConnectedToGateway: () => connected,
    addNetworkStateChangeListener: (callback) => {
      const id = nextId++
      listeners.set(id, callback)
      return id
    },
    removeNetworkStateChangeListener: (id) => {
      removed.push(id)
      listeners.delete(id)
    },
  }

  return {
    api,
    removed,
    listenerCount: () => listeners.size,
    // Fires the platform callback WITHOUT changing isConnectedToGateway,
    // so a test can distinguish "the listener said so" from "we re-read".
    emit: (state: number) => {
      for (const listener of [...listeners.values()]) listener(state)
    },
    // Changes the underlying truth WITHOUT firing a callback — models
    // Samsung's documented case of the network changing while the app is
    // hidden and no event being delivered.
    setConnectedSilently: (value: boolean) => {
      connected = value
    },
  }
}

describe('network monitor (Samsung Product Network API)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads the initial status from the platform, so an app launched offline says so immediately', () => {
    const samsung = createFakeSamsungNetwork(false)
    const monitor = createNetworkMonitor({ getSamsungApi: () => samsung.api })

    expect(monitor.getStatus()).toBe('offline')
    monitor.dispose()
  })

  it('publishes a disconnect and a reconnect to subscribers', () => {
    const samsung = createFakeSamsungNetwork(true)
    const monitor = createNetworkMonitor({ getSamsungApi: () => samsung.api })
    const seen: string[] = []
    monitor.subscribe((status) => seen.push(status))

    samsung.emit(GATEWAY_DISCONNECTED)
    samsung.emit(GATEWAY_CONNECTED)

    expect(seen).toEqual(['offline', 'online'])
    expect(monitor.getStatus()).toBe('online')
    monitor.dispose()
  })

  it('does not spam state or UI when the platform repeats an identical callback', () => {
    // Samsung firmware is documented to fire this listener more than once
    // for a single real transition. A subscriber must only ever see edges.
    const samsung = createFakeSamsungNetwork(true)
    const monitor = createNetworkMonitor({ getSamsungApi: () => samsung.api })
    const seen: string[] = []
    monitor.subscribe((status) => seen.push(status))

    samsung.emit(GATEWAY_DISCONNECTED)
    samsung.emit(GATEWAY_DISCONNECTED)
    samsung.emit(GATEWAY_DISCONNECTED)

    expect(seen).toEqual(['offline'])
    monitor.dispose()
  })

  it('recheck() catches a change that happened while the app was hidden', () => {
    // The requirement this exists for: Samsung documents that network state
    // can change while the app is in the background, so the listener alone
    // is not sufficient and the visibility handler must re-read.
    const samsung = createFakeSamsungNetwork(true)
    const monitor = createNetworkMonitor({ getSamsungApi: () => samsung.api })
    const seen: string[] = []
    monitor.subscribe((status) => seen.push(status))

    samsung.setConnectedSilently(false)
    expect(seen).toEqual([]) // nothing was delivered — that is the point

    monitor.recheck()

    expect(seen).toEqual(['offline'])
    expect(monitor.getStatus()).toBe('offline')
    monitor.dispose()
  })

  it('recheck() is silent when nothing actually changed', () => {
    const samsung = createFakeSamsungNetwork(true)
    const monitor = createNetworkMonitor({ getSamsungApi: () => samsung.api })
    const seen: string[] = []
    monitor.subscribe((status) => seen.push(status))

    monitor.recheck()
    monitor.recheck()

    expect(seen).toEqual([])
    monitor.dispose()
  })

  it('removes its platform listener on dispose (no leak across app lifetimes)', () => {
    const samsung = createFakeSamsungNetwork(true)
    const monitor = createNetworkMonitor({ getSamsungApi: () => samsung.api })
    expect(samsung.listenerCount()).toBe(1)

    monitor.dispose()

    expect(samsung.listenerCount()).toBe(0)
    expect(samsung.removed).toEqual([1])
  })

  it('delivers nothing after dispose', () => {
    const samsung = createFakeSamsungNetwork(true)
    const monitor = createNetworkMonitor({ getSamsungApi: () => samsung.api })
    const seen: string[] = []
    monitor.subscribe((status) => seen.push(status))

    monitor.dispose()
    monitor.recheck()

    expect(seen).toEqual([])
  })

  it('treats a throwing Samsung API as online rather than crashing or showing a false banner', () => {
    // A missing privilege makes these calls THROW. The app must not die,
    // and must not cover a working TV with an undismissable error either.
    const monitor = createNetworkMonitor({
      getSamsungApi: () =>
        ({
          NetworkState: { GATEWAY_DISCONNECTED, GATEWAY_CONNECTED },
          isConnectedToGateway: () => {
            throw new Error('privilege denied')
          },
          addNetworkStateChangeListener: () => {
            throw new Error('privilege denied')
          },
          removeNetworkStateChangeListener: () => {},
        }) as SamsungNetworkApi,
    })

    expect(monitor.getStatus()).toBe('online')
    monitor.dispose()
  })
})

describe('network monitor (browser/dev fallback)', () => {
  function createFakeWindowListeners() {
    const handlers = new Map<string, Set<() => void>>()
    return {
      add: (type: 'online' | 'offline', listener: () => void) => {
        if (!handlers.has(type)) handlers.set(type, new Set())
        handlers.get(type)!.add(listener)
      },
      remove: (type: 'online' | 'offline', listener: () => void) => {
        handlers.get(type)?.delete(listener)
      },
      emit: (type: 'online' | 'offline') => {
        for (const listener of [...(handlers.get(type) ?? [])]) listener()
      },
      count: () => [...handlers.values()].reduce((total, set) => total + set.size, 0),
    }
  }

  it('uses navigator.onLine and the online/offline events when there is no Samsung API', () => {
    const listeners = createFakeWindowListeners()
    let online = true
    const monitor = createNetworkMonitor({
      getSamsungApi: () => null,
      getNavigatorOnline: () => online,
      addWindowListener: listeners.add,
      removeWindowListener: listeners.remove,
    })
    const seen: string[] = []
    monitor.subscribe((status) => seen.push(status))

    online = false
    listeners.emit('offline')
    online = true
    listeners.emit('online')

    expect(seen).toEqual(['offline', 'online'])
    monitor.dispose()
    expect(listeners.count()).toBe(0)
  })

  it('reports online on a platform that has no navigator.onLine at all', () => {
    // "Unknown" must never render as "offline" — the cost of a missing
    // banner is far lower than an undismissable false one.
    const monitor = createNetworkMonitor({
      getSamsungApi: () => null,
      getNavigatorOnline: () => undefined,
      addWindowListener: () => {},
      removeWindowListener: () => {},
    })

    expect(monitor.getStatus()).toBe('online')
    monitor.dispose()
  })

  it('falls back to window events when the Samsung listener cannot be registered', () => {
    const listeners = createFakeWindowListeners()
    const monitor = createNetworkMonitor({
      getSamsungApi: () =>
        ({
          NetworkState: { GATEWAY_DISCONNECTED, GATEWAY_CONNECTED },
          isConnectedToGateway: () => true,
          addNetworkStateChangeListener: () => {
            throw new Error('privilege denied')
          },
          removeNetworkStateChangeListener: () => {},
        }) as SamsungNetworkApi,
      getNavigatorOnline: () => true,
      addWindowListener: listeners.add,
      removeWindowListener: listeners.remove,
    })

    expect(listeners.count()).toBe(2)
    monitor.dispose()
    expect(listeners.count()).toBe(0)
  })
})
