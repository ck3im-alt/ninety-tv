import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchBackPress, handleBackPress, pushBackHandler, setUnhandledBackHandler } from './backHandler'

// Regression coverage for the LIFO Back-stack (see backHandler.ts's own
// header) — the bug this guards against: a background screen re-rendering
// with a fresh inline `() => {...}` callback (e.g. via useBackHandler)
// reordering the stack so Back fires the wrong handler while a modal is
// open. useBackHandler.ts fixes this by pushing one STABLE wrapper closure
// per mount and routing every call through a ref, so these tests simulate
// exactly that pattern directly against the stack rather than rendering
// React.
describe('Back-handler stack', () => {
  it('gives the most-recently-pushed handler first refusal (LIFO)', () => {
    const calls: string[] = []
    const unregisterScreen = pushBackHandler(() => {
      calls.push('screen')
      return true
    })
    const unregisterModal = pushBackHandler(() => {
      calls.push('modal')
      return true
    })

    expect(handleBackPress()).toBe(true)
    expect(calls).toEqual(['modal'])

    unregisterModal()
    unregisterScreen()
  })

  it('falls through to the next handler down the stack when the top one does not consume the press', () => {
    const calls: string[] = []
    const unregisterScreen = pushBackHandler(() => {
      calls.push('screen')
      return true
    })
    const unregisterModal = pushBackHandler(() => {
      calls.push('modal')
      return false // e.g. a popup that isn't actually open right now
    })

    expect(handleBackPress()).toBe(true)
    expect(calls).toEqual(['modal', 'screen'])

    unregisterModal()
    unregisterScreen()
  })

  it('reports unconsumed when the stack is empty', () => {
    expect(handleBackPress()).toBe(false)
  })

  it('a screen rerendering with a new callback identity does not move its position in the stack (the useBackHandler pattern)', () => {
    // Mirrors exactly what useBackHandler.ts does: registration happens
    // ONCE (a stable wrapper is pushed), and every rerender only updates a
    // ref the wrapper reads from — never pushes/pops again.
    const calls: string[] = []
    const screenCallbackRef = { current: () => (calls.push('screen-v1'), true) as boolean }
    const unregisterScreen = pushBackHandler(() => screenCallbackRef.current())

    // Screen rerenders several times with a brand-new inline callback
    // identity — this must NOT re-push/re-pop the stack entry.
    screenCallbackRef.current = () => (calls.push('screen-v2'), true)
    screenCallbackRef.current = () => (calls.push('screen-v3'), true)

    // Modal opens (registers strictly after the screen, and after all those
    // "rerenders" above).
    const unregisterModal = pushBackHandler(() => {
      calls.push('modal')
      return true
    })

    // Screen rerenders again (new callback identity) AFTER the modal opened
    // — this is the exact scenario the bug report describes. Back must
    // still hit the modal first.
    screenCallbackRef.current = () => (calls.push('screen-v4'), true)
    expect(handleBackPress()).toBe(true)
    expect(calls).toEqual(['modal'])

    // Modal closes — Back now reaches the screen, which must run its LATEST
    // callback (proving the ref-forwarding half of the fix, not just the
    // ordering half).
    unregisterModal()
    calls.length = 0
    expect(handleBackPress()).toBe(true)
    expect(calls).toEqual(['screen-v4'])

    unregisterScreen()
  })

  it('unregister removes exactly one instance of a handler, even if the same function is pushed twice', () => {
    const calls: string[] = []
    const handler = () => {
      calls.push('shared')
      return true
    }
    const unregisterA = pushBackHandler(handler)
    const unregisterB = pushBackHandler(handler)

    unregisterB()
    expect(handleBackPress()).toBe(true)
    expect(calls).toEqual(['shared'])

    unregisterA()
    expect(handleBackPress()).toBe(false)
  })
})

// SAMSUNG RETURN/EXIT CONTRACT (see backHandler.ts's header). The module
// used to call exitApp() itself whenever nothing consumed a Return press,
// with a comment claiming that was what Samsung certification expected —
// it is the opposite: Return at the application root must raise an
// app-owned confirmation, and only the affirmative option in that
// confirmation may quit. These lock in that an unconsumed press asks, and
// never exits.
describe('unhandled Return at the application root', () => {
  afterEach(() => {
    setUnhandledBackHandler(null)
  })

  it('asks the application what to do instead of exiting, when no handler consumes the press', () => {
    const askedToExit = vi.fn()
    setUnhandledBackHandler(askedToExit)

    dispatchBackPress()

    expect(askedToExit).toHaveBeenCalledTimes(1)
  })

  it('does not reach the application fallback while a screen handler consumes the press', () => {
    const askedToExit = vi.fn()
    setUnhandledBackHandler(askedToExit)
    const unregisterScreen = pushBackHandler(() => true)

    dispatchBackPress()

    expect(askedToExit).not.toHaveBeenCalled()
    unregisterScreen()
  })

  it('reaches the application fallback when every registered handler declines', () => {
    const askedToExit = vi.fn()
    setUnhandledBackHandler(askedToExit)
    const unregisterScreen = pushBackHandler(() => false)
    const unregisterModal = pushBackHandler(() => false)

    dispatchBackPress()

    expect(askedToExit).toHaveBeenCalledTimes(1)
    unregisterModal()
    unregisterScreen()
  })

  it('does nothing at all when no fallback is registered — never a silent exit', () => {
    // The regression this guards: a missing/failed registration must not be
    // able to resurrect "quit on the first unhandled Return".
    expect(() => dispatchBackPress()).not.toThrow()
    expect(handleBackPress()).toBe(false)
  })

  it('unregistering the fallback does not clobber a newer one', () => {
    // React effect cleanup order makes this real: a re-registration can run
    // BEFORE the previous registration's cleanup.
    const first = vi.fn()
    const second = vi.fn()
    const disposeFirst = setUnhandledBackHandler(first)
    setUnhandledBackHandler(second)
    disposeFirst()

    dispatchBackPress()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
