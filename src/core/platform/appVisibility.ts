// Samsung's multitasking requirement: a TV app must implement
// `visibilitychange`. Pressing Home/Source, or another app taking the
// foreground, hides the app WITHOUT unmounting it — nothing else fires, so
// an app that ignores this keeps decoding video, keeps polling and keeps
// timers alive while completely invisible.
//
// ONE subscription point for the whole app. Feature components must not
// each add their own listener: the required behaviour on hide is a single
// app-level decision (tear playback down, return to the originating
// screen), and four components independently deciding it is how you get
// half-torn-down state.
//
// IDEMPOTENCE IS PART OF THE CONTRACT. Samsung documents that
// visibilitychange can also fire during application EXIT, and firmware can
// deliver a repeat `hidden` without an intervening `visible`. Every
// consumer's teardown must therefore be safe to run twice — and this module
// helps by never emitting the same state twice in a row.

export type AppVisibility = 'visible' | 'hidden'

export interface VisibilitySource {
  // `document.visibilityState` in production; a plain getter in tests.
  getVisibility: () => AppVisibility
  addListener: (listener: () => void) => void
  removeListener: (listener: () => void) => void
}

function defaultVisibilitySource(): VisibilitySource {
  return {
    getVisibility: () => {
      if (typeof document === 'undefined') return 'visible'
      return document.visibilityState === 'hidden' ? 'hidden' : 'visible'
    },
    addListener: (listener) => {
      if (typeof document === 'undefined') return
      document.addEventListener('visibilitychange', listener)
    },
    removeListener: (listener) => {
      if (typeof document === 'undefined') return
      document.removeEventListener('visibilitychange', listener)
    },
  }
}

export interface AppVisibilityHandlers {
  onHidden?: () => void
  onVisible?: () => void
}

// Returns an unsubscribe function. Emits only on genuine transitions, so a
// duplicated firmware event cannot run teardown (or resume) twice.
export function observeAppVisibility(handlers: AppVisibilityHandlers, source: VisibilitySource = defaultVisibilitySource()): () => void {
  let current = source.getVisibility()

  const onChange = () => {
    const next = source.getVisibility()
    if (next === current) return
    current = next
    if (next === 'hidden') handlers.onHidden?.()
    else handlers.onVisible?.()
  }

  source.addListener(onChange)
  return () => source.removeListener(onChange)
}
