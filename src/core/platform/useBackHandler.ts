import { useEffect, useRef } from 'react'
import { pushBackHandler } from './backHandler'

// Register a Back-press handler for as long as the calling component is
// mounted (and `active` is true). Return `true` from `onBack` to consume the
// press (e.g. close an overlay); return `false`/falsy to let it fall through
// to the next handler down the stack (eventually exiting the app if nothing
// consumes it).
//
// Callers overwhelmingly pass an inline `() => {...}` — a fresh function
// identity on every render. The stack in backHandler.ts is LIFO/order-
// sensitive (a modal's handler must stay above the screen's), so pushing a
// NEW handler and popping the old one on every single render — which is what
// happens if this effect depends on `onBack` itself — can reorder the stack
// on a plain rerender that has nothing to do with mounting/unmounting: a
// background screen rerendering after a modal opened would move its handler
// back to the top, and Back would wrongly close the screen instead of the
// modal.
//
// Fixed by registering one STABLE wrapper closure per mount/`active`
// transition (via the effect below, keyed only on `active`) that always
// calls whatever `onBack` currently is via a ref — so the stack position is
// set once and never moves just because a parent rerendered.
export function useBackHandler(onBack: () => boolean, active = true): void {
  const onBackRef = useRef(onBack)
  useEffect(() => {
    onBackRef.current = onBack
  })

  useEffect(() => {
    if (!active) return
    return pushBackHandler(() => onBackRef.current())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
