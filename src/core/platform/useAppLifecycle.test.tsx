// @vitest-environment jsdom
//
// The app's central multitasking implementation (see useAppLifecycle.ts).
// Driven through REAL `visibilitychange` events on a real document, because
// that is the production path and an injected fake would not prove it.
//
// Samsung requirements covered here:
//   - hidden during playback performs the same action as Return during
//     playback (asserted as: the caller's OWN return-from-playback action
//     is the thing that runs)
//   - the screensaver is never left disabled by a hidden app
//   - connectivity is re-checked on resume, because it can change while
//     hidden
//   - focus is restored on resume, without reloading the app
//   - teardown is idempotent, because visibilitychange also fires on exit
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppLifecycle } from './useAppLifecycle'
import { playbackScreenSaver } from './screenSaver'
import type { AppVisibility } from './appVisibility'

function setDocumentVisibility(value: AppVisibility) {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true })
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

function renderLifecycle() {
  const onHidden = vi.fn()
  const onVisible = vi.fn()
  const recheckNetwork = vi.fn()
  function Harness() {
    useAppLifecycle({ onHidden, onVisible, recheckNetwork })
    return null
  }
  render(<Harness />)
  return { onHidden, onVisible, recheckNetwork }
}

afterEach(() => {
  cleanup()
  setDocumentVisibility('visible')
  playbackScreenSaver.releaseAll()
  vi.restoreAllMocks()
})

describe('useAppLifecycle', () => {
  it('runs the return-from-playback action when the app is hidden', () => {
    const { onHidden } = renderLifecycle()

    setDocumentVisibility('hidden')

    expect(onHidden).toHaveBeenCalledTimes(1)
  })

  it('re-enables the screensaver when the app is hidden, even mid-playback', () => {
    // A hidden app must never be the reason the TV's screensaver stays off.
    renderLifecycle()
    playbackScreenSaver.acquire()
    playbackScreenSaver.acquire()
    expect(playbackScreenSaver.getActiveCount()).toBe(2)

    setDocumentVisibility('hidden')

    expect(playbackScreenSaver.getActiveCount()).toBe(0)
  })

  it('tears down before releasing the screensaver, so a slow unmount cannot leave it disabled', () => {
    const order: string[] = []
    const releaseSpy = vi.spyOn(playbackScreenSaver, 'releaseAll').mockImplementation(() => order.push('releaseAll'))
    function Harness() {
      useAppLifecycle({
        onHidden: () => order.push('onHidden'),
        onVisible: () => {},
        recheckNetwork: () => {},
      })
      return null
    }
    render(<Harness />)

    setDocumentVisibility('hidden')

    expect(order).toEqual(['onHidden', 'releaseAll'])
    releaseSpy.mockRestore()
  })

  it('re-checks connectivity on resume, before restoring focus', () => {
    // Samsung documents that network state can change while hidden, so the
    // listener alone is not sufficient.
    const order: string[] = []
    function Harness() {
      useAppLifecycle({
        onHidden: () => {},
        onVisible: () => order.push('onVisible'),
        recheckNetwork: () => order.push('recheckNetwork'),
      })
      return null
    }
    render(<Harness />)

    setDocumentVisibility('hidden')
    setDocumentVisibility('visible')

    expect(order).toEqual(['recheckNetwork', 'onVisible'])
  })

  it('does not run teardown twice when visibilitychange repeats during exit', () => {
    const { onHidden } = renderLifecycle()

    setDocumentVisibility('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(onHidden).toHaveBeenCalledTimes(1)
  })

  it('does nothing on resume if the app was never hidden', () => {
    const { onVisible, recheckNetwork } = renderLifecycle()

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(onVisible).not.toHaveBeenCalled()
    expect(recheckNetwork).not.toHaveBeenCalled()
  })

  it('always calls the CURRENT handlers, not the ones captured at mount', () => {
    // App passes fresh closures on every navigation (they capture the
    // current screen). Subscribing once but firing a stale closure would
    // return the viewer to whichever screen was up when the app started.
    const calls: string[] = []
    function Harness({ screen }: { screen: string }) {
      useAppLifecycle({
        onHidden: () => calls.push(`hidden:${screen}`),
        onVisible: () => {},
        recheckNetwork: () => {},
      })
      return null
    }
    const { rerender } = render(<Harness screen="home" />)
    rerender(<Harness screen="player" />)

    setDocumentVisibility('hidden')

    expect(calls).toEqual(['hidden:player'])
  })

  it('removes its listener on unmount', () => {
    const { onHidden } = renderLifecycle()

    cleanup()
    setDocumentVisibility('hidden')

    expect(onHidden).not.toHaveBeenCalled()
  })
})
