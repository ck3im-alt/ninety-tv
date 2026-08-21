import { useEffect, useState } from 'react'
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler, useFocusScrollIntoView } from '../../core/platform'
import type { LeagueDef } from '../../data/sports/leagues'
import { useFootballCompetitions } from '../../data/sports/useFootballCompetitions'
import { useCompetitionFixtures, LOOKAHEAD_DAYS } from '../../data/sports/useCompetitionFixtures'
import type { SportEvent } from '../../data/sports/types'
import './CompetitionsScreen.css'

const ROOT_FOCUS_KEY = 'competitions-screen'
const BACK_FOCUS_KEY = 'competitions-back'
const leaguePillFocusKey = (id: string) => `league-pill-${id}`
const roundHeaderFocusKey = (name: string) => `round-header-${name}`

function LeaguePill({
  league,
  active,
  onSelect,
  onArrowUp,
  onArrowDown,
}: {
  league: LeagueDef
  active: boolean
  onSelect: () => void
  onArrowUp: () => void
  onArrowDown?: () => void
}) {
  const { ref, focused } = useFocusable({
    focusKey: leaguePillFocusKey(league.id),
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
  // .league-pills scrolls its own horizontal overflow (50 competitions
  // don't fit in one screen width) — without this, arrow-navigating past
  // the visible pills moved focus without the viewport following it.
  useFocusScrollIntoView(ref, focused, { inline: 'nearest', block: 'nearest' })
  return (
    <button ref={ref} className={`league-pill ${active ? 'active' : ''} ${focused ? 'focused' : ''}`} onClick={onSelect}>
      {league.badge && <img src={league.badge} alt="" />}
      <span>{league.sportLabel === 'FOOTBALL' ? league.name : league.sportLabel}</span>
    </button>
  )
}

function RoundHeader({
  name,
  matchCount,
  expanded,
  onToggle,
  onArrowUp,
}: {
  name: string
  matchCount: number
  expanded: boolean
  onToggle: () => void
  onArrowUp?: () => void
}) {
  // Was a plain DOM <button onClick> — completely unreachable by remote,
  // and since it's the only way to expand/collapse a round, that meant a
  // collapsed round's fixtures were unreachable too.
  const { ref, focused } = useFocusable({
    focusKey: roundHeaderFocusKey(name),
    onEnterPress: onToggle,
    onArrowPress: (direction) => {
      if (direction === 'up' && onArrowUp) {
        onArrowUp()
        return false
      }
      return true
    },
  })
  useFocusScrollIntoView(ref, focused)
  return (
    <button ref={ref} className={`round-header ${expanded ? 'expanded' : ''} ${focused ? 'focused' : ''}`} onClick={onToggle}>
      {name}
      <span className="round-count">{matchCount} matches</span>
    </button>
  )
}

function FixtureRow({ event, onSelect }: { event: SportEvent; onSelect: (event: SportEvent) => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: () => onSelect(event) })
  // The whole screen (not a nested list) owns vertical scrolling here (see
  // .competitions-screen's overflow-y: auto) — a round expanding can easily
  // push fixtures, and everything below them, out of the viewport.
  useFocusScrollIntoView(ref, focused)
  return (
    <div ref={ref} className={`fixture-row ${focused ? 'focused' : ''}`} onClick={() => onSelect(event)}>
      <span className="fixture-row-time">{event.timeLabel}</span>
      <span className="fixture-row-team">
        {event.homeBadge && <img src={event.homeBadge} alt="" />}
        {event.homeTeam}
      </span>
      <span className="fixture-row-vs">vs</span>
      <span className="fixture-row-team">
        {event.awayBadge && <img src={event.awayBadge} alt="" />}
        {event.awayTeam}
      </span>
      {event.isLive && <span className="fixture-row-live">LIVE</span>}
    </div>
  )
}

export function CompetitionsScreen({ onSelectEvent, onBack }: { onSelectEvent: (event: SportEvent) => void; onBack: () => void }) {
  const competitionsState = useFootballCompetitions()
  // Starts null since the catalog is now an async fetch (GET
  // /v1/competitions) rather than a hardcoded local array — set to the
  // first competition once the catalog is ready, below.
  const [selectedLeague, setSelectedLeague] = useState<LeagueDef | null>(null)
  // Which round is expanded — defaults to the first (earliest) one returned,
  // i.e. the competition's next unplayed gameweek/stage, every time the
  // fixture list loads for a newly picked league.
  const [expandedRound, setExpandedRound] = useState<string | null>(null)
  const fixturesState = useCompetitionFixtures(selectedLeague)

  useEffect(() => {
    if (competitionsState.status === 'ready' && selectedLeague === null && competitionsState.leagues.length > 0) {
      setSelectedLeague(competitionsState.leagues[0])
    }
  }, [competitionsState, selectedLeague])

  useEffect(() => {
    if (fixturesState.status === 'ready' && fixturesState.rounds.length > 0) {
      setExpandedRound(fixturesState.rounds[0].name)
    }
  }, [fixturesState])

  useBackHandler(() => {
    onBack()
    return true
  })

  const leagues = competitionsState.status === 'ready' ? competitionsState.leagues : []
  const rounds = fixturesState.status === 'ready' ? fixturesState.rounds : []
  const firstRoundFocusKey = rounds[0] ? roundHeaderFocusKey(rounds[0].name) : undefined

  // This screen is lazy-loaded (see App.tsx's SCREEN_FOCUS_KEYS) — targeted
  // by its own root key rather than ROOT_FOCUS_KEY so the initial-focus
  // effect resolves correctly even if `screen` changes to 'competitions'
  // before this chunk finishes loading. Previously nothing on this screen
  // used forceFocus at all, so it was never reliably focused on arrival —
  // preferredChildFocusKey here replaces that with an explicit, always-
  // resolvable-at-mount target (Back is always available immediately;
  // becomes the first league pill once the catalog is ready, below).
  const { ref, focusKey } = useFocusable({
    focusKey: ROOT_FOCUS_KEY,
    trackChildren: true,
    preferredChildFocusKey: leagues[0] ? leaguePillFocusKey(leagues[0].id) : BACK_FOCUS_KEY,
  })

  // Advances focus onto the first league pill the moment the catalog
  // becomes ready, but only on that transition (not on every subsequent
  // rerender) — mirrors the same "explicit one-shot transfer on a status
  // transition" pattern used for Event Details' #1 stream (see that
  // screen). While loading, Back is the only focusable target anyway.
  useEffect(() => {
    if (competitionsState.status === 'ready' && competitionsState.leagues.length > 0) {
      void setFocus(leaguePillFocusKey(competitionsState.leagues[0].id))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionsState.status])

  const { ref: backRef, focused: backFocused } = useFocusable({ focusKey: BACK_FOCUS_KEY, onEnterPress: onBack })
  useFocusScrollIntoView(backRef, backFocused)

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} className="competitions-screen">
        <div className="competitions-header">
          <h1 className="competitions-title">Competitions</h1>
          <button ref={backRef} className={`back-link ${backFocused ? 'focused' : ''}`} onClick={onBack}>
            ← Back
          </button>
        </div>

        {competitionsState.status === 'loading' && <p className="competitions-status">Loading competitions…</p>}
        {competitionsState.status === 'error' && <p className="competitions-status">{competitionsState.message}</p>}

        {competitionsState.status === 'ready' && (
          <div className="league-pills">
            {leagues.map((league) => (
              <LeaguePill
                key={league.id}
                league={league}
                active={league.id === selectedLeague?.id}
                onSelect={() => setSelectedLeague(league)}
                onArrowUp={() => void setFocus(BACK_FOCUS_KEY)}
                onArrowDown={firstRoundFocusKey ? () => void setFocus(firstRoundFocusKey) : undefined}
              />
            ))}
          </div>
        )}

        {fixturesState.status === 'loading' && <p className="competitions-status">Loading fixtures…</p>}
        {fixturesState.status === 'error' && <p className="competitions-status">{fixturesState.message}</p>}
        {fixturesState.status === 'ready' && rounds.length === 0 && (
          <p className="competitions-status">No fixtures found in the next {LOOKAHEAD_DAYS} days.</p>
        )}

        {fixturesState.status === 'ready' && (
          <div className="rounds-list">
            {rounds.map((round, index) => {
              const isExpanded = round.name === expandedRound
              return (
                <div key={round.name} className="round-group">
                  <RoundHeader
                    name={round.name}
                    matchCount={round.fixtures.length}
                    expanded={isExpanded}
                    onToggle={() => setExpandedRound(isExpanded ? null : round.name)}
                    onArrowUp={
                      index === 0
                        ? () => void setFocus(leagues[0] ? leaguePillFocusKey(leagues[0].id) : BACK_FOCUS_KEY)
                        : undefined
                    }
                  />
                  {isExpanded && (
                    <div className="fixture-list">
                      {round.fixtures.map((event) => (
                        <FixtureRow key={event.id} event={event} onSelect={onSelectEvent} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </FocusContext.Provider>
  )
}
