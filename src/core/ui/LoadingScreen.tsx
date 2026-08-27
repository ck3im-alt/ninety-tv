import { useEffect } from 'react'
import './LoadingScreen.css'

// THE Ninety loading state. One component, used by every operation that is
// slow enough that the next screen genuinely cannot render yet — first-time
// playlist import, the channel normalization/index build behind it, and the
// hand-off from onboarding to Home.
//
// WHY A FULL-BLEED OVERLAY RATHER THAN SKELETONS. Skeleton placeholders are
// a desktop pattern: they work because a mouse pointer gives the reader a
// fixed reference point while boxes shuffle around underneath it. On a TV
// the reference point IS the focus ring, and a screen full of shifting grey
// rectangles has nowhere to put one — the remote looks dead and the page
// looks broken. An opaque panel that says what is happening is both calmer
// and more honest.
//
// It is opaque on purpose (never a translucent scrim): half-showing the
// screen underneath is exactly the "flash of the previous/next screen" this
// exists to remove.
//
// NO FAKE PROGRESS. There is no percentage here and there must not be one —
// none of the operations this covers can report real progress (a playlist
// fetch is one await; the index build is one Worker round-trip), so a bar
// filling at an invented rate would be a lie the user can feel when it
// stalls at 90%. The motion below is deliberately indeterminate.

export interface LoadingScreenProps {
  // The one line that says what is being waited on, in the user's own
  // terms — "Loading your channels", never "Loading".
  title: string
  // Optional second line. Free to change as real stages complete (see
  // PLAYLIST_IMPORT_STAGES); never a countdown or a percentage.
  detail?: string
}

export function LoadingScreen({ title, detail }: LoadingScreenProps) {
  // SWALLOWS THE REMOTE while the blocking operation runs. Registered in
  // the CAPTURE phase on window, which is the first step of the event path
  // — both norigin's spatial navigation and this app's global Back listener
  // bind on window in the BUBBLE phase (see backHandler.ts), so stopping
  // propagation here means neither ever sees the press.
  //
  // Without it, a viewer pressing OK twice on "Continue" queues a second
  // connect against a screen that is already gone, and a Back press during
  // a first-run import reaches attachGlobalBackListener with an empty stack
  // and exits the app outright.
  useEffect(() => {
    const swallow = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', swallow, true)
    window.addEventListener('keyup', swallow, true)
    return () => {
      window.removeEventListener('keydown', swallow, true)
      window.removeEventListener('keyup', swallow, true)
    }
  }, [])

  return (
    <div className="ninety-loading" role="status" aria-live="polite">
      <div className="ninety-loading-inner">
        <div className="ninety-loading-logo">N I N E T Y</div>
        <h1 className="ninety-loading-title">{title}</h1>
        {detail && <p className="ninety-loading-detail">{detail}</p>}
        {/* Indeterminate by design — see the header. */}
        <div className="ninety-loading-track" aria-hidden="true">
          <span className="ninety-loading-sweep" />
        </div>
      </div>
    </div>
  )
}
