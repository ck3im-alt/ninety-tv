import { useEffect, useMemo, useState } from 'react'
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler, useFocusScrollIntoView } from '../../core/platform'
import { loadPreferences } from '../../data/preferences'
import { useTodaysSchedule } from '../../data/sports/useTodaysSchedule'
import { applyScheduleFilter, buildScheduleGroups, scheduleFilterOptions } from '../../data/sports/scheduleRanking'
import type { ScheduleFilterOption, ScheduleGroup } from '../../data/sports/scheduleRanking'
import { formatKickoffTime } from '../eventDetails/eventTimeFormat'
import type { SportEvent } from '../../data/sports/types'
import './ScheduleScreen.css'

// This screen replaced the old Competitions browser (pick a competition ->
// load it -> expand a round -> see fixtures). It answers one question
// instead: what football is on today. The app's internal screen id is still
// 'competitions' (see core/appScreens.ts) — renaming a persisted navigation
// identifier buys nothing and risks a stale value, so only the product
// surface changed.
const SCREEN_FOCUS_KEY = 'schedule-screen'
const BACK_FOCUS_KEY = 'schedule-back'
// The "All" pill has no competition id of its own; `null` is its value
// everywhere in the state, and this is just its focus key.
const ALL_PILL_FOCUS_KEY = 'schedule-pill-all'
const pillFocusKey = (competitionId: string) => `schedule-pill-${competitionId}`
const fixtureFocusKey = (eventId: string) => `schedule-fixture-${eventId}`

function LeaguePill({
  label,
  badge,
  focusKey,
  active,
  onSelect,
  onArrowUp,
  onArrowDown,
}: {
  label: string
  badge?: string
  focusKey: string
  active: boolean
  onSelect: () => void
  onArrowUp: () => void
  onArrowDown?: () => void
}) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onSelect,
    onArrowPress: (direction) => {
      if (direction === 'up') {
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
  // .schedule-pills scrolls its own horizontal overflow — a busy Saturday
  // has more competitions than fit one screen width, so arrow-navigating
  // past the visible pills has to bring the viewport along.
  useFocusScrollIntoView(ref, focused, { inline: 'nearest', block: 'nearest' })
  return (
    <button ref={ref} className={`league-pill ${active ? 'active' : ''} ${focused ? 'focused' : ''}`} onClick={onSelect}>
      {badge && <img src={badge} alt="" />}
      <span>{label}</span>
    </button>
  )
}

// One dense scan line per fixture. Everything a schedule reader needs is
// readable without moving focus: local kickoff time (or LIVE), both teams
// with crests, and the score when there is a real one. Competition context
// deliberately does NOT repeat here — it's the group header directly above.
//
// Crest/name order mirrors the Match View header exactly (crest outside the
// name on both sides, score innermost against the center) so a fixture reads
// the same way in the list as it does on the screen it opens.
//
// No match minute is shown. footballdata.io has no clock field at all (see
// SportEvent.liveClock), so anything beyond "LIVE" would be invented.
function FixtureRow({ event, onSelect, onArrowUp }: { event: SportEvent; onSelect: (event: SportEvent) => void; onArrowUp?: () => void }) {
  const { ref, focused } = useFocusable({
    focusKey: fixtureFocusKey(event.id),
    onEnterPress: () => onSelect(event),
    onArrowPress: (direction) => {
      if (direction === 'up' && onArrowUp) {
        onArrowUp()
        return false
      }
      return true
    },
  })
  // The whole screen owns vertical scrolling (see .schedule-screen's
  // overflow-y: auto) — a full Saturday is several screens tall.
  useFocusScrollIntoView(ref, focused)

  const hasScore = event.homeScore != null && event.awayScore != null
  const isTeamFixture = Boolean(event.homeTeam && event.awayTeam)

  return (
    <div ref={ref} className={`fixture-row ${focused ? 'focused' : ''}`} onClick={() => onSelect(event)}>
      <span className="fixture-row-time">
        {event.isLive ? (
          <span className="fixture-row-live">
            <span className="fixture-row-live-dot" />
            LIVE
          </span>
        ) : event.status === 'complete' ? (
          // A real backend-confirmed final result, the same signal Event
          // Details renders as "FINISHED" — not a guess about a match whose
          // kickoff time has merely passed.
          <span className="fixture-row-ft">FT</span>
        ) : (
          formatKickoffTime(event.dateTimeUtc)
        )}
      </span>
      {isTeamFixture ? (
        <>
          <span className="fixture-row-team fixture-row-team-home">
            {event.homeBadge && <img src={event.homeBadge} alt="" />}
            <span className="fixture-row-team-name">{event.homeTeam}</span>
          </span>
          <span className={`fixture-row-center ${hasScore ? 'has-score' : ''}`}>
            {hasScore ? `${event.homeScore} – ${event.awayScore}` : 'VS'}
          </span>
          <span className="fixture-row-team fixture-row-team-away">
            <span className="fixture-row-team-name">{event.awayTeam}</span>
            {event.awayBadge && <img src={event.awayBadge} alt="" />}
          </span>
        </>
      ) : (
        // No two named sides (a competition-level entry with no teams
        // resolved yet) — the event's own title takes the whole row rather
        // than rendering an empty matchup.
        <span className="fixture-row-title">{event.title}</span>
      )}
    </div>
  )
}

function CompetitionSection({
  group,
  onSelectEvent,
  firstRowArrowUp,
}: {
  group: ScheduleGroup
  onSelectEvent: (event: SportEvent) => void
  // Only the very first row on the whole page needs an explicit Up escape
  // back to the pill row; everywhere else geometry handles it.
  firstRowArrowUp?: () => void
}) {
  return (
    <section className="schedule-group">
      <h2 className="schedule-group-title">
        {group.competitionBadge && <img src={group.competitionBadge} alt="" />}
        <span>{group.competitionName}</span>
      </h2>
      <div className="fixture-list">
        {group.fixtures.map((event, index) => (
          <FixtureRow
            key={event.id}
            event={event}
            onSelect={onSelectEvent}
            onArrowUp={index === 0 ? firstRowArrowUp : undefined}
          />
        ))}
      </div>
    </section>
  )
}

export function ScheduleScreen({ onSelectEvent, onBack }: { onSelectEvent: (event: SportEvent) => void; onBack: () => void }) {
  const scheduleState = useTodaysSchedule()
  // null = the "All" pill, which is the state this screen always opens in.
  // Selecting a league is the ONLY thing that narrows the day.
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string | null>(null)

  // Read once per mount, not per render: this screen is lazy-mounted fresh on
  // every navigation to it, so a preference changed in Settings is picked up
  // the next time Schedule is opened, without this re-reading localStorage on
  // every render or re-grouping fixtures because the array identity changed.
  const favoriteLeagueIds = useMemo(() => loadPreferences().footballLeagueIds, [])

  const fixtures = scheduleState.status === 'ready' ? scheduleState.fixtures : null
  const groups = useMemo(() => (fixtures ? buildScheduleGroups(fixtures, favoriteLeagueIds) : []), [fixtures, favoriteLeagueIds])
  const filterOptions: ScheduleFilterOption[] = useMemo(() => scheduleFilterOptions(groups), [groups])
  const visibleGroups = useMemo(() => applyScheduleFilter(groups, selectedCompetitionId), [groups, selectedCompetitionId])

  useBackHandler(() => {
    onBack()
    return true
  })

  const { ref, focusKey } = useFocusable({
    focusKey: SCREEN_FOCUS_KEY,
    trackChildren: true,
    // Back is the one target that exists from the very first frame; All takes
    // over the moment the day's fixtures land (see the transition effect
    // below). Same "always resolvable at mount" contract App.tsx's
    // SCREEN_FOCUS_KEYS relies on for every lazy screen.
    preferredChildFocusKey: filterOptions.length > 0 ? ALL_PILL_FOCUS_KEY : BACK_FOCUS_KEY,
  })

  // One-shot focus transfer on the loading -> ready transition (not on every
  // render), matching the pattern the old Competitions screen and Event
  // Details both use. While loading, Back is the only focusable target.
  useEffect(() => {
    if (scheduleState.status === 'ready') void setFocus(ALL_PILL_FOCUS_KEY)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleState.status])

  const { ref: backRef, focused: backFocused } = useFocusable({ focusKey: BACK_FOCUS_KEY, onEnterPress: onBack })
  useFocusScrollIntoView(backRef, backFocused)

  const firstFixtureId = visibleGroups[0]?.fixtures[0]?.id
  const pillArrowDown = firstFixtureId ? () => void setFocus(fixtureFocusKey(firstFixtureId)) : undefined
  const firstRowArrowUp = () => void setFocus(selectedCompetitionId ? pillFocusKey(selectedCompetitionId) : ALL_PILL_FOCUS_KEY)

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} className="schedule-screen">
        <div className="schedule-header">
          <h1 className="schedule-title">Schedule</h1>
          <button ref={backRef} className={`back-link ${backFocused ? 'focused' : ''}`} onClick={onBack}>
            ← Back
          </button>
        </div>

        <p className="schedule-day">Today</p>

        {filterOptions.length > 0 && (
          <div className="schedule-pills">
            <LeaguePill
              label="All"
              focusKey={ALL_PILL_FOCUS_KEY}
              active={selectedCompetitionId == null}
              onSelect={() => setSelectedCompetitionId(null)}
              onArrowUp={() => void setFocus(BACK_FOCUS_KEY)}
              onArrowDown={pillArrowDown}
            />
            {filterOptions.map((option) => (
              <LeaguePill
                key={option.competitionId}
                label={option.competitionName}
                badge={option.competitionBadge}
                focusKey={pillFocusKey(option.competitionId)}
                active={option.competitionId === selectedCompetitionId}
                onSelect={() => setSelectedCompetitionId(option.competitionId)}
                onArrowUp={() => void setFocus(BACK_FOCUS_KEY)}
                onArrowDown={pillArrowDown}
              />
            ))}
          </div>
        )}

        {scheduleState.status === 'loading' && <p className="schedule-status">Loading today's schedule…</p>}
        {scheduleState.status === 'error' && <p className="schedule-status">Unable to load today's schedule.</p>}
        {scheduleState.status === 'ready' && visibleGroups.length === 0 && <p className="schedule-status">No fixtures today.</p>}

        {visibleGroups.map((group, index) => (
          <CompetitionSection
            key={group.competitionId}
            group={group}
            onSelectEvent={onSelectEvent}
            firstRowArrowUp={index === 0 ? firstRowArrowUp : undefined}
          />
        ))}
      </main>
    </FocusContext.Provider>
  )
}
