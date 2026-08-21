// Stack-based Back-button routing. Screens/overlays push a handler while
// mounted; the topmost handler gets first refusal on a Back press (e.g. to
// close a modal instead of leaving the screen). If nothing on the stack
// consumes the press, the app exits — matching what Samsung's certification
// expects from the hardware Back key on a root screen.
//
// Registration order must only change on mount/unmount (or an explicit
// `active` toggle) — never on a re-render. useBackHandler.ts is the only
// caller that pushes onto this stack, and it does so through a stable
// wrapper closure (see that file) so a screen re-rendering with a fresh
// inline `() => {...}` callback never moves its position in `stack`. If it
// did, a background screen re-rendering after a modal opened could end up
// ABOVE the modal's handler, so Back would close the screen instead of the
// modal it's actually looking at.
import { exitApp, keyEventToIntent, NavIntent } from './keys'

type BackHandler = () => boolean // return true if this handler consumed the press

const stack: BackHandler[] = []

export function pushBackHandler(handler: BackHandler): () => void {
  stack.push(handler)
  return () => {
    const index = stack.lastIndexOf(handler)
    if (index !== -1) stack.splice(index, 1)
  }
}

// Exposed separately from the DOM listener below so tests can exercise the
// actual LIFO/consume semantics without simulating a keydown event.
//
// Walks the stack top-down, stopping at the first handler that consumes the
// press — matching useBackHandler's own documented contract ("return false
// to let it fall through to the next handler down the stack"). Previously
// this only ever called the single topmost handler: a handler returning
// false was indistinguishable from an empty stack, so anything that wanted
// to say "not applicable right now, let whatever's underneath handle this"
// silently exited the app instead. No current screen actually returns
// false (every useBackHandler callback in this app unconditionally returns
// true), so this was a dormant contract mismatch rather than an observed
// bug — but it's exactly the kind of trap a future screen would fall into
// silently, and the LIFO LAYERING this whole module exists for (a popup
// declining to act while it's mid-animation-closed, say) depends on real
// fallthrough working.
export function handleBackPress(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]()) return true
  }
  return false
}

// DEV-only diagnostics (see focusDebug.ts) — how many handlers are
// currently registered, so the on-screen focus debugger can show whether a
// popup's handler is actually on the stack instead of guessing from UI
// state alone.
export function getBackStackDepth(): number {
  return stack.length
}

let attached = false

export function attachGlobalBackListener(): void {
  if (attached || typeof window === 'undefined') return
  attached = true
  window.addEventListener('keydown', (event) => {
    if (keyEventToIntent(event) !== NavIntent.Back) return
    event.preventDefault()
    if (!handleBackPress()) exitApp()
  })
}
