import { useFocusable, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useFocusScrollIntoView } from '../../core/platform'
import { verticalNeighbour, type FocusChain } from './focusChain'
import { ONBOARDING_PRIMARY_FOCUS_KEY } from './OnboardingActions'
import { ChevronDownIcon, ChevronUpIcon } from './sportIcons'

// The "More leagues" / "More countries" control, shared by onboarding steps
// 2 and 3.
//
// A SEPARATE COMPONENT ON PURPOSE. Both screens used to call useFocusable
// for this inline while rendering the button conditionally — so on the
// renders where the button wasn't there (the competition catalog still
// loading, a playlist with nothing extra to show), norigin registered a
// focusable whose `node` was null. That logs "Component added without a
// node reference" and, worse, leaves a focusable sitting at an empty
// (0,0,0,0) layout that a directional search can genuinely land on.
// Owning the hook here means the registration and the DOM node have exactly
// the same lifetime: mount the component only when the control exists.
//
// The control also keeps ONE focusKey and ONE DOM position across
// expand/collapse — only the label changes. The expanded content is
// appended BELOW it by the caller, never spliced in above, so pressing OK
// never moves the thing the user is looking at.
export function OnboardingExpander({
  focusKey,
  expanded,
  moreLabel,
  fewerLabel,
  chain,
  onToggle,
}: {
  focusKey: string
  expanded: boolean
  moreLabel: string
  fewerLabel: string
  // The screen's rendered row model — this control is one single-cell row
  // in it, so Up/Down need no special cases of their own.
  chain: FocusChain
  onToggle: () => void
}) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onToggle,
    onArrowPress: (direction) => {
      if (direction === 'up' || direction === 'down') {
        const target = verticalNeighbour(chain, focusKey, direction)
        // Nothing below when collapsed — fall through to the footer. Up
        // always has the pinned grid above it, but stay put if it somehow
        // doesn't rather than letting the search reach the screen root.
        if (target) void setFocus(target)
        else if (direction === 'down') void setFocus(ONBOARDING_PRIMARY_FOCUS_KEY)
        return false
      }
      // Full-width row: nothing sits beside it in either direction.
      return false
    },
  })

  // `expanded` as the layout key, not just `focused`: pressing OK changes
  // the page height around this control WITHOUT changing whether it is
  // focused, so a focus-change-only scroll effect never re-fires and the
  // focused control can end up outside the scroll viewport with no key
  // press to bring it back. That was the original More-leagues bug.
  useFocusScrollIntoView(ref, focused, { block: 'nearest' }, expanded)

  return (
    <button ref={ref} className={`onboarding-expander ${focused ? 'focused' : ''}`} onClick={onToggle}>
      {expanded ? (
        <>
          {fewerLabel} <ChevronUpIcon />
        </>
      ) : (
        <>
          {moreLabel} <ChevronDownIcon />
        </>
      )}
    </button>
  )
}
