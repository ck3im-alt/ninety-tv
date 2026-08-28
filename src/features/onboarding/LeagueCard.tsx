import type { LeagueDef } from '../../data/sports/leagues'
import { leagueFocusKey } from './leagueFocusKeys'
import { SelectableCard } from './SelectableCard'

// The one competition tile, used by BOTH surfaces on onboarding step 2 —
// the pinned recommendations row and the "Browse more competitions" grid —
// so the two cannot drift apart in behaviour. Extracted from
// OnboardingSportsScreen when the catalogue became a browser of its own and
// the card gained a second, separately-rendered call site.
//
// Focus keys are `league-<competition id>` on both surfaces (see
// leagueFocusKeys.ts), which is safe because a recommended competition is
// excluded from the browsable catalogue (buildBrowseCatalogue) — no id is
// ever rendered twice, so no two focusables ever share a key.
export interface CardArrows {
  onArrowUp?: () => void
  onArrowDown?: () => void
  onArrowLeft?: () => void
  onArrowRight?: () => void
}

// TWO SHAPES, ONE SELECTION BEHAVIOUR.
//
//   'tile'    the pinned recommendations row: a tall, centred, portrait
//             tile, eight across the full width of the page.
//   'compact' the browser's grid: a landscape row — badge left, name beside
//             it, region beneath in muted text — six across. Wide rather
//             than tall because the browser fits three rows of them into
//             the leftover ~438px, and because "Championship / England"
//             reads faster on one line than stacked in a square.
//
// A variant rather than a second component precisely so neither shape can
// grow its own copy of the toggle/focus wiring — see SelectableCard, which
// both go through unchanged.
export type LeagueCardVariant = 'tile' | 'compact'

export function LeagueCard({
  league,
  selected,
  onToggle,
  arrows,
  variant = 'tile',
}: {
  league: LeagueDef
  selected: boolean
  onToggle: () => void
  arrows: CardArrows
  variant?: LeagueCardVariant
}) {
  const badge = <div className="pick-card-icon">{league.badge && <img src={league.badge} alt="" />}</div>

  // Every card says which region it belongs to. On the recommendations row
  // that is because it is a mixed bag of countries; in the browser it is
  // load-bearing, because the flat catalogue has no country heading above
  // it any more — and because the real catalog contains an Austrian
  // "Bundesliga", a Brazilian "Serie A" and a Scottish "Premiership" whose
  // names alone are genuinely ambiguous.
  const region = league.region && <span className="pick-card-sublabel">{league.region}</span>

  return (
    <SelectableCard
      focusKey={leagueFocusKey(league.id)}
      className={variant === 'compact' ? 'pick-card-compact' : undefined}
      selected={selected}
      onToggle={onToggle}
      {...arrows}
    >
      {badge}
      {variant === 'compact' ? (
        <div className="pick-card-text">
          <span className="pick-card-label">{league.name}</span>
          {region}
        </div>
      ) : (
        <>
          <span className="pick-card-label">{league.name}</span>
          {region}
        </>
      )}
    </SelectableCard>
  )
}
