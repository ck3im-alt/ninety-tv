import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useFocusScrollIntoView } from '../../core/platform'
import { CheckIcon } from './sportIcons'

// Consumes an arrow press without moving focus — for a grid/form edge with
// nothing beyond it.
//
// This is NOT cosmetic. Letting norigin's directional search run off the
// edge doesn't leave focus where it was: it escapes UP the tree to the
// screen's own root focusable (every onboarding step registers one with
// trackChildren), which draws no focus ring at all, so the remote looks
// dead until the user happens to guess which key brings it back. The old
// two-column layout never hit this because every edge had a real target on
// the other side (Back in the left panel, the section header above); the
// full-width layout removed those, so each edge now says so explicitly.
export const BLOCK_ARROW = () => {}

// The one selectable tile used by every picker grid in the app — onboarding
// sports/leagues/countries and Settings' equivalents. Extracted from
// OnboardingSportsScreen when that screen was rewritten for the full-width
// layout; Settings imported it from there, which had stopped making sense.
export function SelectableCard({
  focusKey,
  selected,
  onToggle,
  forceFocus,
  // One extra class on the tile, for a caller that needs a differently
  // SHAPED card without a differently BEHAVING one — currently only
  // LeagueCard's 'compact' browser variant. Deliberately not a style prop
  // and not a slot: everything about selection, focus and arrow handling
  // stays here, and the modifier only ever changes layout.
  className,
  // Directional escapes. norigin only treats two elements as adjacent when
  // they overlap by >=20%, so leaving a grid for a target that isn't
  // directly above/below the specific card you're on (the footer's primary
  // button, the full-width expander, the next group's grid) can't be left
  // to geometry. Same onArrowPress-returns-false-to-override pattern as
  // ListRow.tsx / BrowseCascadeScreen.tsx use for the identical problem in
  // the channel browser.
  //
  // Onboarding derives all four from its rendered row model rather than
  // naming specific cards — see focusChain.ts. Settings still passes
  // targets directly.
  onArrowLeft,
  onArrowRight,
  onArrowUp,
  onArrowDown,
  children,
}: {
  focusKey: string
  selected: boolean
  onToggle: () => void
  forceFocus?: boolean
  className?: string
  onArrowLeft?: () => void
  onArrowRight?: () => void
  onArrowUp?: () => void
  onArrowDown?: () => void
  children: React.ReactNode
}) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onToggle,
    forceFocus,
    onArrowPress: (direction) => {
      if (direction === 'left' && onArrowLeft) {
        onArrowLeft()
        return false
      }
      if (direction === 'right' && onArrowRight) {
        onArrowRight()
        return false
      }
      if (direction === 'up' && onArrowUp) {
        onArrowUp()
        return false
      }
      if (direction === 'down' && onArrowDown) {
        onArrowDown()
        return false
      }
      return true
    },
  })
  // Grids can outgrow the visible page (50 competitions, every country in a
  // large playlist) — without this, D-pad movement past the fold moves
  // focus but not the viewport, so the remote looks dead while state is in
  // fact changing off-screen.
  useFocusScrollIntoView(ref, focused)

  return (
    <div
      ref={ref}
      className={`pick-card ${className ?? ''} ${selected ? 'selected' : ''} ${focused ? 'focused' : ''}`}
      onClick={onToggle}
    >
      <span className="pick-card-checkbox">{selected && <CheckIcon />}</span>
      {children}
    </div>
  )
}
