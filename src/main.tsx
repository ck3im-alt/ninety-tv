import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { init } from '@noriginmedia/norigin-spatial-navigation'
import { attachGlobalBackListener, registerTizenRemoteKeys } from './core/platform'
import { startLongTaskObserver } from './core/perf/devPerf'
import './index.css'
import App from './App.tsx'

// TEMPORARY, 2026-08-19: checkpoint logging into the boot-diag overlay
// (index.html) while diagnosing a reported blue-screen-on-startup on the
// physical Tizen TV. Remove alongside the overlay once resolved.
declare global {
  interface Window {
    __ninetyBootLog?: (msg: string) => void
    __ninetyBootMounted?: () => void
  }
}
const bootLog = (msg: string) => window.__ninetyBootLog?.(msg)

// Catches a React render-phase throw that would otherwise unmount the whole
// tree silently (no ErrorBoundary exists elsewhere in this app) — without
// this, a crash inside App/its children reports only to the console, which
// isn't reachable on this hardware.
class BootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    bootLog('REACT RENDER ERROR: ' + (error.stack ?? error.message))
  }
  render() {
    if (this.state.error) return null
    return this.props.children
  }
}

try {
  bootLog('registerTizenRemoteKeys...')
  registerTizenRemoteKeys()
  bootLog('attachGlobalBackListener...')
  attachGlobalBackListener()
  bootLog('norigin init...')
  init({
    debug: false,
    visualDebug: false,
  })
  bootLog('startLongTaskObserver...')
  startLongTaskObserver()

  bootLog('createRoot + render...')
  // No <StrictMode> — its dev-only double-mount corrupts
  // norigin-spatial-navigation's internal focus-tree registry, which makes
  // arrow-key/remote navigation silently do nothing while everything else
  // still appears to render normally.
  createRoot(document.getElementById('root')!).render(
    <BootErrorBoundary>
      <App />
    </BootErrorBoundary>,
  )
  bootLog('render() call returned OK')
} catch (err) {
  bootLog('SYNC THROW during boot: ' + (err instanceof Error ? (err.stack ?? err.message) : String(err)))
  throw err
}
