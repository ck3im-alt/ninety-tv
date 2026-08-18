// Stack-based Back-button routing. Screens/overlays push a handler while
// mounted; the topmost handler gets first refusal on a Back press (e.g. to
// close a modal instead of leaving the screen). If nothing on the stack
// consumes the press, the app exits — matching what Samsung's certification
// expects from the hardware Back key on a root screen.
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

let attached = false

export function attachGlobalBackListener(): void {
  if (attached || typeof window === 'undefined') return
  attached = true
  window.addEventListener('keydown', (event) => {
    if (keyEventToIntent(event) !== NavIntent.Back) return
    event.preventDefault()
    const topHandler = stack[stack.length - 1]
    const consumed = topHandler?.() ?? false
    if (!consumed) exitApp()
  })
}
