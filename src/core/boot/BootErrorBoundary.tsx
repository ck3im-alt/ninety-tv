import { Component, type ReactNode } from 'react'
import { PERF_DIAGNOSTICS_ENABLED } from '../perf/devPerf'

// The last line of defence for a render-phase throw anywhere in the app.
//
// It used to `return null`, which meant a fatal crash after startup left
// the viewer looking at a completely black screen with no branding, no
// explanation and nothing to press — on a TV, indistinguishable from the
// set having lost input. Now it renders a minimal, honest crash state.
//
// DELIBERATELY DEPENDENCY-FREE. No design-system component, no
// spatial-navigation hook, no feature import: whatever just threw is
// somewhere in that tree, and a fallback that re-enters it can throw again
// during its own render — which React treats as an unrecoverable boundary
// failure and responds to by unmounting the entire root, i.e. straight back
// to the black screen this exists to prevent. It styles itself with
// .ninety-boot-fallback, defined inline in index.html (a CLASS so this and
// index.html's pre-mount panel share one look without sharing a DOM id),
// which means it does not depend on the app's CSS bundle having loaded
// either.
//
// Lives in its own module rather than inside main.tsx so it can be tested:
// importing main.tsx executes createRoot() against a real document.
export class BootErrorBoundary extends Component<
  { children: ReactNode; onError?: (error: Error) => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error)
    // Console only — never on screen in a normal build.
    console.error('[ninety] fatal render error', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="ninety-boot-fallback" data-visible="true" role="alert" aria-live="assertive">
        <div className="brand">N I N E T Y</div>
        <h1>Something went wrong</h1>
        <p>Ninety ran into a problem and needs to restart.</p>
        {/* autoFocus so the remote's OK key works immediately: norigin's
            focus tree belongs to the tree that just crashed and cannot be
            relied on to hand focus anywhere. */}
        <button type="button" autoFocus onClick={() => window.location.reload()}>
          Restart
        </button>
        {/* Stack traces stay behind the same diagnostics gate as every
            other developer surface. A beta tester must never be shown one,
            and it can carry a provider URL — credentials included — out of
            a failed request. */}
        {PERF_DIAGNOSTICS_ENABLED && (
          <pre style={{ maxWidth: '80%', overflow: 'auto', fontSize: 16, color: '#f88', textAlign: 'left' }}>
            {this.state.error.stack ?? this.state.error.message}
          </pre>
        )}
      </div>
    )
  }
}
