import { describe, expect, it } from 'vitest'
import { handleBackPress, pushBackHandler } from './backHandler'

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
