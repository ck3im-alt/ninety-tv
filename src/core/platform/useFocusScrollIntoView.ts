import { useEffect, type RefObject } from 'react'
import { scrollFocusIntoView, type FocusScrollOptions } from './focusScroll'

// The spatial-nav library moves focus but never scrolls a container for
// you — every focusable row/card/button in this app that can end up outside
// its scroll owner's viewport needs this same three-line effect. Pulled out
// once it stopped being "a couple of call sites" and started being the same
// pattern copy-pasted across Home, TopNav, the channel cascade, onboarding
// grids, stream rows, etc. (see the navigation-hardening pass this was
// extracted during).
//
// The scroll itself is scrollFocusIntoView (see focusScroll.ts), NOT
// Element.scrollIntoView. The two differ in one way that matters on a TV:
// `block: 'nearest'` settles the element flush against whichever viewport
// edge it entered from, so a focused row could sit on the very bottom line
// of the screen with its focus ring half-clipped, and a page could never
// scroll back to its own true top. focusScroll.ts keeps a TV-safe inset from
// both edges and snaps to the real extremes. Everything else about this hook
// is unchanged.
//
// `layoutKey` (optional) covers the case a focus-change-only effect cannot:
// the focused element STAYS focused but the page around it changes height,
// so it silently ends up outside the scroll viewport with no key press to
// bring it back. Pass whatever state drives that reflow (an expanded/
// collapsed flag, a list length) and the scroll is redone on that
// transition too. Onboarding's More-leagues expander is the motivating
// case — see OnboardingSportsScreen.
export function useFocusScrollIntoView<E extends HTMLElement>(
  ref: RefObject<E | null>,
  focused: boolean,
  options?: FocusScrollOptions,
  layoutKey?: unknown,
): void {
  useEffect(() => {
    if (focused) scrollFocusIntoView(ref.current, options)
    // Deliberately omits `options`/`ref` from deps — callers pass a fresh
    // options object literal every render, and re-running this effect for
    // that (rather than only for a real focused/layout change) would be a
    // no-op at best and a fight with an in-flight scroll at worst.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, layoutKey])
}
