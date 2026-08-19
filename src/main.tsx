import { createRoot } from 'react-dom/client'
import { init } from '@noriginmedia/norigin-spatial-navigation'
import { attachGlobalBackListener, registerTizenRemoteKeys } from './core/platform'
import { startLongTaskObserver } from './core/perf/devPerf'
import './index.css'
import App from './App.tsx'

registerTizenRemoteKeys()
attachGlobalBackListener()
init({
  debug: false,
  visualDebug: false,
})
startLongTaskObserver()

// No <StrictMode> — its dev-only double-mount corrupts
// norigin-spatial-navigation's internal focus-tree registry, which makes
// arrow-key/remote navigation silently do nothing while everything else
// still appears to render normally.
createRoot(document.getElementById('root')!).render(<App />)
