// Samsung screensaver coordination.
//
// The requirement: the TV screensaver must be DISABLED while video is
// actively playing (otherwise it activates over a match nobody is pressing
// buttons during) and RE-ENABLED the moment playback stops or pauses.
//
// WHY THIS IS A COORDINATOR AND NOT A CALL INSIDE THE PLAYER. Multiview
// runs up to four independent player sessions, each with its own
// usePlayerSession/PlayerSessionController lifecycle. If each one toggled
// `webapis.appcommon.setScreenSaver()` on its own, disposing ONE pane would
// re-enable the screensaver while the other three panes are still playing —
// the screensaver would then come up over live video, which is precisely
// the failure the requirement exists to prevent. There is exactly one
// system-wide screensaver setting, so there must be exactly one owner of
// it.
//
// The model is a lease/reference count:
//   0 active playback leases  -> SCREEN_SAVER_ON  (system default restored)
//   1 or more                 -> SCREEN_SAVER_OFF
//
// Only the transitions between those two are pushed to the platform, so
// four panes starting one after another produce ONE setScreenSaver call,
// not four.
import { getSamsungAppCommonApi } from './samsungProductApi'
import type { SamsungAppCommonApi } from './samsungProductApi'

export interface PlaybackScreenSaverCoordinator {
  // Called when a session transitions INTO actively playing. Returns a
  // release function; calling it more than once is a no-op, which is what
  // makes "release on pause, and again on dispose, and again on unmount"
  // safe to write in the obvious way.
  acquire(): () => void
  // Drops every outstanding lease and restores SCREEN_SAVER_ON. Used when
  // the app is hidden (Samsung's multitasking requirement tears playback
  // down anyway, and a hidden app must never leave the system screensaver
  // disabled) and at app teardown.
  releaseAll(): void
  // Test/diagnostic only.
  getActiveCount(): number
}

export interface ScreenSaverCoordinatorOptions {
  getAppCommonApi?: () => SamsungAppCommonApi | null
}

export function createPlaybackScreenSaverCoordinator(options: ScreenSaverCoordinatorOptions = {}): PlaybackScreenSaverCoordinator {
  const { getAppCommonApi = getSamsungAppCommonApi } = options

  let activeCount = 0
  // Starts null rather than 'on' so the FIRST transition is always pushed
  // to the platform. Assuming the system boots with the screensaver enabled
  // would be an assumption about state we did not set.
  let lastPushed: 'on' | 'off' | null = null

  function push(next: 'on' | 'off'): void {
    // Repeated identical state must never hammer the API — see the module
    // header's four-pane case.
    if (next === lastPushed) return
    const api = safely(() => getAppCommonApi(), null)
    // No Samsung runtime (browser dev, unit tests, non-Samsung target):
    // a clean no-op. `lastPushed` is still advanced so the coordinator's
    // own bookkeeping stays consistent and testable either way.
    lastPushed = next
    if (!api) return
    safely(() => {
      const state = next === 'off' ? api.AppCommonScreenSaverState.SCREEN_SAVER_OFF : api.AppCommonScreenSaverState.SCREEN_SAVER_ON
      api.setScreenSaver(state)
    }, undefined)
  }

  function sync(): void {
    push(activeCount > 0 ? 'off' : 'on')
  }

  return {
    acquire() {
      activeCount++
      sync()
      let released = false
      return () => {
        if (released) return
        released = true
        activeCount = Math.max(0, activeCount - 1)
        sync()
      }
    },

    releaseAll() {
      activeCount = 0
      sync()
    },

    getActiveCount: () => activeCount,
  }
}

// A Samsung API failure must be logged and swallowed — never allowed to
// propagate into playback. Losing the screensaver override is a degraded
// experience; throwing out of a player state transition is a dead app.
function safely<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch (err) {
    console.warn('[screenSaver] Samsung setScreenSaver call failed', err)
    return fallback
  }
}

// THE app-wide instance. A module singleton here is correct (unlike the
// network monitor, which is per-App-mount): the thing being coordinated is
// a single system-wide setting, and the sessions that need to coordinate
// are spread across independent component trees (the full-screen player and
// every Multiview pane) with no common owner below App.
export const playbackScreenSaver = createPlaybackScreenSaverCoordinator()
