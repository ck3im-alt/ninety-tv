import { useEffect } from 'react'
import { pushBackHandler } from './backHandler'

// Register a Back-press handler for as long as the calling component is
// mounted. Return `true` from `onBack` to consume the press (e.g. close an
// overlay); return `false`/falsy to let it fall through to the next handler
// down the stack (eventually exiting the app if nothing consumes it).
export function useBackHandler(onBack: () => boolean, active = true): void {
  useEffect(() => {
    if (!active) return
    return pushBackHandler(onBack)
  }, [onBack, active])
}
