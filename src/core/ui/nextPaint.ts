// Resolves once the browser has had the chance to PAINT whatever React just
// committed.
//
// Needed because "set a loading state, then do the work" is not enough when
// the work is synchronous: React commits the state, but the browser only
// paints between tasks, and a blocking parse that starts in the very next
// task takes the thread before any of it reaches the screen. The viewer sees
// a frozen app for the whole operation and then the finished result — the
// loading state having existed, correctly, in a DOM nobody ever saw.
//
// Two frames rather than one: the first rAF callback runs BEFORE the paint
// it is scheduled against, the second only after it has happened.
//
// Falls back to a macrotask where rAF does not exist (jsdom, and any
// non-browser host) so callers never have to branch.
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0)
      return
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}
