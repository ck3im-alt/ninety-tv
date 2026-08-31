// @vitest-environment jsdom
//
// Samsung's multitasking requirement, driven through REAL visibilitychange
// events on a real document as well as through an injected source — the
// production path is `document.visibilityState` + the DOM event, so at
// least one test has to prove that path actually works rather than only
// proving the injected fake does.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeAppVisibility } from './appVisibility'
import type { AppVisibility, VisibilitySource } from './appVisibility'

function createFakeSource(initial: AppVisibility = 'visible') {
  let visibility = initial
  const listeners = new Set<() => void>()
  const source: VisibilitySource = {
    getVisibility: () => visibility,
    addListener: (listener) => {
      listeners.add(listener)
    },
    removeListener: (listener) => {
      listeners.delete(listener)
    },
  }
  return {
    source,
    listenerCount: () => listeners.size,
    set: (next: AppVisibility) => {
      visibility = next
      for (const listener of [...listeners]) listener()
    },
    // Fires the event WITHOUT a state change — firmware can do this, and
    // it must not run teardown a second time.
    fireWithoutChange: () => {
      for (const listener of [...listeners]) listener()
    },
  }
}

// jsdom does not let visibilityState be assigned directly.
function setDocumentVisibility(value: AppVisibility) {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('app visibility (Samsung multitasking)', () => {
  afterEach(() => {
    setDocumentVisibility('visible')
    vi.restoreAllMocks()
  })

  it('calls onHidden when the app is backgrounded and onVisible when it returns', () => {
    const fake = createFakeSource()
    const onHidden = vi.fn()
    const onVisible = vi.fn()
    const stop = observeAppVisibility({ onHidden, onVisible }, fake.source)

    fake.set('hidden')
    fake.set('visible')

    expect(onHidden).toHaveBeenCalledTimes(1)
    expect(onVisible).toHaveBeenCalledTimes(1)
    stop()
  })

  it('does not re-run teardown when a repeat hidden event arrives with no state change', () => {
    // Samsung documents that visibilitychange also fires during EXIT, and
    // firmware can deliver a duplicate. Teardown has to be idempotent, and
    // this module contributes by only emitting genuine transitions.
    const fake = createFakeSource()
    const onHidden = vi.fn()
    const stop = observeAppVisibility({ onHidden }, fake.source)

    fake.set('hidden')
    fake.fireWithoutChange()
    fake.fireWithoutChange()

    expect(onHidden).toHaveBeenCalledTimes(1)
    stop()
  })

  it('does not fire onVisible for an app that was already visible', () => {
    const fake = createFakeSource('visible')
    const onVisible = vi.fn()
    const stop = observeAppVisibility({ onVisible }, fake.source)

    fake.fireWithoutChange()

    expect(onVisible).not.toHaveBeenCalled()
    stop()
  })

  it('removes its listener when stopped (no leak across App mounts)', () => {
    const fake = createFakeSource()
    const onHidden = vi.fn()
    const stop = observeAppVisibility({ onHidden }, fake.source)
    expect(fake.listenerCount()).toBe(1)

    stop()

    expect(fake.listenerCount()).toBe(0)
    fake.set('hidden')
    expect(onHidden).not.toHaveBeenCalled()
  })

  it('works against real document visibilitychange events, not just the injected fake', () => {
    const onHidden = vi.fn()
    const onVisible = vi.fn()
    const stop = observeAppVisibility({ onHidden, onVisible })

    setDocumentVisibility('hidden')
    expect(onHidden).toHaveBeenCalledTimes(1)

    setDocumentVisibility('visible')
    expect(onVisible).toHaveBeenCalledTimes(1)

    stop()
    setDocumentVisibility('hidden')
    expect(onHidden).toHaveBeenCalledTimes(1)
  })
})
