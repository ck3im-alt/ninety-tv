import { useMemo } from 'react'
import { setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useFocusScrollIntoView } from '../../core/platform'
import type { TeamDef } from '../../data/sports/teamCatalog'
import type { TeamCatalogState } from '../../data/sports/useTeamCatalog'
import { chunkIntoRows, isRowEdge, verticalNeighbour, type FocusChain } from './focusChain'
import { BLOCK_ARROW } from './SelectableCard'
import { teamFocusKey, teamGroupFocusKey } from './teamFocusKeys'
import { TeamCard } from './TeamCard'
import './TeamBrowser.css'

// The club browser on onboarding's Teams step: a master/detail panel with
// competitions down the rail and one competition's clubs in the grid.
//
// Its stylesheet was LeagueBrowser.css until 2026-08-28 — the leagues step
// used the identical panel with countries down the rail and the two
// deliberately shared one vocabulary. The leagues step now has a paginated
// full-width browser instead (CompetitionBrowser.tsx), so this panel is the
// stylesheet's only consumer and owns it; the `.league-browser*` class
// names stayed as they were rather than churning a step that redesign was
// not touching. The `team-browser` class exists so layout rules can name
// this one specifically.
//
// LAZY, AND THAT IS THE POINT. The rail lists every competition Ninety
// tracks, not only the ones the viewer selected — league selection
// PRIORITIZES clubs, it does not restrict which ones exist (a Norwegian
// viewer who follows only Eliteserien can still follow Real Madrid). Rosters
// for ~50 competitions are far too much to fetch up front, so this component
// renders whatever roster the caller currently has and says so when it is
// still coming; the caller fetches the active competition alone (see
// useCompetitionTeams) and debounces the rail so scrolling costs nothing.
//
// NO TYPING REQUIRED anywhere in here: every club is reachable with the
// D-pad — rail down to a competition, right into its grid.
const BROWSER_GRID_COLUMNS = 5

// One rail row. Deliberately NOT a TeamGroup: the rail knows every
// competition, while teams are only ever loaded for the one being looked
// at, so a rail row cannot carry a roster.
export interface TeamRailGroup {
  competitionId: string
  label: string
  // The competition's region/country, shown when the viewer has followed
  // nothing in it yet. Quiet context, so a rail of 50 rows is scannable.
  meta?: string
  // How many of the viewer's followed clubs belong to this competition, as
  // far as the app has actually seen its roster. Zero (rather than unknown)
  // for a competition never loaded this session — see the accumulator in
  // OnboardingTeamsScreen.
  followedCount: number
}

interface Props {
  groups: readonly TeamRailGroup[]
  activeCompetitionId: string
  activeLabel: string
  // The active competition's clubs. Empty while `status` is anything but
  // 'ready'.
  teams: readonly TeamDef[]
  status: TeamCatalogState['status']
  selectedTeamIds: ReadonlySet<string>
  onActivateGroup: (competitionId: string) => void
  onToggleTeam: (teamId: string) => void
  // Where Up out of the top of either column goes — the suggestions row
  // above the panel.
  exitUpFocusKey: string
  // The footer's primary action, so the viewer never has to walk every
  // competition to reach Continue.
  exitDownFocusKey: string
  onExitDown: (fromKey: string) => void
}

export function TeamBrowser({
  groups,
  activeCompetitionId,
  activeLabel,
  teams,
  status,
  selectedTeamIds,
  onActivateGroup,
  onToggleTeam,
  exitUpFocusKey,
  exitDownFocusKey,
  onExitDown,
}: Props) {
  // Two chains, one per column. focusChain.ts models a STACK of rows,
  // which is exactly what each column of this panel is — the rail is a
  // column of one-cell rows, the grid a column of BROWSER_GRID_COLUMNS-cell
  // rows — but the two sit side by side, so a single chain could not
  // describe them. Left and Right cross between the columns explicitly
  // below; everything vertical falls out of the model, partly-filled last
  // grid row included.
  const railChain = useMemo<FocusChain>(() => groups.map((group) => [teamGroupFocusKey(group.competitionId)]), [groups])
  const gridChain = useMemo<FocusChain>(
    () => chunkIntoRows(teams.map((team) => teamFocusKey(team.id)), BROWSER_GRID_COLUMNS),
    [teams],
  )

  const firstTeamKey = teams[0] ? teamFocusKey(teams[0].id) : null
  const activeGroupKey = teamGroupFocusKey(activeCompetitionId)

  return (
    <section className="league-browser team-browser">
      <h3 className="league-browser-rail-header">Competitions</h3>
      <div className="league-browser-detail-header">
        <h3 className="league-browser-region">{activeLabel}</h3>
        <span className="league-browser-region-meta">
          {status === 'ready' ? `${teams.length} ${teams.length === 1 ? 'team' : 'teams'}` : ' '}
        </span>
      </div>

      <div className="league-browser-rail">
        {groups.map((group) => (
          <CompetitionRow
            key={group.competitionId || 'other'}
            group={group}
            active={group.competitionId === activeCompetitionId}
            chain={railChain}
            exitUpFocusKey={exitUpFocusKey}
            exitDownFocusKey={exitDownFocusKey}
            onExitDown={onExitDown}
            onActivate={onActivateGroup}
            firstTeamKey={group.competitionId === activeCompetitionId ? firstTeamKey : null}
          />
        ))}
      </div>

      {/* Keyed by competition so switching resets this pane's scroll
          position instead of inheriting the previous one's. */}
      <div className="league-browser-detail" key={activeCompetitionId || 'other'}>
        {/* The pane is a fixed height (the panel owns it), so none of these
            states can move anything on the page — they only decide what
            fills a box that is already there. */}
        {status === 'loading' && <p className="picker-status">Loading teams...</p>}
        {status === 'unavailable' && (
          <p className="picker-status">Following teams isn't available yet — you can add them later in Settings.</p>
        )}
        {status === 'error' && <p className="picker-status">Couldn't load teams right now. You can add them later in Settings.</p>}
        {status === 'ready' && teams.length === 0 && (
          <p className="picker-status">Ninety doesn't track any teams for this competition yet.</p>
        )}

        <div className="league-browser-grid">
          {teams.map((team) => {
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
                  // The competition is the PARENT of its grid: Left out of
                  // the first column returns to the row you came in on.
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

// A compact navigation row, deliberately NOT a card: this is what you move
// through to browse, and it has to stay small enough that fifty of them fit
// in a panel that also has to hold a club grid.
//
// FOCUS ALONE BROWSES — moving through the rail loads and shows the
// competition immediately, with no OK press needed just to look at one,
// which is what makes this feel like a TV master/detail rather than a menu
// of links. Nothing is persisted by focusing; only the cards on the right
// toggle a preference.
function CompetitionRow({
  group,
  active,
  chain,
  firstTeamKey,
  exitUpFocusKey,
  exitDownFocusKey,
  onActivate,
  onExitDown,
}: {
  group: TeamRailGroup
  active: boolean
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
      {/* The viewer's own selections once there are any, so a glance down
          the rail says where they have picked clubs; otherwise the quiet
          region label. Accent TEXT only — never a green row, which would
          out-shout the focus ring. */}
      {group.followedCount > 0 ? (
        <span className="region-row-selected">{group.followedCount} followed</span>
      ) : (
        group.meta && <span className="region-row-count">{group.meta}</span>
      )}
    </div>
  )
}
