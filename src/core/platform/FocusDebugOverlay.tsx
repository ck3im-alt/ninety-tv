import { useEffect, useState } from 'react'
import { getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation'
import { getBackStackDepth } from './backHandler'

// DEV-only diagnostic for exactly the class of bug this whole hardening
// pass is about: "focus silently isn't where you think it is". Polls (not
// per-frame — see POLL_MS) rather than subscribing to every focus/blur
// event, since this only needs to be readable by a human, not real-time.
// Never imported/rendered outside `import.meta.env.DEV` call sites (see
// App.tsx) — production builds tree-shake this out entirely, same
// precedent as AdminPanel.
const POLL_MS = 250

interface Props {
  screen?: string
  region?: string
  overlay?: string | null
}

export function FocusDebugOverlay({ screen, region, overlay }: Props) {
  const [focusKey, setFocusKeyState] = useState(() => getCurrentFocusKey())
  const [backDepth, setBackDepth] = useState(() => getBackStackDepth())

  useEffect(() => {
    const id = setInterval(() => {
      setFocusKeyState(getCurrentFocusKey())
      setBackDepth(getBackStackDepth())
    }, POLL_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        left: 8,
        bottom: 8,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.75)',
        color: '#7CFC9C',
        font: '12px/1.5 monospace',
        padding: '6px 10px',
        borderRadius: 6,
        pointerEvents: 'none',
        whiteSpace: 'pre',
      }}
    >
      {`focus: ${focusKey}\nscreen: ${screen ?? '—'}${region ? `  region: ${region}` : ''}${overlay ? `  overlay: ${overlay}` : ''}\nback stack: ${backDepth}`}
    </div>
  )
}
