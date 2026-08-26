// Settings' "Manage teams" picker.
//
// A DIALOG, NOT A SECTION. The Sports & leagues pane already carries two
// sport toggles, a followed-leagues chip row and a region/competition
// browser inside one 1080px canvas; a club grid on top of that would be the
// 3000px scrolling page the Settings rebuild exists to remove. So the pane
// shows a compact summary and this opens over it.
//
// It shares its DATA with onboarding — the same teamCatalog fetch, the same
// suggestTeams/groupTeamsByCompetition rules, the same withTeamToggled
// mutation — and NOT its components, which is the convention this screen
// already follows (see settingsPrimitives.tsx's header for why onboarding's
// full-bleed card grid is wrong here). Two pickers, one model.
//
// REMOTE-FIRST. Browsing by competition is the primary path and needs no
// typing at all: rail on the left, that competition's clubs on the right.
// The search field exists for the club that is not in a followed league,
// and is deliberately the second thing on the screen rather than the first.
import { useMemo, useRef, useState } from 'react'
import { FocusContext, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useModalFocusScope, useSpatialTextInput } from '../../core/platform'
import { useDebouncedValue } from '../channels/useDebouncedValue'
import { useTeamCatalog } from '../../data/sports/useTeamCatalog'
import { useTeamSearch } from '../../data/sports/useTeamSearch'
import { groupTeamsByCompetition } from '../../data/sports/teamSuggestions'
import { gridNeighborIndex } from './settingsGrid'
import { SettingsAction, SettingsColumnHeader, SettingsRow } from './settingsPrimitives'
import { useSettingsFocusable } from './useSettingsFocusable'
import type { TeamDef } from '../../data/sports/teamCatalog'
import type { LeagueDef } from '../../data/sports/leagues'

const DIALOG_FOCUS_KEY = 'settings-team-picker'
const SEARCH_FOCUS_KEY = 'settings-team-search'
const DONE_FOCUS_KEY = 'settings-team-done'
const TEAM_COLUMNS = 2

const groupRowKey = (competitionId: string) => `settings-teamgroup-${competitionId || 'other'}`
const teamCardKey = (teamId: string) => `settings-team-${teamId}`

export function TeamPickerDialog({
  followedLeagues,
  selectedTeamIds,
  onToggleTeam,
  onClose,
}: {
  // The viewer's followed competitions, in their own order — both the
  // catalogue scope and the rail's order.
  followedLeagues: LeagueDef[]
  selectedTeamIds: string[]
  onToggleTeam: (teamId: string) => void
  onClose: () => void
}) {
  const competitionIds = useMemo(() => followedLeagues.map((league) => league.id), [followedLeagues])
  const catalogState = useTeamCatalog(competitionIds)
  const teams = catalogState.status === 'ready' ? catalogState.teams : NO_TEAMS

  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // Debounced so a remote's on-screen keyboard doesn't fire a request per
  // keystroke — the same treatment the channel browser's search already
  // gets.
  const debouncedQuery = useDebouncedValue(query, 300)
  const searchState = useTeamSearch(debouncedQuery)

  const competitionNames = useMemo(() => new Map(followedLeagues.map((league) => [league.id, league.name])), [followedLeagues])
  const groups = useMemo(
    () => groupTeamsByCompetition(teams, competitionNames, competitionIds),
    [teams, competitionNames, competitionIds],
  )
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const activeGroup = groups.find((group) => group.competitionId === activeGroupId) ?? groups[0] ?? null

  const searching = debouncedQuery.trim().length > 0
  // Search results REPLACE the grid rather than filtering the rail: the two
  // are different questions ("show me this competition" vs "find this
  // club"), and quietly narrowing a competition to two clubs would look
  // like the catalogue had shrunk.
  const shown: TeamDef[] = searching ? (searchState.status === 'ready' ? searchState.teams : NO_TEAMS) : (activeGroup?.teams ?? NO_TEAMS)

  const { ref: fieldRef, focused: fieldFocused } = useSpatialTextInput(inputRef, {
    focusKey: SEARCH_FOCUS_KEY,
    // Down leaves the field for the lists; every other direction stays put
    // rather than escaping the dialog.
    onArrowPress: (direction) => direction !== 'down',
  })

  // Declared AFTER the field, so this hook's focus effect runs once the
  // field has registered — same ordering requirement SettingsPromptDialog
  // documents.
  const { ref, focusKey } = useModalFocusScope({
    focusKey: DIALOG_FOCUS_KEY,
    onClose,
    preferredChildFocusKey: SEARCH_FOCUS_KEY,
  })

  const firstTeamKey = shown[0] ? teamCardKey(shown[0].id) : null
  const firstGroupKey = groups[0] ? groupRowKey(groups[0].competitionId) : null
  const enterLists = () => {
    if (searching && firstTeamKey) void setFocus(firstTeamKey)
    else if (firstGroupKey) void setFocus(firstGroupKey)
    else void setFocus(DONE_FOCUS_KEY)
  }

  return (
    <div className="settings-overlay">
      <FocusContext.Provider value={focusKey}>
        <div ref={ref} className="settings-dialog wide settings-team-dialog" role="dialog" aria-label="Manage teams">
          <h2 className="settings-dialog-title">
            Teams you follow
            <span className="settings-pane-meta">
              {selectedTeamIds.length} {selectedTeamIds.length === 1 ? 'team' : 'teams'}
            </span>
          </h2>
          <p className="settings-dialog-body">
            Ninety puts matches involving these teams first on your Home screen — wherever they're playing.
          </p>

          <div ref={fieldRef} className={`settings-field ${fieldFocused ? 'focused' : ''}`}>
            <input
              ref={inputRef}
              className="settings-input"
              type="text"
              placeholder="Search for a team"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {/* Every non-ready state is stated plainly rather than left as an
              empty grid. "Not available yet" is specifically the case where
              this Ninety backend has no team catalogue — a fact about the
              deployment, not a failure. */}
          {catalogState.status === 'loading' && <p className="settings-status">Loading teams…</p>}
          {catalogState.status === 'unavailable' && (
            <p className="settings-status">Following teams isn't available from your Ninety server yet.</p>
          )}
          {catalogState.status === 'error' && <p className="settings-status error">{catalogState.message}</p>}
          {catalogState.status === 'ready' && competitionIds.length === 0 && (
            <p className="settings-pane-hint">Follow a league first and its teams will appear here.</p>
          )}

          <div className="settings-columns leagues">
            <div className="settings-column narrow">
              <SettingsColumnHeader title="Competitions" />
              <div className="settings-list">
                {groups.map((group) => (
                  <SettingsRow
                    key={group.competitionId || 'other'}
                    focusKey={groupRowKey(group.competitionId)}
                    label={group.label}
                    value={
                      group.teams.some((team) => selectedTeamIds.includes(team.id))
                        ? `${group.teams.filter((team) => selectedTeamIds.includes(team.id)).length} followed`
                        : `${group.teams.length}`
                    }
                    selected={group.competitionId === activeGroup?.competitionId}
                    // Focusing a rail row browses it, exactly like the
                    // league browser above — no Enter needed just to look.
                    // It also clears an active search, because otherwise
                    // picking a competition would appear to do nothing.
                    onFocus={() => {
                      setActiveGroupId(group.competitionId)
                      if (query) setQuery('')
                    }}
                    onEnter={() => firstTeamKey && void setFocus(firstTeamKey)}
                    onLeft={() => {}}
                    onRight={() => firstTeamKey && void setFocus(firstTeamKey)}
                  />
                ))}
              </div>
            </div>

            <div className="settings-column">
              <SettingsColumnHeader
                title={searching ? 'Search results' : (activeGroup?.label ?? 'Teams')}
                meta={searching && searchState.status === 'loading' ? 'Searching…' : undefined}
              />
              {searching && searchState.status === 'unavailable' && (
                <p className="settings-status">Search isn't available from your Ninety server yet — browse by competition instead.</p>
              )}
              {searching && searchState.status === 'ready' && shown.length === 0 && (
                <p className="settings-status">No teams match "{debouncedQuery}".</p>
              )}
              <div className="settings-league-grid">
                {shown.map((team, index) => (
                  <TeamRow
                    key={team.id}
                    team={team}
                    selected={selectedTeamIds.includes(team.id)}
                    onToggle={() => onToggleTeam(team.id)}
                    onNeighbor={(direction) => {
                      const next = gridNeighborIndex(index, shown.length, TEAM_COLUMNS, direction)
                      if (next != null) {
                        void setFocus(teamCardKey(shown[next].id))
                        return
                      }
                      // Off the left edge or the top row goes back to the
                      // rail (or the search field when searching, since
                      // there is no meaningful rail row to return to). The
                      // remaining edges are the end of the grid: consumed,
                      // never allowed to escape to the screen root.
                      if (direction === 'left' || direction === 'up') {
                        if (searching) void setFocus(SEARCH_FOCUS_KEY)
                        else if (activeGroup) void setFocus(groupRowKey(activeGroup.competitionId))
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="settings-dialog-actions">
            {/* No Cancel. Every toggle in this dialog is saved the instant
                it happens (the same immediate persistence the rest of
                Settings uses), so an action promising to undo them would be
                a lie. Back does exactly what Done does. */}
            <SettingsAction
              focusKey={DONE_FOCUS_KEY}
              label="Done"
              tone="primary"
              onEnter={onClose}
              onUp={enterLists}
              onLeft={() => {}}
              onRight={() => {}}
            />
          </div>
        </div>
      </FocusContext.Provider>
    </div>
  )
}

// Stable identity for the not-loaded case, so the memos above don't see a
// new array on every render.
const NO_TEAMS: TeamDef[] = []

function TeamRow({
  team,
  selected,
  onToggle,
  onNeighbor,
}: {
  team: TeamDef
  selected: boolean
  onToggle: () => void
  onNeighbor: (direction: 'left' | 'right' | 'up' | 'down') => void
}) {
  const { ref, focused } = useSettingsFocusable({
    focusKey: teamCardKey(team.id),
    onEnter: onToggle,
    onLeft: () => onNeighbor('left'),
    onRight: () => onNeighbor('right'),
    onUp: () => onNeighbor('up'),
    onDown: () => onNeighbor('down'),
  })
  return (
    <button
      ref={ref}
      className={`settings-league-card ${selected ? 'selected' : ''} ${focused ? 'focused' : ''}`}
      onClick={onToggle}
    >
      <span className="settings-league-badge">{team.logo && <img src={team.logo} alt="" />}</span>
      <span className="settings-league-name">{team.name}</span>
      <span className={`settings-mark check ${selected ? 'on' : ''}`} />
    </button>
  )
}
