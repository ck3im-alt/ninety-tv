import { useFocusable, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useFocusScrollIntoView } from '../../core/platform'
import { ArrowRightIcon, BackArrowIcon } from './sportIcons'

// The action row shared by all three onboarding steps: secondary actions
// left, the one primary action right.
//
// Deliberately a STRUCTURED component rather than a slot that takes
// arbitrary children. The footer is the only thing on the page that knows
// which buttons exist and in what order, and that is exactly the knowledge
// needed to wire Left/Right between them — see FOOTER GEOMETRY below.
//
// Focus keys are shared constants rather than per-screen strings because
// exactly one onboarding step is ever mounted at a time. That lets each
// step's grid aim its Down-escape at ONBOARDING_PRIMARY_FOCUS_KEY without
// knowing which screen it is on.
export const ONBOARDING_BACK_FOCUS_KEY = 'onboarding-back'
export const ONBOARDING_SECONDARY_FOCUS_KEY = 'onboarding-secondary'
export const ONBOARDING_PRIMARY_FOCUS_KEY = 'onboarding-primary'

// FOOTER GEOMETRY — why every direction out of a footer button is stated
// rather than left to norigin's geometric search:
//
//   Down: the footer is the last row of every step, but the content above
//   it SCROLLS. A card scrolled below the fold keeps a viewport rect that
//   sits underneath the footer, so the geometric search happily "descends"
//   into it and yanks the page back up.
//
//   Left/Right: Back sits at x~96 and the primary at x~1650, but a card in
//   a scrolled grid can have a rect that is both nearer horizontally and
//   overlapping vertically — so Left from Continue found a league card
//   instead of Back. Naming the neighbour makes the footer a closed row.
//
//   Up: the caller names the target (upFocusKey); a corner button rarely
//   overlaps whatever the user came down from by norigin's required 20%.
interface ButtonSpec {
  label: string
  onPress: () => void
  disabled?: boolean
}

interface FooterProps {
  onBack?: () => void
  // Skip setup (step 1) / Clear selection (step 3) — same slot, same look.
  secondary?: ButtonSpec
  primary: ButtonSpec
  // Where Up out of the footer goes; each step names its own last row.
  upFocusKey?: UpTarget
}

// A plain key for the steps whose last row is fixed, or a resolver for a
// step whose answer depends on where the user has been — step 2 restores
// the exact place they left the open league browser, which is not knowable
// until the press happens. Resolved at press time rather than captured per
// render so it can never name a focusable that has since unmounted.
type UpTarget = string | (() => string | undefined)

const resolveUp = (target: UpTarget | undefined) => (typeof target === 'function' ? target() : target)

interface ArrowTargets {
  left?: string
  right?: string
  up?: UpTarget
}

function useFooterButton<E extends HTMLElement>(
  focusKey: string,
  onPress: () => void,
  targets: ArrowTargets,
  focusable = true,
) {
  const { ref, focused } = useFocusable<object>({
    focusKey,
    focusable,
    onEnterPress: onPress,
    onArrowPress: (direction) => {
      if (direction === 'down') return false // nothing below the footer, ever
      const target = direction === 'up' ? resolveUp(targets.up) : direction === 'left' ? targets.left : targets.right
      if (target) void setFocus(target)
      return false // an absent target means the page edge: stay put
    },
  })
  useFocusScrollIntoView(ref as React.RefObject<E>, focused)
  return { ref: ref as React.RefObject<E>, focused }
}

export function OnboardingFooter({ onBack, secondary, primary, upFocusKey }: FooterProps) {
  // Left-to-right order of whatever this step actually renders, so each
  // button's Left/Right neighbour is known rather than guessed.
  const order = [
    ...(onBack ? [ONBOARDING_BACK_FOCUS_KEY] : []),
    ...(secondary ? [ONBOARDING_SECONDARY_FOCUS_KEY] : []),
    ONBOARDING_PRIMARY_FOCUS_KEY,
  ]
  const neighbours = (key: string): ArrowTargets => {
    const i = order.indexOf(key)
    return { left: order[i - 1], right: order[i + 1], up: upFocusKey }
  }

  return (
    <div className="onboarding-footer">
      <div className="onboarding-footer-group">
        {onBack && <BackButton onPress={onBack} targets={neighbours(ONBOARDING_BACK_FOCUS_KEY)} />}
        {secondary && (
          <SecondaryButton label={secondary.label} onPress={secondary.onPress} targets={neighbours(ONBOARDING_SECONDARY_FOCUS_KEY)} />
        )}
      </div>
      <div className="onboarding-footer-group">
        <PrimaryButton
          label={primary.label}
          onPress={primary.onPress}
          disabled={primary.disabled}
          targets={neighbours(ONBOARDING_PRIMARY_FOCUS_KEY)}
        />
      </div>
    </div>
  )
}

function BackButton({ onPress, targets }: { onPress: () => void; targets: ArrowTargets }) {
  const { ref, focused } = useFooterButton<HTMLButtonElement>(ONBOARDING_BACK_FOCUS_KEY, onPress, targets)
  return (
    <button ref={ref} className={`back-button ${focused ? 'focused' : ''}`} onClick={onPress}>
      <BackArrowIcon /> Back
    </button>
  )
}

function SecondaryButton({ label, onPress, targets }: { label: string; onPress: () => void; targets: ArrowTargets }) {
  const { ref, focused } = useFooterButton<HTMLButtonElement>(ONBOARDING_SECONDARY_FOCUS_KEY, onPress, targets)
  return (
    <button ref={ref} className={`skip-button ${focused ? 'focused' : ''}`} onClick={onPress}>
      {label}
    </button>
  )
}

// `focusable: !disabled` — a disabled primary couldn't do anything on
// Enter anyway, but leaving it a registered spatial target reads as a
// broken button rather than an intentionally-unavailable one. Note that an
// explicit setFocus(key) bypasses this guard, so callers aiming Down at the
// footer must check for themselves (see PlaylistSetupScreen's focusFooter).
function PrimaryButton({
  label,
  onPress,
  disabled,
  targets,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  targets: ArrowTargets
}) {
  const { ref, focused } = useFooterButton<HTMLButtonElement>(ONBOARDING_PRIMARY_FOCUS_KEY, onPress, targets, !disabled)
  return (
    <button ref={ref} className={`continue-button ${focused ? 'focused' : ''}`} disabled={disabled} onClick={onPress}>
      {label} <ArrowRightIcon />
    </button>
  )
}
