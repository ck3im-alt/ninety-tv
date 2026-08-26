import { useMemo } from 'react'
import { setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useFocusScrollIntoView } from '../../core/platform'
import type { TeamGroup } from '../../data/sports/teamSuggestions'
import { chunkIntoRows, isRowEdge, verticalNeighbour, type FocusChain } from './focusChain'
import { BLOCK_ARROW } from './SelectableCard'
import { teamFocusKey, teamGroupFocusKey } from './teamFocusKeys'
import { TeamCard } from './TeamCard'

// The "All teams" browser — the same master/detail panel as LeagueBrowser,
// with competitions down the rail and that competition's clubs in the grid.
//
// It shares LeagueBrowser's stylesheet (.league-browser and friends) rather
// than duplicating it: this IS the same panel, holding a different
// catalogue, and only one of the two is ever open at a time. A second
// near-identical stylesheet would be two things to keep in sync for no
// visual difference. The `team-browser` class exists only so the layout
// rule in onboardingShared.css can name both.
//
// NO TYPING REQUIRED. Every club in the viewer's followed leagues is
// reachable with the D-pad alone — rail down to a competition, right into
// its grid. That is the whole point of browsing by competition on a TV.
const BROWSER_GRID_COLUMNS = 5

interface Props {
  groups: readonly TeamGroup[]
  activeGroup: TeamGroup
  selectedTeamIds: ReadonlySet<string>
  onActivateGroup: (competitionId: string) => void
  onToggleTeam: (teamId: string) => void
  // The control directly above the panel — where Up out of either column
  // goes.
  exitUpFocusKey: string
  // The footer's primary action, so the viewer never has to walk every
  // competition to reach Continue.
  exitDownFocusKey: string
  onExitDown: (fromKey: string) => void
}

export function TeamBrowser({
  groups,
  activeGroup,
  selectedTeamIds,
  onActivateGroup,
  onToggleTeam,
  exitUpFocusKey,
  exitDownFocusKey,
  onExitDown,
}: Props) {
  // Two chains, one per column — see LeagueBrowser for why a single chain
  // can't describe a side-by-side master/detail panel.
  const railChain = useMemo<FocusChain>(() => groups.map((group) => [teamGroupFocusKey(group.competitionId)]), [groups])
  const gridChain = useMemo<FocusChain>(
    () => chunkIntoRows(activeGroup.teams.map((team) => teamFocusKey(team.id)), BROWSER_GRID_COLUMNS),
    [activeGroup],
  )

  const firstTeamKey = activeGroup.teams[0] ? teamFocusKey(activeGroup.teams[0].id) : null
  const activeGroupKey = teamGroupFocusKey(activeGroup.competitionId)

  return (
    <section className="league-browser team-browser">
      <h3 className="league-browser-rail-header">Competitions</h3>
      <div className="league-browser-detail-header">
        <h3 className="league-browser-region">{activeGroup.label}</h3>
        <span className="league-browser-region-meta">
          {activeGroup.teams.length} {activeGroup.teams.length === 1 ? 'team' : 'teams'}
        </span>
      </div>

      <div className="league-browser-rail">
        {groups.map((group) => (
          <CompetitionRow
            key={group.competitionId || 'other'}
            group={group}
            active={group.competitionId === activeGroup.competitionId}
            selectedCount={group.teams.reduce((count, team) => count + (selectedTeamIds.has(team.id) ? 1 : 0), 0)}
            chain={railChain}
            exitUpFocusKey={exitUpFocusKey}
            exitDownFocusKey={exitDownFocusKey}
            onExitDown={onExitDown}
            onActivate={onActivateGroup}
            firstTeamKey={group.competitionId === activeGroup.competitionId ? firstTeamKey : null}
          />
        ))}
      </div>

      {/* Keyed by competition so switching resets this pane's scroll
          position instead of inheriting the previous one's. */}
      <div className="league-browser-detail" key={activeGroup.competitionId || 'other'}>
        <div className="league-browser-grid">
          {activeGroup.teams.map((team) => {
            const key = teamFocusKey(team.id)
            return (
              <TeamCard
                key={team.id}
                team={team}
                selected={selectedTeamIds.has(team.id)}
                onToggle={() => onToggleTeam(team.id)}
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
                  onArrowLeft: isRowEdge(gridChain, key, 'left') ? () => void setFocus(activeGroupKey) : undefined,
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

// Same compact navigation row as the league browser's region rail — see
// RegionRow there for why focus alone browses (no OK press needed just to
// look at a competition).
function CompetitionRow({
  group,
  active,
  selectedCount,
  chain,
  firstTeamKey,
  exitUpFocusKey,
  exitDownFocusKey,
  onActivate,
  onExitDown,
}: {
  group: TeamGroup
  active: boolean
  selectedCount: number
  chain: FocusChain
  firstTeamKey: string | null
  exitUpFocusKey: string
  exitDownFocusKey: string
  onActivate: (competitionId: string) => void
  onExitDown: (fromKey: string) => void
}) {
  const focusKey = teamGroupFocusKey(group.competitionId)
  const enterGrid = () => {
    if (firstTeamKey) void setFocus(firstTeamKey)
  }

  const { ref, focused } = useFocusable({
    focusKey,
    onFocus: () => onActivate(group.competitionId),
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

  useFocusScrollIntoView(ref, focused, { block: 'nearest' })

  return (
    <div
      ref={ref}
      className={`region-row ${active ? 'active' : ''} ${focused ? 'focused' : ''}`}
      onClick={() => void setFocus(focusKey)}
    >
      <span className="region-row-label">{group.label}</span>
      {selectedCount > 0 ? (
        <span className="region-row-selected">{selectedCount} followed</span>
      ) : (
        <span className="region-row-count">{group.teams.length}</span>
      )}
    </div>
  )
}
