import type { LeagueDef } from '../../data/sports/leagues'
import { leagueFocusKey } from './leagueFocusKeys'
import { SelectableCard } from './SelectableCard'

// The one competition tile, used by BOTH surfaces on onboarding step 2 —
// the pinned recommendations row and the region browser's grid — so the two
// cannot drift apart visually. Extracted from OnboardingSportsScreen when
// the flat catalogue became a master/detail browser and the card gained a
// second, separately-rendered call site.
//
// Focus keys are `league-<competition id>` on both surfaces (see
// leagueFocusKeys.ts), which is safe because a recommended competition is
// excluded from the browser's groups (groupExpandedLeagues) — no id is ever
// rendered twice, so no two focusables ever share a key.
export interface CardArrows {
  onArrowUp?: () => void
  onArrowDown?: () => void
  onArrowLeft?: () => void
  onArrowRight?: () => void
}

export function LeagueCard({
  league,
  selected,
  onToggle,
  arrows,
  // The recommendations are a mixed bag of regions, so each card says which
  // one it is. Inside the browser the region is the rail row you are
  // standing on and the heading above the grid, so repeating it on all five
  // England cards is just noise.
  showRegion = true,
}: {
  league: LeagueDef
  selected: boolean
  onToggle: () => void
  arrows: CardArrows
  showRegion?: boolean
}) {
  return (
    <SelectableCard focusKey={leagueFocusKey(league.id)} selected={selected} onToggle={onToggle} {...arrows}>
      <div className="pick-card-icon">{league.badge && <img src={league.badge} alt="" />}</div>
      <span className="pick-card-label">{league.name}</span>
      {showRegion && league.region && <span className="pick-card-sublabel">{league.region}</span>}
    </SelectableCard>
  )
}
