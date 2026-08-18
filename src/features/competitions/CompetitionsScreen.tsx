import { useEffect, useState } from 'react'
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler } from '../../core/platform'
import { FOOTBALL_LEAGUES } from '../../data/sports/leagues'
import type { LeagueDef } from '../../data/sports/leagues'
import { useCompetitionFixtures, LOOKAHEAD_DAYS } from '../../data/sports/useCompetitionFixtures'
import type { SportEvent } from '../../data/sports/types'
import './CompetitionsScreen.css'

function LeaguePill({ league, active, onSelect }: { league: LeagueDef; active: boolean; onSelect: () => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: onSelect })
  return (
    <button ref={ref} className={`league-pill ${active ? 'active' : ''} ${focused ? 'focused' : ''}`} onClick={onSelect}>
      {league.badge && <img src={league.badge} alt="" />}
      <span>{league.sportLabel === 'FOOTBALL' ? leagueShortName(league) : league.sportLabel}</span>
    </button>
  )
}

// LeagueDef carries no display name of its own (leagues.ts identifies
// leagues by id/badge, with the human-readable name only living in a code
// comment) — the badge image already carries the crest, so this only needs
// to disambiguate leagues sharing the same generic "FOOTBALL" sportLabel
// for the pill's text.
const FOOTBALL_LEAGUE_NAMES: Record<string, string> = {
  '4328': 'Premier League',
  '4480': 'Champions League',
  '4335': 'La Liga',
  '4332': 'Serie A',
  '4331': 'Bundesliga',
  '4334': 'Ligue 1',
  '4481': 'Europa League',
  '5071': 'Conference League',
}

function leagueShortName(league: LeagueDef): string {
  return FOOTBALL_LEAGUE_NAMES[league.id] ?? league.sportLabel
}

function FixtureRow({ event, onSelect }: { event: SportEvent; onSelect: (event: SportEvent) => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: () => onSelect(event) })
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
  const { ref, focusKey } = useFocusable({ focusKey: 'competitions-screen', trackChildren: true })
  const [selectedLeague, setSelectedLeague] = useState<LeagueDef>(FOOTBALL_LEAGUES[0])
  // Which round is expanded — defaults to the first (earliest) one returned,
  // i.e. the competition's next unplayed gameweek/stage, every time the
  // fixture list loads for a newly picked league.
  const [expandedRound, setExpandedRound] = useState<string | null>(null)
  const fixturesState = useCompetitionFixtures(selectedLeague)

  useEffect(() => {
    if (fixturesState.status === 'ready' && fixturesState.rounds.length > 0) {
      setExpandedRound(fixturesState.rounds[0].name)
    }
  }, [fixturesState])

  useBackHandler(() => {
    onBack()
    return true
  })

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} className="competitions-screen">
        <div className="competitions-header">
          <h1 className="competitions-title">Competitions</h1>
          <button className="back-link" onClick={onBack}>
            ← Back
          </button>
        </div>

        <div className="league-pills">
          {FOOTBALL_LEAGUES.map((league) => (
            <LeaguePill
              key={league.id}
              league={league}
              active={league.id === selectedLeague.id}
              onSelect={() => setSelectedLeague(league)}
            />
          ))}
        </div>

        {fixturesState.status === 'loading' && <p className="competitions-status">Loading fixtures…</p>}
        {fixturesState.status === 'error' && <p className="competitions-status">{fixturesState.message}</p>}
        {fixturesState.status === 'ready' && fixturesState.rounds.length === 0 && (
          <p className="competitions-status">No fixtures found in the next {LOOKAHEAD_DAYS} days.</p>
        )}

        {fixturesState.status === 'ready' && (
          <div className="rounds-list">
            {fixturesState.rounds.map((round) => {
              const isExpanded = round.name === expandedRound
              return (
                <div key={round.name} className="round-group">
                  <button
                    className={`round-header ${isExpanded ? 'expanded' : ''}`}
                    onClick={() => setExpandedRound(isExpanded ? null : round.name)}
                  >
                    {round.name}
                    <span className="round-count">{round.fixtures.length} matches</span>
                  </button>
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
