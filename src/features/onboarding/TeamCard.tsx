import type { TeamDef } from '../../data/sports/teamCatalog'
import type { CardArrows } from './LeagueCard'
import { teamFocusKey } from './teamFocusKeys'
import { SelectableCard } from './SelectableCard'

// The one club tile, used by BOTH of step 2's team surfaces — the
// suggestions row and the browser's grid — so the two can't drift, exactly
// like LeagueCard does for competitions.
//
// The same SelectableCard as every other picker in the app: a club is one
// more thing you tick, not a new interaction model, and reusing it means
// the focus ring, the checkbox and the selected treatment are identical to
// the sports and leagues directly above it on the same screen.
export function TeamCard({
  team,
  selected,
  onToggle,
  arrows,
  // Which key space this tile belongs to. Defaults to the browser grid's;
  // the suggestions row passes its own, because the same club can be on
  // both surfaces at once and two focusables must never share a key. See
  // teamFocusKeys.ts.
  focusKey = teamFocusKey(team.id),
}: {
  team: TeamDef
  selected: boolean
  onToggle: () => void
  arrows: CardArrows
  focusKey?: string
}) {
  return (
    <SelectableCard focusKey={focusKey} selected={selected} onToggle={onToggle} {...arrows}>
      {/* A crest when the catalogue has one, and nothing at all when it
          doesn't — never a placeholder shape, which on a wall of tiles
          reads as a broken image rather than as "no logo". The name alone
          identifies the club perfectly well. */}
      <div className="pick-card-icon">{team.logo && <img src={team.logo} alt="" />}</div>
      <span className="pick-card-label">{team.name}</span>
    </SelectableCard>
  )
}
