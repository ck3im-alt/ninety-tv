import { useMemo } from 'react'
import { setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useFocusScrollIntoView } from '../../core/platform'
import type { LeagueGroup } from './groupExpandedLeagues'
import { chunkIntoRows, isRowEdge, verticalNeighbour, type FocusChain } from './focusChain'
import { BLOCK_ARROW } from './SelectableCard'
import { selectedCountIn } from './leagueBrowserState'
import { leagueFocusKey, regionFocusKey } from './leagueFocusKeys'
import { LeagueCard } from './LeagueCard'
import './LeagueBrowser.css'

// The "All leagues" browser: a MASTER/DETAIL panel, not a page section.
//
// WHY. The previous pass rendered the whole remaining catalogue as stacked
// per-region grids below the recommendations. That is logically correct and
// completely wrong for a TV: 42 cards and ~19 headings turn one 1080px
// screen into several screens of document, push Back/Continue miles below
// the fold, and cost dozens of remote presses to cross. This renders ONE
// region's competitions at a time inside a fixed-height panel that fits in
// the space left over above the footer, so the page never grows.
//
// The panel is a 2x2 CSS grid — a header row over a content row, a region
// rail beside a league grid — and only the rail normally scrolls. See
// LeagueBrowser.css.
//
// Matches .league-browser-grid's own `repeat(5, 1fr)`. The detail pane is
// ~1380px wide, so five ~265px cards is the widest the grid goes before the
// tiles start looking stretched — and it is enough that every region in the
// real catalog but two (International at 6, USA at 7) is a SINGLE row, and
// those two are two. The grid therefore never scrolls, and Down out of most
// regions reaches the footer in one press.
const BROWSER_GRID_COLUMNS = 5

interface Props {
  // Already grouped, ordered and de-duplicated by groupExpandedLeagues, and
  // guaranteed to contain no empty group. This component never regroups.
  groups: readonly LeagueGroup[]
  // The region currently being browsed — always one of `groups`, resolved
  // by leagueBrowser.ts's resolveActiveGroup.
  activeGroup: LeagueGroup
  selectedLeagues: ReadonlySet<string>
  // Focusing a region row browses it. Nothing is persisted by this — it is
  // purely which competitions the detail pane shows.
  onActivateRegion: (groupKey: string) => void
  onToggleLeague: (id: string) => void
  // The control directly above the panel ("Hide league browser") — where Up
  // out of the top of either column goes.
  exitUpFocusKey: string
  // The footer's primary action — where Down out of the bottom of either
  // column goes, so the user never has to walk every region to reach it.
  exitDownFocusKey: string
  // Records where the user left the panel, so Up out of the footer comes
  // back to the same place. Called with the key being left, before focus
  // moves.
  onExitDown: (fromKey: string) => void
}

export function LeagueBrowser({
  groups,
  activeGroup,
  selectedLeagues,
  onActivateRegion,
  onToggleLeague,
  exitUpFocusKey,
  exitDownFocusKey,
  onExitDown,
}: Props) {
  // TWO SEPARATE CHAINS, not one. focusChain.ts models a stack of rows,
  // which is exactly what each COLUMN of this panel is — the rail is a
  // column of one-cell rows, the grid a column of BROWSER_GRID_COLUMNS-cell
  // rows — but the two sit side by side, so a single chain could not
  // describe them. Left and Right cross between the columns explicitly
  // below; everything vertical still falls out of the model, including a
  // partly-filled last grid row.
  const railChain = useMemo<FocusChain>(() => groups.map((group) => [regionFocusKey(group.key)]), [groups])
  const gridChain = useMemo<FocusChain>(
    () => chunkIntoRows(activeGroup.leagues.map((league) => leagueFocusKey(league.id)), BROWSER_GRID_COLUMNS),
    [activeGroup],
  )

  const firstLeagueKey = activeGroup.leagues[0] ? leagueFocusKey(activeGroup.leagues[0].id) : null
  const activeRegionKey = regionFocusKey(activeGroup.key)

  return (
    <section className="league-browser">
      <h3 className="league-browser-rail-header">Regions</h3>
      <div className="league-browser-detail-header">
        <h3 className="league-browser-region">{activeGroup.label}</h3>
        <span className="league-browser-region-meta">
          {activeGroup.leagues.length} {activeGroup.leagues.length === 1 ? 'competition' : 'competitions'}
        </span>
      </div>

      {/* The only surface in this browser that normally scrolls — ~19
          compact country names, rather than 42 large cards. */}
      <div className="league-browser-rail">
        {groups.map((group) => (
          <RegionRow
            key={group.key}
            group={group}
            active={group.key === activeGroup.key}
            selectedCount={selectedCountIn(group, selectedLeagues)}
            chain={railChain}
            exitUpFocusKey={exitUpFocusKey}
            exitDownFocusKey={exitDownFocusKey}
            onExitDown={onExitDown}
            onActivate={onActivateRegion}
            // Right always enters the row's OWN region, which is also the
            // one the detail pane is showing (focusing this row activated
            // it). Never a hardcoded id — the first card of whatever is
            // there.
            firstLeagueKey={group.key === activeGroup.key ? firstLeagueKey : null}
          />
        ))}
      </div>

      {/* Keyed by region so switching regions resets this pane's scroll
          position instead of inheriting the previous region's. */}
      <div className="league-browser-detail" key={activeGroup.key}>
        <div className="league-browser-grid">
          {activeGroup.leagues.map((league) => {
            const key = leagueFocusKey(league.id)
            return (
              <LeagueCard
                key={league.id}
                league={league}
                selected={selectedLeagues.has(league.id)}
                onToggle={() => onToggleLeague(league.id)}
                showRegion={false}
                arrows={{
                  onArrowUp: () => {
                    void setFocus(verticalNeighbour(gridChain, key, 'up') ?? exitUpFocusKey)
                  },
                  onArrowDown: () => {
                    const target = verticalNeighbour(gridChain, key, 'down')
                    if (target) void setFocus(target)
                    else {
                      onExitDown(key)
                      void setFocus(exitDownFocusKey)
                    }
                  },
                  // The region is the PARENT of its grid: Left out of the
                  // first column returns to the row you came in on.
                  onArrowLeft: isRowEdge(gridChain, key, 'left') ? () => void setFocus(activeRegionKey) : undefined,
                  // Nothing to the right of the panel — consume it rather
                  // than let norigin's search escape to the screen root,
                  // which draws no focus ring at all.
                  onArrowRight: isRowEdge(gridChain, key, 'right') ? BLOCK_ARROW : undefined,
                }}
              />
            )
          })}
        </div>
      </div>
    </section>
  )
}

// A compact navigation row, deliberately NOT a card: this is what you move
// through to browse, and it has to stay small enough that a dozen of them
// fit in a panel that also has to hold a league grid.
function RegionRow({
  group,
  active,
  selectedCount,
  chain,
  firstLeagueKey,
  exitUpFocusKey,
  exitDownFocusKey,
  onActivate,
  onExitDown,
}: {
  group: LeagueGroup
  active: boolean
  selectedCount: number
  chain: FocusChain
  firstLeagueKey: string | null
  exitUpFocusKey: string
  exitDownFocusKey: string
  onActivate: (groupKey: string) => void
  onExitDown: (fromKey: string) => void
}) {
  const focusKey = regionFocusKey(group.key)
  const enterGrid = () => {
    if (firstLeagueKey) void setFocus(firstLeagueKey)
  }

  const { ref, focused } = useFocusable({
    focusKey,
    // FOCUS IS THE ONLY THING THAT BROWSES. Moving through the rail changes
    // the detail pane immediately — no OK press to "load" a region, which
    // is what makes this feel like a TV master/detail rather than a menu of
    // links. Nothing is persisted by focusing; only the league cards on the
    // right toggle any preference.
    onFocus: () => onActivate(group.key),
    // OK is a convenience for the same thing Right does, not a requirement.
    onEnterPress: enterGrid,
    onArrowPress: (direction) => {
      if (direction === 'up') {
        void setFocus(verticalNeighbour(chain, focusKey, 'up') ?? exitUpFocusKey)
        return false
      }
      if (direction === 'down') {
        const target = verticalNeighbour(chain, focusKey, 'down')
        if (target) void setFocus(target)
        else {
          // Escape hatch from the bottom of the rail — the user must never
          // have to walk every region to reach Continue.
          onExitDown(focusKey)
          void setFocus(exitDownFocusKey)
        }
        return false
      }
      if (direction === 'right') {
        enterGrid()
        return false
      }
      // Left stays in the rail: the rail IS the left edge of the panel.
      return false
    },
  })

  // Follows rail focus within the rail's own overflow — 'nearest', so it
  // moves the minimum needed and never yanks the panel around. The detail
  // pane and the page itself do not move with it.
  useFocusScrollIntoView(ref, focused, { block: 'nearest' })

  return (
    <div
      ref={ref}
      className={`region-row ${active ? 'active' : ''} ${focused ? 'focused' : ''}`}
      onClick={() => void setFocus(focusKey)}
    >
      <span className="region-row-label">{group.label}</span>
      {/* Selection shows as a small count, never as a green row: a region
          containing one picked competition is not itself "selected", and
          lighting the whole row would out-shout the focus ring. */}
      {selectedCount > 0 ? (
        <span className="region-row-selected">{selectedCount} selected</span>
      ) : (
        <span className="region-row-count">{group.leagues.length}</span>
      )}
    </div>
  )
}
