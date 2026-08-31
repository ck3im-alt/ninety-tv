// @vitest-environment jsdom
//
// The Samsung Return/Exit requirement, driven through the real components
// and the real Back stack rather than mocked at the seam — the point of
// this feature is the interaction between backHandler.ts, the modal focus
// scope and the dialog, and a mock of any one of those would test the mock.
//
// Requirement being covered (Samsung Smart TV quality requirements):
//   - Return on a root screen shows an app-owned exit confirmation.
//   - Return on a detail page goes back a page instead.
//   - Only the affirmative option calls
//     tizen.application.getCurrentApplication().exit().
//   - Return while the confirmation is open cancels it.
import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrentFocusKey, init, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { dispatchBackPress, setUnhandledBackHandler, useBackHandler } from '../../core/platform'
import { ExitConfirmDialog, EXIT_CANCEL_FOCUS_KEY, EXIT_CONFIRM_FOCUS_KEY } from './ExitConfirmDialog'

// Stands in for App: owns the "was exit requested" state, registers the
// unhandled-Return fallback exactly as App does, and renders whichever
// screen the test asks for underneath.
function Harness({ screenHasBackHandler, onExit }: { screenHasBackHandler: boolean; onExit: () => void }) {
  const [exitOpen, setExitOpen] = useState(false)
  useEffect(() => setUnhandledBackHandler(() => setExitOpen((open) => (open ? open : true))), [])
  return (
    <>
      <FakeScreen hasBackHandler={screenHasBackHandler} />
      {/* Mouse-only escape hatch for the one test that needs the dialog
          raised over a screen which consumes Back itself. */}
      <button data-testid="force-open" onClick={() => setExitOpen(true)}>
        open
      </button>
      {exitOpen && <ExitConfirmDialog onCancel={() => setExitOpen(false)} onConfirm={onExit} />}
    </>
  )
}

const SCREEN_BUTTON_FOCUS_KEY = 'fake-screen-button'
const backPressesConsumedByScreen = vi.fn()

function FakeScreen({ hasBackHandler }: { hasBackHandler: boolean }) {
  const { ref } = useFocusable({ focusKey: SCREEN_BUTTON_FOCUS_KEY })
  // A DETAIL page registers a handler and consumes Return (navigating back
  // a page); a ROOT screen — Home, in this app — registers nothing.
  useBackHandler(() => {
    backPressesConsumedByScreen()
    return true
  }, hasBackHandler)
  return (
    <button ref={ref} data-testid="screen-button">
      Something on the screen
    </button>
  )
}

function pressBack() {
  act(() => {
    dispatchBackPress()
  })
}

// norigin's setFocus is ASYNCHRONOUS — it returns a promise and the focus
// tree is not updated until it settles. Every assertion about where focus
// ended up, and every keypress that depends on focus having moved first,
// has to let those microtasks run.
async function settleFocus() {
  await act(async () => {})
}

async function pressEnterOnFocused() {
  await settleFocus()
  // norigin routes Enter through a real keydown on window.
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13, bubbles: true }))
  })
}

describe('Samsung Return/Exit behaviour', () => {
  beforeEach(() => {
    init({ debug: false, visualDebug: false })
    backPressesConsumedByScreen.mockClear()
  })

  afterEach(async () => {
    // Close a still-open confirmation BEFORE unmounting. cleanup() would
    // otherwise tear down the dialog and the screen underneath in the same
    // pass, and useModalFocusScope's focus restore — which is async —
    // would then resolve against a node that has just gone. That is purely
    // a teardown artifact (in the running app the screen always outlives
    // the dialog), but it surfaces as an unhandled rejection that would
    // make this file look like it is failing when it is not.
    if (screen.queryByText('Exit Ninety?')) pressBack()
    await settleFocus()

    // This project does not enable vitest `globals`, so testing-library's
    // auto-cleanup is not registered — unmounting explicitly is the
    // established convention here (see SettingsScreen.test.tsx). It matters
    // more than usual in this file: a leftover Harness keeps its Back
    // handler on the shared LIFO stack, which would consume the very press
    // the next test needs to reach the application fallback.
    cleanup()
    // ...and let the focus restore that unmounting just scheduled settle
    // while the test is still the active one, rather than landing in
    // whichever test happens to run next.
    await settleFocus()
    setUnhandledBackHandler(null)
    vi.restoreAllMocks()
  })

  it('a detail page consumes Return itself and never raises the exit confirmation', () => {
    const onExit = vi.fn()
    render(<Harness screenHasBackHandler onExit={onExit} />)

    pressBack()

    expect(backPressesConsumedByScreen).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Exit Ninety?')).toBeNull()
    expect(onExit).not.toHaveBeenCalled()
  })

  it('Return at the application root raises the confirmation instead of exiting', () => {
    const onExit = vi.fn()
    render(<Harness screenHasBackHandler={false} onExit={onExit} />)

    pressBack()

    expect(screen.getByText('Exit Ninety?')).toBeTruthy()
    // The whole point: raising the dialog must not itself quit.
    expect(onExit).not.toHaveBeenCalled()
  })

  it('opens with Cancel focused, not Exit', async () => {
    render(<Harness screenHasBackHandler={false} onExit={vi.fn()} />)
    pressBack()
    await settleFocus()

    expect(getCurrentFocusKey()).toBe(EXIT_CANCEL_FOCUS_KEY)
  })

  it('OK on Cancel closes the confirmation without exiting, and restores the previous focus', async () => {
    const onExit = vi.fn()
    render(<Harness screenHasBackHandler={false} onExit={onExit} />)

    act(() => {
      void setFocus(SCREEN_BUTTON_FOCUS_KEY)
    })
    await settleFocus()
    pressBack()
    await settleFocus()
    expect(getCurrentFocusKey()).toBe(EXIT_CANCEL_FOCUS_KEY)

    await pressEnterOnFocused()

    expect(screen.queryByText('Exit Ninety?')).toBeNull()
    expect(onExit).not.toHaveBeenCalled()
    // Cancelling must put the viewer back exactly where they were —
    // useModalFocusScope's opener capture/restore.
    await settleFocus()
    expect(getCurrentFocusKey()).toBe(SCREEN_BUTTON_FOCUS_KEY)
  })

  it('OK on Exit exits exactly once', async () => {
    const onExit = vi.fn()
    render(<Harness screenHasBackHandler={false} onExit={onExit} />)
    pressBack()
    await settleFocus()

    act(() => {
      void setFocus(EXIT_CONFIRM_FOCUS_KEY)
    })
    await pressEnterOnFocused()

    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('Return while the confirmation is open cancels it rather than exiting', () => {
    const onExit = vi.fn()
    render(<Harness screenHasBackHandler={false} onExit={onExit} />)
    pressBack()
    expect(screen.getByText('Exit Ninety?')).toBeTruthy()

    pressBack()

    expect(screen.queryByText('Exit Ninety?')).toBeNull()
    expect(onExit).not.toHaveBeenCalled()
  })

  it('the Return that closes the confirmation is not also seen by the screen underneath', async () => {
    // The dialog registers ABOVE the screen on the LIFO stack, so its own
    // Back handler consumes the closing press — a screen underneath that
    // DOES have a handler must not also navigate back on that same press.
    //
    // Opened through the harness's own control rather than by pressing
    // Back, because a screen with a handler consumes Back by definition;
    // the confirmation is reachable over such a screen only when something
    // else raises it (which is the situation being tested).
    render(<Harness screenHasBackHandler onExit={vi.fn()} />)
    act(() => {
      void setFocus(SCREEN_BUTTON_FOCUS_KEY)
    })
    await settleFocus()
    fireEvent.click(screen.getByTestId('force-open'))
    await settleFocus()
    expect(screen.getByText('Exit Ninety?')).toBeTruthy()
    backPressesConsumedByScreen.mockClear()

    pressBack()
    await settleFocus()

    expect(screen.queryByText('Exit Ninety?')).toBeNull()
    expect(backPressesConsumedByScreen).not.toHaveBeenCalled()
  })
})
