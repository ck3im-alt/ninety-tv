import { LoadingScreen } from './LoadingScreen'
import { useDeferredBusy } from './useDeferredBusy'

// What shows while a lazy screen's chunk is still being fetched.
//
// The Suspense boundary in App.tsx used `fallback={null}`. On a fast
// desktop dev server that is very nearly invisible; on a TV loading a
// chunk off the widget's own storage under memory pressure it is a
// black-looking gap with the top bar still drawn — which reads as the app
// having died, and is exactly the moment a viewer starts pressing keys.
//
// WHY IT IS DELAYED RATHER THAN IMMEDIATE. Most of these chunks resolve in
// a handful of milliseconds. Mounting a full loading panel for that is
// worse than mounting nothing: a panel that appears and vanishes inside one
// or two frames is a flash, not feedback. useDeferredBusy's show delay
// means the common fast case renders exactly what it renders today —
// nothing at all — and the panel only appears for a transition genuinely
// slow enough to need explaining. (Its minimum-visible window does not
// apply here: Suspense unmounts this the instant the chunk resolves.)
//
// FOCUS. This registers no focusable node and no norigin focus context, so
// it cannot steal spatial focus or leave a duplicate node behind for the
// screen arriving after it — the arriving screen sets focus itself, exactly
// as it does today. LoadingScreen does swallow remote keypresses while
// mounted, which is the behaviour wanted here too: it stops a viewer's
// impatient second press from queueing a navigation against a screen that
// has not rendered yet.
//
// No progress indication, real or invented: a dynamic import exposes no
// progress, so anything shown would be a lie.
export function LazyScreenFallback() {
  const show = useDeferredBusy(true)
  if (!show) return null
  return <LoadingScreen title="Loading" />
}
