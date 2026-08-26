// "What sports and leagues do I care about?"
//
// Two compact toggle rows for the sports Ninety actually tracks, then a
// region-at-a-time league browser. Explicitly NOT the old screen's
// eight-column grid of all ~50 competitions: that was unreadable from a
// sofa, and its focus graph was a 50-node soup with nothing to orient
// against.
import { useMemo, useState } from 'react'
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useFootballCompetitions } from '../../data/sports/useFootballCompetitions'
import { groupLeaguesByRegion, initialRegion, selectedLeagues } from './settingsLeagueRegions'
import { gridNeighborIndex } from './settingsGrid'
import { SettingsColumnHeader, SettingsPaneHeader, SettingsRow } from './settingsPrimitives'
import { describeSavedTeams } from '../../data/sports/teamCatalog'
import { PANE_ENTRY_FOCUS_KEY, useSettingsFocusable } from './useSettingsFocusable'
import type { SportKey } from '../../data/sports/types'
import type { LeagueDef } from '../../data/sports/leagues'

const FOOTBALL_FOCUS_KEY = PANE_ENTRY_FOCUS_KEY
const F1_FOCUS_KEY = 'settings-sport-f1'
const MANAGE_TEAMS_FOCUS_KEY = 'settings-manage-teams'
// How many followed teams the summary names before collapsing the rest into
// "+N more". Three fits the pane's one line at the sofa-readable type size;
// the exact count is always shown next to the heading either way.
const TEAM_SUMMARY_LIMIT = 3
const LEAGUE_COLUMNS = 2
// Stable reference for the not-yet-loaded case — a fresh [] literal every
// render would defeat the memos below, re-grouping the whole catalog on
// every focus move.
const NO_LEAGUES: LeagueDef[] = []

function regionFocusKey(region: string): string {
  return `settings-region-${region}`
}
function leagueFocusKey(id: string): string {
  return `settings-league-${id}`
}

export function SportsLeaguesPane({
  sports,
  footballLeagueIds,
  onToggleSport,
  onToggleLeague,
  favoriteTeamIds,
  onManageTeams,
  onLeaveToRail,
}: {
  sports: SportKey[]
  footballLeagueIds: string[]
  onToggleSport: (sport: SportKey) => void
  onToggleLeague: (leagueId: string) => void
  // Canonical team ids. Shown here as a compact summary only — editing them
  // happens in TeamPickerDialog, because a club grid inline in this pane is
  // exactly the scrolling wall the Settings rebuild removed.
  favoriteTeamIds: string[]
  onManageTeams: () => void
  onLeaveToRail: () => void
}) {
  const competitions = useFootballCompetitions()
  const catalog = competitions.status === 'ready' ? competitions.leagues : NO_LEAGUES
  const footballSelected = sports.includes('football')

  const groups = useMemo(() => groupLeaguesByRegion(catalog, footballLeagueIds), [catalog, footballLeagueIds])
  const chosen = useMemo(() => selectedLeagues(catalog, footballLeagueIds), [catalog, footballLeagueIds])

  // Region chosen once, when the catalog first arrives — not derived on
  // every render. Selecting a league changes selectedCount, and a derived
  // "region with the most selections" would then be free to jump the browser
  // to a different region under the user's hand.
  const [activeRegion, setActiveRegion] = useState<string | null>(null)
  const resolvedRegion = activeRegion ?? initialRegion(groups)
  const activeGroup = groups.find((group) => group.region === resolvedRegion) ?? groups[0] ?? null

  const firstRegionKey = groups[0] ? regionFocusKey(groups[0].region) : FOOTBALL_FOCUS_KEY
  const goToLeagues = () => void setFocus(firstRegionKey)
  const goToTeams = () => void setFocus(MANAGE_TEAMS_FOCUS_KEY)

  // Names come from the local display cache (teamCatalog.ts), not from a
  // fetch: this summary has to be right the instant the pane opens, and it
  // has to keep working against a Ninety backend with no team catalogue at
  // all. Identity is still the id; this is only what to call it on screen.
  const followedTeams = useMemo(() => describeSavedTeams(favoriteTeamIds), [favoriteTeamIds])
  const teamSummary =
    followedTeams.length === 0
      ? 'None yet'
      : followedTeams
          .slice(0, TEAM_SUMMARY_LIMIT)
          .map((team) => team.name)
          .join(' · ') + (followedTeams.length > TEAM_SUMMARY_LIMIT ? ` · +${followedTeams.length - TEAM_SUMMARY_LIMIT} more` : '')

  return (
    <>
      <SettingsPaneHeader title="Sports & leagues" />

      <div className="settings-sports-row">
        <SettingsRow
          focusKey={FOOTBALL_FOCUS_KEY}
          label="Football"
          mark="check"
          selected={footballSelected}
          value={footballSelected ? 'On' : 'Off'}
          onEnter={() => onToggleSport('football')}
          onLeft={onLeaveToRail}
          onRight={() => void setFocus(F1_FOCUS_KEY)}
          onDown={goToLeagues}
        />
        <SettingsRow
          focusKey={F1_FOCUS_KEY}
          label="Formula 1"
          mark="check"
          selected={sports.includes('f1')}
          value={sports.includes('f1') ? 'On' : 'Off'}
          onEnter={() => onToggleSport('f1')}
          onLeft={() => void setFocus(FOOTBALL_FOCUS_KEY)}
          onRight={() => {}}
          onDown={goToLeagues}
        />
      </div>

      {!footballSelected && (
        <p className="settings-pane-hint">
          Turn Football on to choose the leagues Ninety follows. Your saved leagues are cleared when it's off, the same
          way onboarding treats them.
        </p>
      )}

      {footballSelected && competitions.status === 'loading' && <p className="settings-status">Loading competitions…</p>}
      {footballSelected && competitions.status === 'error' && (
        <p className="settings-status error">{competitions.message}</p>
      )}

      {footballSelected && competitions.status === 'ready' && (
        <>
          <SettingsColumnHeader title="Following" meta={`${chosen.length} ${chosen.length === 1 ? 'league' : 'leagues'}`} />
          <div className="settings-chips">
            {chosen.length === 0 && <p className="settings-pane-hint">Nothing followed yet — pick leagues below.</p>}
            {chosen.map((league) => (
              <LeagueChip key={league.id} league={league} onRemove={() => onToggleLeague(league.id)} onDown={goToTeams} onUp={() => void setFocus(FOOTBALL_FOCUS_KEY)} />
            ))}
          </div>

          {/* FAVORITE TEAMS — a summary and one action, deliberately. The
              full picker is a dialog (TeamPickerDialog); putting a club
              grid here would push the competition browser below the fold
              and turn this pane back into a scrolling page. */}
          <SettingsColumnHeader
            title="Favorite teams"
            meta={`${followedTeams.length} ${followedTeams.length === 1 ? 'team' : 'teams'}`}
          />
          <SettingsRow
            focusKey={MANAGE_TEAMS_FOCUS_KEY}
            label={teamSummary}
            sublabel="Ninety puts their matches first — wherever they're playing"
            value="Manage ›"
            onEnter={onManageTeams}
            onLeft={onLeaveToRail}
            onRight={onManageTeams}
            onUp={() => void setFocus(FOOTBALL_FOCUS_KEY)}
            onDown={goToLeagues}
          />

          <div className="settings-columns leagues">
            <div className="settings-column narrow">
              <SettingsColumnHeader title="Regions" />
              <div className="settings-list">
                {groups.map((group) => (
                  <SettingsRow
                    key={group.region}
                    focusKey={regionFocusKey(group.region)}
                    label={group.region}
                    value={group.selectedCount > 0 ? `${group.selectedCount} followed` : `${group.leagues.length}`}
                    selected={group.region === activeGroup?.region}
                    // Focus previews the region, exactly like the Channels
                    // filter's country column — no Enter needed just to look.
                    onFocus={() => setActiveRegion(group.region)}
                    onEnter={() => activeGroup?.leagues[0] && void setFocus(leagueFocusKey(activeGroup.leagues[0].id))}
                    onLeft={onLeaveToRail}
                    onRight={() => activeGroup?.leagues[0] && void setFocus(leagueFocusKey(activeGroup.leagues[0].id))}
                  />
                ))}
              </div>
            </div>

            <div className="settings-column">
              <SettingsColumnHeader title={activeGroup ? `${activeGroup.region} competitions` : 'Competitions'} />
              <div className="settings-league-grid">
                {activeGroup?.leagues.map((league, index) => (
                  <LeagueCard
                    key={league.id}
                    league={league}
                    selected={footballLeagueIds.includes(league.id)}
                    onToggle={() => onToggleLeague(league.id)}
                    onNeighbor={(direction) => {
                      const next = gridNeighborIndex(index, activeGroup.leagues.length, LEAGUE_COLUMNS, direction)
                      if (next != null) {
                        void setFocus(leagueFocusKey(activeGroup.leagues[next].id))
                        return
                      }
                      // Off the left edge, or off the top row, returns to
                      // the region rail — the nearest thing that is both
                      // visible and actionable. The remaining edges are
                      // simply the end of the grid: consumed, never allowed
                      // to escape to the screen root (which draws no focus
                      // ring at all and reads as a dead remote).
                      if (direction === 'left' || direction === 'up') void setFocus(regionFocusKey(activeGroup.region))
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function LeagueChip({
  league,
  onRemove,
  onUp,
  onDown,
}: {
  league: LeagueDef
  onRemove: () => void
  onUp: () => void
  onDown: () => void
}) {
  const { ref, focused } = useSettingsFocusable({ onEnter: onRemove, onUp, onDown })
  return (
    <button ref={ref} className={`settings-chip ${focused ? 'focused' : ''}`} onClick={onRemove}>
      {league.badge && <img className="settings-chip-badge" src={league.badge} alt="" />}
      <span>{league.name}</span>
      <span className="settings-chip-remove" aria-hidden="true">
        ✕
      </span>
    </button>
  )
}

function LeagueCard({
  league,
  selected,
  onToggle,
  onNeighbor,
}: {
  league: LeagueDef
  selected: boolean
  onToggle: () => void
  onNeighbor: (direction: 'left' | 'right' | 'up' | 'down') => void
}) {
  const { ref, focused } = useSettingsFocusable({
    focusKey: leagueFocusKey(league.id),
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
      <span className="settings-league-badge">{league.badge && <img src={league.badge} alt="" />}</span>
      <span className="settings-league-name">{league.name}</span>
      <span className={`settings-mark check ${selected ? 'on' : ''}`} />
    </button>
  )
}
