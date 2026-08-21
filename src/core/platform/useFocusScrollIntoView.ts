import { useEffect, type RefObject } from 'react'

// The spatial-nav library moves focus but never scrolls a container for
// you — every focusable row/card/button in this app that can end up outside
// its scroll owner's viewport needs this same three-line effect. Pulled out
// once it stopped being "a couple of call sites" and started being the same
// pattern copy-pasted across Home, TopNav, the channel cascade, onboarding
// grids, stream rows, etc. (see the navigation-hardening pass this was
// extracted during).
//
// `block`/`inline` default to 'nearest', not 'center' — 'center' would yank
// the whole scroll container on every focus move, fighting a user who's
// deliberately scrolled to look at something; 'nearest' only moves the
// minimum needed to bring the target back into view.
export function useFocusScrollIntoView<E extends HTMLElement>(
  ref: RefObject<E>,
  focused: boolean,
  options: ScrollIntoViewOptions = { block: 'nearest' },
): void {
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView(options)
    // Deliberately omits `options`/`ref` from deps — callers pass a fresh
    // options object literal every render, and re-running this effect for
    // that (rather than only for a real focused change) would be a no-op at
    // best and a fight with in-flight smooth scrolling at worst.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused])
}
