import { LoadingScreen } from './LoadingScreen'

// What shows while a lazy screen's chunk is still being fetched.
//
// The Suspense boundary in App.tsx used `fallback={null}`. On a fast
// desktop dev server that is very nearly invisible; on a TV loading a
// chunk off the widget's own storage under memory pressure it is a
// black-looking gap with the top bar still drawn — which reads as the app
// having died, and is exactly the moment a viewer starts pressing keys.
//
// It is immediate by design. Even a short empty frame reads as a broken app
// on a television, especially during first-run setup. A consistent branded
// transition is preferable to ever exposing an empty shell while a route's
// code or content is not ready.
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
  return <LoadingScreen title="Loading NINETY" detail="Getting the next screen ready…" />
}
