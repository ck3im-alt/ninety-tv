// THE ONE PLACE THAT SCROLLS A FOCUSED ELEMENT INTO VIEW.
//
// The spatial-navigation library moves focus and never scrolls, so every
// focusable row/card/button that can leave its scroll owner's viewport needs
// something to bring it back. That something used to be
// `scrollIntoView({ block: 'nearest' })`, and `nearest` is exactly the
// problem: it guarantees the element is VISIBLE and nothing more, so it
// settles the element flush against the edge it came in from. On a TV that
// produced three separate reported bugs from one cause:
//
//   - Schedule: the fixture you just moved down onto sat on the very bottom
//     line of the panel, with no breathing room under it.
//   - Schedule: the last fixture in a competition card is flush with the
//     card's rounded bottom corners, so its focus ring was clipped there.
//     (Fixed in CSS — see ScheduleScreen.css — but only visible as a bug
//     because `nearest` parks rows against edges in the first place.)
//   - Match View: navigating all the way down and back up left the page a
//     few dozen pixels short of its real top. Back is absolutely positioned
//     at `top: 28px` on the hero, so `nearest` scrolls the document to
//     exactly 28 and stops — the element is visible, the page is not at the
//     top, and both statements are true at once.
//
// So this replaces `nearest` with an explicit geometry pass that keeps a
// TV-safe INSET between the focused element and the edges of the viewport it
// lives in, and that snaps to the true scroll extremes when it lands within
// an inset of them. It walks the whole ancestor chain the way the native
// call does, so a nested scroller scrolls ITSELF and only the part that it
// cannot satisfy is passed outward to the document.
//
// Deliberately instant (a direct scrollTop write), never `behavior:
// 'smooth'`: ten quick D-pad presses queue ten animations and the highlight
// visibly trails the remote. Same reasoning as --motion-focus in tokens.css.

// THE TV-SAFE INSET. Mirrors --focus-scroll-inset in
// core/designsystem/tokens.css, which is var(--space-8) — the spacing rung
// already used for "a comfortable gap between a block and its container" all
// over the app. Kept as a plain number here rather than read back out of CSS
// because this runs on every focus move: a getComputedStyle round-trip per
// keypress to re-learn a constant is not a trade worth making, and a value
// that only exists in CSS cannot be unit-tested. If one moves, move both.
export const TV_FOCUS_SCROLL_INSET = 32

export interface FocusScrollOptions {
  // Clearance kept between the element and both edges of its scroll
  // viewport. Defaults to TV_FOCUS_SCROLL_INSET.
  inset?: number
  // Also keep the element inside its nearest HORIZONTAL scroll owner — the
  // Home carousels. Off by default: every other surface in the app scrolls
  // vertically only, and asking for a horizontal pass there costs an
  // ancestor walk that can never do anything.
  inline?: boolean
}

// One axis of one scroll container, reduced to plain numbers so the actual
// decision is testable without a layout engine. All coordinates are in the
// same space (viewport pixels); `current` is that container's scroll offset
// along this axis.
export interface FocusScrollGeometry {
  current: number
  // scrollHeight - clientHeight (or the horizontal equivalent).
  max: number
  viewportStart: number
  viewportEnd: number
  targetStart: number
  targetEnd: number
  inset: number
}

// WHERE THIS CONTAINER SHOULD BE SCROLLED TO, or `current` when it is
// already fine. Three rules, in order:
//
// 1. The inset is a REQUEST, not a guarantee. An element taller than the
//    viewport minus two insets cannot have both, so the clearance shrinks to
//    whatever actually fits (and to zero for an element taller than the
//    viewport, which then behaves exactly like the old `nearest`). Without
//    this, a tall row would ask to be pushed down and up in the same frame.
//
// 2. Otherwise: move the minimum needed to put the element inside the inset
//    viewport, on whichever side it is currently outside.
//
// 3. EDGE SNAPPING, and only ever in the direction already being travelled.
//    Landing within one inset of an extreme means the remaining gap is
//    smaller than the clearance being asked for, so the honest resting place
//    is the extreme itself — this is what lets Match View reach y=0 again
//    instead of stopping at the Back button's 28px offset. Direction matters:
//    snapping a downward scroll back to 0 because it happened to be small
//    would push the element right back out of view.
export function nextScrollOffset(geometry: FocusScrollGeometry): number {
  const { current, max, viewportStart, viewportEnd, targetStart, targetEnd, inset } = geometry
  if (max <= 0) return current

  const viewportSize = viewportEnd - viewportStart
  const targetSize = targetEnd - targetStart
  const clearance = Math.max(0, Math.min(inset, Math.floor((viewportSize - targetSize) / 2)))

  const leadingGap = targetStart - (viewportStart + clearance)
  const trailingGap = viewportEnd - clearance - targetEnd

  let next = current
  if (leadingGap < 0) next = current + leadingGap
  else if (trailingGap < 0) next = current - trailingGap
  if (next === current) return current

  next = Math.max(0, Math.min(next, max))
  if (next < current && next <= inset) return 0
  if (next > current && next >= max - inset) return max
  return next
}

type Axis = 'y' | 'x'

// A container only owns scrolling on an axis if it BOTH declares a scrolling
// overflow there and actually has something to scroll. `hidden` deliberately
// does not count: it is programmatically scrollable, which is how a row with
// `overflow-y: hidden` used to silently absorb the vertical correction its
// cards asked for and leave the page behind (see the note on .scroll-row in
// HomeScreen.css). Overflow is checked last — it is the only part that costs
// a style resolution, and the cheap size test rejects most ancestors first.
function ownsScrolling(element: HTMLElement, axis: Axis): boolean {
  const scrollable =
    axis === 'y' ? element.scrollHeight > element.clientHeight + 1 : element.scrollWidth > element.clientWidth + 1
  if (!scrollable) return false
  const style = getComputedStyle(element)
  const overflow = axis === 'y' ? style.overflowY : style.overflowX
  return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay'
}

function applyToContainer(container: HTMLElement, target: Element, axis: Axis, inset: number): void {
  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  // The PADDING box, not the border box: clientTop/clientLeft are the border
  // widths, and clientHeight/clientWidth already exclude them — which is also
  // the box `max` below is measured against.
  const viewportStart = axis === 'y' ? containerRect.top + container.clientTop : containerRect.left + container.clientLeft
  const viewportSize = axis === 'y' ? container.clientHeight : container.clientWidth
  const current = axis === 'y' ? container.scrollTop : container.scrollLeft
  const next = nextScrollOffset({
    current,
    max: axis === 'y' ? container.scrollHeight - container.clientHeight : container.scrollWidth - container.clientWidth,
    viewportStart,
    viewportEnd: viewportStart + viewportSize,
    targetStart: axis === 'y' ? targetRect.top : targetRect.left,
    targetEnd: axis === 'y' ? targetRect.bottom : targetRect.right,
    inset,
  })
  if (next === current) return
  if (axis === 'y') container.scrollTop = next
  else container.scrollLeft = next
}

function applyToDocument(target: Element, axis: Axis, inset: number): void {
  const root = document.scrollingElement ?? document.documentElement
  if (!root) return
  const targetRect = target.getBoundingClientRect()
  const viewportSize = axis === 'y' ? root.clientHeight : root.clientWidth
  const next = nextScrollOffset({
    current: axis === 'y' ? root.scrollTop : root.scrollLeft,
    max: axis === 'y' ? root.scrollHeight - root.clientHeight : root.scrollWidth - root.clientWidth,
    viewportStart: 0,
    viewportEnd: viewportSize,
    targetStart: axis === 'y' ? targetRect.top : targetRect.left,
    targetEnd: axis === 'y' ? targetRect.bottom : targetRect.right,
    inset,
  })
  // A plain property write rather than window.scrollTo: it is the same
  // scroll, it is instant by definition, and it does not go through an API
  // jsdom refuses to implement (which would make every focus move in a test
  // print an unhandled "Not implemented" error).
  if (axis === 'y') root.scrollTop = next
  else root.scrollLeft = next
}

// Satisfies each scroll owner from the element outward, then the document.
// Each container is asked to bring in whatever the container BELOW it could
// not — that is what makes a nested list scroll itself first and only hand
// the leftover outward, instead of the page lurching for a row a list could
// have reached on its own.
function bringIntoView(element: HTMLElement, axis: Axis, inset: number): void {
  let target: Element = element
  let ancestor = element.parentElement
  while (ancestor) {
    if (ownsScrolling(ancestor, axis)) {
      applyToContainer(ancestor, target, axis, inset)
      target = ancestor
    }
    ancestor = ancestor.parentElement
  }
  applyToDocument(target, axis, inset)
}

export function scrollFocusIntoView(element: HTMLElement | null, options: FocusScrollOptions = {}): void {
  if (!element || !element.isConnected) return
  // No layout at all — a display:none subtree, or jsdom, where every box is
  // 0x0 and there is nothing meaningful to scroll toward. Bailing keeps the
  // component tests honest (they assert focus, not pixels) instead of having
  // them exercise arithmetic against a fabricated viewport.
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return

  const inset = options.inset ?? TV_FOCUS_SCROLL_INSET
  bringIntoView(element, 'y', inset)
  if (options.inline) bringIntoView(element, 'x', inset)
}
