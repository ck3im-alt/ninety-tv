import { useEffect, useRef } from 'react'
import { observeAppVisibility } from './appVisibility'
import type { VisibilitySource } from './appVisibility'
import { playbackScreenSaver } from './screenSaver'

// THE app's multitasking implementation, in one place. App.tsx calls this
// exactly once; no feature component adds a visibilitychange listener of
// its own.
//
// Samsung's requirements, and where each is met:
//
//   "TV apps must implement multitasking using visibilitychange"
//       -> observeAppVisibility, one document listener, cleaned up on
//          unmount.
//   "When hidden during media playback, perform the same semantic
//    behavior as Return during playback"
//       -> onHidden is handed the caller's OWN return-from-playback
//          action, so the hidden path and the Back path are the same
//          function rather than two implementations (see App.tsx).
//   "The screensaver must be re-enabled when playback stops"
//       -> playbackScreenSaver.releaseAll() here, so a hidden app can
//          never leave the system screensaver disabled even if a teardown
//          somewhere else is slow or incomplete.
//   "Network changes can happen while the application is hidden"
//       -> onVisible re-reads connectivity through the caller's recheck.
//
// IDEMPOTENCE. Samsung documents that visibilitychange also fires during
// application exit, so everything reachable from onHidden must tolerate
// running twice. Two layers make that true: observeAppVisibility only
// emits genuine transitions, and releaseAll()/the caller's teardown are
// each individually idempotent.

export interface AppLifecycleHandlers {
  // "Return from playback", supplied by the caller. Called on every hide,
  // including when no playback is active — the caller decides whether that
  // is a no-op, because only it knows which screen is up.
  onHidden: () => void
  // Called on resume, AFTER connectivity has been re-read. The caller uses
  // this to restore a valid focus target; it must not reload the app or
  // restart a stream.
  onVisible: () => void
  // Re-reads platform connectivity (see useNetworkStatus's `recheck`).
  recheckNetwork: () => void
  // Injectable for tests; production uses document.visibilityState.
  visibilitySource?: VisibilitySource
}

export function useAppLifecycle({ onHidden, onVisible, recheckNetwork, visibilitySource }: AppLifecycleHandlers): void {
  // Handlers are read through refs so the document listener is subscribed
  // ONCE for the app's lifetime. Re-subscribing on every navigation (which
  // is what a dependency on these callbacks would cause, since App passes
  // fresh closures that capture the current screen) would be pointless
  // churn — and worse, it would mean the handler that fires is whichever
  // one happened to be captured, rather than the current one.
  const handlersRef = useRef({ onHidden, onVisible, recheckNetwork })
  handlersRef.current = { onHidden, onVisible, recheckNetwork }

  const sourceRef = useRef(visibilitySource)

  useEffect(() => {
    return observeAppVisibility(
      {
        onHidden: () => {
          // Order matters: tear playback down first (which releases the
          // leases those sessions hold), then force the system-wide
          // screensaver setting back on regardless. The second step is not
          // redundant — React has not necessarily finished unmounting the
          // player when this returns, and "hidden app with the screensaver
          // still suppressed" is the state Samsung's requirement forbids.
          handlersRef.current.onHidden()
          playbackScreenSaver.releaseAll()
        },
        onVisible: () => {
          handlersRef.current.recheckNetwork()
          handlersRef.current.onVisible()
        },
      },
      sourceRef.current,
    )
  }, [])
}
