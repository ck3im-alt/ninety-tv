import { useEffect } from 'react'
import { doesFocusableExist, getCurrentFocusKey, ROOT_FOCUS_KEY, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler } from './useBackHandler'

// Pure so it's unit-testable without a real focus-tree: "restore the exact
// opener if it's still there and actionable, otherwise fall back" — the
// focus-memory model this app follows (see the navigation-hardening pass's
// final report) explicitly calls for not restoring a stale key blindly.
export function pickModalRestoreFocusKey(openerFocusKey: string, openerStillExists: boolean, fallback: string = ROOT_FOCUS_KEY): string {
  return openerStillExists ? openerFocusKey : fallback
}

interface ModalFocusScopeOptions {
  // Stable focus key for the modal's own root container — must be unique
  // app-wide, same as any other useFocusable focusKey.
  focusKey: string
  onClose: () => void
  // Which of the modal's own children should get focus first. Omit to fall
  // back to the library's default child-picking (closest to the top-left
  // corner) — fine for a single simple list, but most modals with more than
  // one meaningful control should pass this explicitly (e.g. the currently
  // selected option) rather than rely on geometry.
  preferredChildFocusKey?: string
  // Lets a component call this hook unconditionally (respecting the Rules
  // of Hooks) while the modal itself is only sometimes mounted/open — set
  // to false and the hook does nothing (no focus capture, no Back
  // interception). Defaults to true for the common case of a component that
  // only ever renders while its modal is open.
  active?: boolean
}

// Shared lifecycle for every "overlay rendered alongside a still-mounted
// screen" in this app (Filter, Admin, the player's Source/Text popups):
//
//   open   -> remember exactly what had focus, move focus into the modal,
//             become the sole Back target
//   close  -> restore focus to the opener if it still exists, otherwise let
//             getNextFocusKey's normal fallback resolution take over
//
// Without this, each overlay reimplements the same
// getCurrentFocusKey/setFocus/useBackHandler triplet slightly differently —
// which is how Filter and Admin ended up with copies that had quietly
// drifted apart, rather than one behavior reviewed/fixed in one place.
export function useModalFocusScope({ focusKey, onClose, preferredChildFocusKey, active = true }: ModalFocusScopeOptions) {
  const { ref, focusKey: resolvedFocusKey } = useFocusable({
    focusKey,
    trackChildren: true,
    isFocusBoundary: true,
    preferredChildFocusKey,
  })

  useEffect(() => {
    if (!active) return
    // The screen underneath stays mounted (and keeps whatever it had
    // focused) while this overlay is open — remembering it here is what
    // lets close() hand focus back to the exact control the user opened
    // this modal from, instead of leaving spatial nav pointed at a
    // now-hidden background element (which reads as "arrow keys stopped
    // working") or falling back to some generic default.
    const openerFocusKey = getCurrentFocusKey()
    void setFocus(focusKey)
    return () => {
      // The opener may have unmounted while this modal was open (e.g. the
      // screen behind it re-rendered its list and that exact row is gone —
      // see the Favorites-screen dynamic-removal case elsewhere in this
      // pass) — blindly restoring a stale key would leave focus pointing at
      // nothing. ROOT_FOCUS_KEY resolution falls back to whatever
      // forceFocus target the screen underneath declares.
      void setFocus(pickModalRestoreFocusKey(openerFocusKey, doesFocusableExist(openerFocusKey)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focusKey])

  // Without this, Back falls through to whatever handler the (still-
  // mounted, just visually hidden) screen behind this overlay registered.
  useBackHandler(() => {
    onClose()
    return true
  }, active)

  return { ref, focusKey: resolvedFocusKey }
}
