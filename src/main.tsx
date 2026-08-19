import { createRoot } from 'react-dom/client'
import { init } from '@noriginmedia/norigin-spatial-navigation'
import { attachGlobalBackListener, registerTizenRemoteKeys } from './core/platform'
import './index.css'
import App from './App.tsx'

// TEMPORARY BOOT DIAGNOSTIC — remove alongside index.html's #boot-diag script.
function bootDiag(label: string) {
  const el = document.getElementById('boot-diag')
  if (el) el.textContent += '\n[main.tsx] ' + label
}
// window.onerror reports cross-origin-tainted scripts (which Vite's default
// `crossorigin` attribute on the module script tag causes) as a redacted
// "Script error." with no file/line/stack — local try/catch isn't subject
// to that redaction, so wrap each suspect call individually to get the real
// error.
function bootTry(label: string, fn: () => void) {
  try {
    fn()
    bootDiag(label + ' OK')
  } catch (err) {
    bootDiag(label + ' THREW: ' + (err instanceof Error ? (err.stack ?? err.message) : String(err)))
  }
}
bootDiag('entry module executing')

bootTry('registerTizenRemoteKeys()', registerTizenRemoteKeys)
bootTry('attachGlobalBackListener()', attachGlobalBackListener)
bootTry('norigin init()', () =>
  init({
    debug: false,
    visualDebug: false,
  }),
)

bootDiag('calling createRoot().render()')

// No <StrictMode> — its dev-only double-mount corrupts
// norigin-spatial-navigation's internal focus-tree registry, which makes
// arrow-key/remote navigation silently do nothing while everything else
// still appears to render normally.
try {
  createRoot(document.getElementById('root')!).render(<App />)
  bootDiag('render() call returned without throwing')
} catch (err) {
  bootDiag('render() threw: ' + (err instanceof Error ? (err.stack ?? err.message) : String(err)))
}
