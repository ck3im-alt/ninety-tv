// Stack-based Back-button routing. Screens/overlays push a handler while
// mounted; the topmost handler gets first refusal on a Back press (e.g. to
// close a modal instead of leaving the screen).
//
// WHAT HAPPENS WHEN NOTHING CONSUMES THE PRESS. This module used to call
// exitApp() directly, with a comment claiming that matched what Samsung's
// certification expects. It does not, and the comment was removed with the
// behaviour. Samsung's Smart TV quality requirements are explicit: Return
// on the app's root/home screen must show an APP-OWNED exit confirmation
// popup, and tizen.application.getCurrentApplication().exit() may only be
// called once the viewer picks the affirmative option in that popup. An
// app that quits on the first unhandled Return fails that check — and in
// practice it also meant one stray Back press on Home threw the viewer out
// of Ninety with no warning.
//
// So an unconsumed press is now reported to an application-owned fallback
// (see setUnhandledBackHandler / App.tsx), which is what opens the
// confirmation. This module deliberately knows nothing about React,
// screens or dialogs; it only knows "nobody wanted this press". If no
// fallback is registered at all, an unconsumed press does NOTHING — never
// a silent exit, because a missing registration must not be able to
// resurrect the certification failure this comment describes.
//
// Samsung's forced LONG-PRESS Return/Exit behaviour is handled by the
// platform itself and is deliberately not registered, intercepted or
// overridden anywhere in this app.
//
// Registration order must only change on mount/unmount (or an explicit
// `active` toggle) — never on a re-render. useBackHandler.ts is the only
// caller that pushes onto this stack, and it does so through a stable
// wrapper closure (see that file) so a screen re-rendering with a fresh
// inline `() => {...}` callback never moves its position in `stack`. If it
// did, a background screen re-rendering after a modal opened could end up
// ABOVE the modal's handler, so Back would close the screen instead of the
// modal it's actually looking at.
import { keyEventToIntent, NavIntent } from './keys'

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

// The application-level "nobody handled that Return" fallback. Exactly one
// can be registered at a time; App.tsx owns it and uses it to open the exit
// confirmation (see ExitConfirmDialog.tsx).
//
// Kept OUT of the LIFO stack on purpose. It is not a peer of the screen
// handlers — it is what happens after all of them have declined — so
// modelling it as a bottom-of-stack entry would make it reorderable by any
// future push/unregister bug, and would let a screen accidentally sit
// beneath it.
let unhandledBackHandler: (() => void) | null = null

export function setUnhandledBackHandler(handler: (() => void) | null): () => void {
  unhandledBackHandler = handler
  return () => {
    // Only clear if we're still the current owner — a later registration
    // replacing this one must not be torn down by this one's cleanup
    // running afterwards (React effect ordering makes that ordering real).
    if (unhandledBackHandler === handler) unhandledBackHandler = null
  }
}

// Routes one Back press: registered handlers first, then the application
// fallback. Exported so the Samsung Return contract can be tested end to
// end without a DOM keydown.
export function dispatchBackPress(): void {
  if (handleBackPress()) return
  unhandledBackHandler?.()
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
    dispatchBackPress()
  })
}
