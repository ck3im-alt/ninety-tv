import { createRoot } from 'react-dom/client'
import { init } from '@noriginmedia/norigin-spatial-navigation'
import { attachGlobalBackListener, registerTizenRemoteKeys } from './core/platform'
import { startLongTaskObserver } from './core/perf/devPerf'
import { BootErrorBoundary } from './core/boot/BootErrorBoundary'
import './index.css'
import App from './App.tsx'

// Boot checkpoint logging. Writes into index.html's diagnostic overlay,
// which only EXISTS in a diagnostic build (`VITE_PERF_DIAGNOSTICS=1`, or
// the dev server) — in a normal beta build every call here is a no-op,
// because index.html installs __ninetyBootLog as an empty sink rather than
// leaving it undefined. See index.html for the two-audience split.
declare global {
  interface Window {
    __ninetyBootLog?: (msg: string) => void
    __ninetyBootMounted?: () => void
    __ninetyShowBootFallback?: (message?: string) => void
  }
}
const bootLog = (msg: string) => window.__ninetyBootLog?.(msg)

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
    <BootErrorBoundary onError={(error) => bootLog('REACT RENDER ERROR: ' + (error.stack ?? error.message))}>
      <App />
    </BootErrorBoundary>,
  )
  bootLog('render() call returned OK')
} catch (err) {
  bootLog('SYNC THROW during boot: ' + (err instanceof Error ? (err.stack ?? err.message) : String(err)))
  // A synchronous throw here means React never got as far as rendering, so
  // the boundary above cannot help and #root stays empty. Hand over to
  // index.html's pre-mount panel rather than re-throwing into a black
  // screen — but still re-throw afterwards so the failure is not swallowed
  // (it reaches window.onerror, and the console in a diagnostic build).
  window.__ninetyShowBootFallback?.()
  throw err
}
