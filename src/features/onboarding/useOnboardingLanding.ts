import { useEffect, useRef } from 'react'
import { doesFocusableExist, getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import {
  ONBOARDING_BACK_FOCUS_KEY,
  ONBOARDING_PRIMARY_FOCUS_KEY,
  ONBOARDING_SECONDARY_FOCUS_KEY,
} from './OnboardingActions'

// WHY ADVANCING A STEP DOES NOT, BY ITSELF, MOVE FOCUS INTO THE NEW STEP.
//
// Every onboarding step's footer registers its buttons under the SAME three
// focus keys (see OnboardingActions — deliberately, since only one step is
// ever mounted and it lets any grid aim its Down-escape at a constant). The
// side effect is that pressing OK on Continue leaves focus on a key that is
// still perfectly valid on the next step: the new step's own footer
// re-registers it on the very same render. Nothing has gone stale, so
// norigin has no reason to re-resolve anything, and the flow's
// setFocus(<step root>) finds the current focus already inside that root and
// leaves it alone.
//
// The result was a viewer landing on "Finish setup" instead of on the
// countries they came to pick — one OK press away from skipping the step
// without ever seeing it.
//
// Steps whose entry target exists from their first render (the leagues step
// always has its Football card) get away with preferredChildFocusKey alone.
// Steps whose content is a fetch away do not, and neither do steps reached
// with focus already parked on a shared footer key. This covers both.
const FOOTER_KEYS = new Set<string>([
  ONBOARDING_PRIMARY_FOCUS_KEY,
  ONBOARDING_SECONDARY_FOCUS_KEY,
  ONBOARDING_BACK_FOCUS_KEY,
])

// norigin types getCurrentFocusKey() as `string` but genuinely returns null
// until something has been focused for the first time.
const currentFocusKey = (): string => (getCurrentFocusKey() as string | null) ?? ''

// Moves focus into the step's content ONCE, as soon as there is content to
// move it to, and only while focus is still on one of the shared footer
// keys. A viewer who has already navigated somewhere real keeps their place;
// a step that never resolves a target never steals focus at all.
//
// DEFERRED BY ONE FRAME, and that is load-bearing rather than a paper-over.
// OnboardingFlow re-focuses the new step's root on every step change, and
// React runs a parent's effects AFTER its children's — so a claim made
// directly in this effect is immediately overruled by that call, which then
// finds the still-valid footer key inside its own subtree and leaves focus
// exactly where the problem started. Waiting a frame means this runs after
// the flow has had its say, which is the only ordering that actually
// decides the question. (The teams step appeared to work without it purely
// because its target arrives from a fetch, i.e. frames later anyway.)
//
// `target` is null while the step has nothing focusable yet — pass the key
// the step wants to open on the moment it has one.
export function useOnboardingLanding(target: string | null): void {
  const landedRef = useRef(false)
  useEffect(() => {
    if (landedRef.current || !target) return
    const frame = requestAnimationFrame(() => {
      // Re-read INSIDE the frame: the flow's own setFocus has resolved by
      // now, and if it (or the viewer) has already put focus somewhere real
      // there is nothing left to do.
      // LATCHED HERE, not when the frame was scheduled. `target` legitimately
      // changes as catalogues arrive (the rail resolves before the
      // suggestions do), and every change re-runs this effect — whose
      // cleanup cancels the pending frame. Latching early therefore burned
      // the one attempt on a frame that was then cancelled, and the retry
      // was blocked by the latch it had just set. That is exactly what broke
      // stepping BACK into the teams step.
      landedRef.current = true
      const current = currentFocusKey()
      // Focus is left alone only when it is on a REAL, still-mounted control
      // that is not one of the shared footer keys.
      //
      // The existence check is what makes stepping BACK work. Back is
      // pressed with focus on a card of the step being left; that card
      // unmounts, but norigin keeps reporting its key until something else
      // takes focus — so a key-name check alone reads "the viewer is
      // somewhere real, don't touch it" about a control that no longer
      // exists, and the new step is entered with focus nowhere useful.
      if (current !== '' && !FOOTER_KEYS.has(current) && doesFocusableExist(current)) return
      void setFocus(target)
    })
    return () => cancelAnimationFrame(frame)
  }, [target])
}
