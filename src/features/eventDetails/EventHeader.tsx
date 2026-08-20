import { formatEventDayLabel, formatKickoffTime } from './eventTimeFormat'
import type { SportEvent, TeamFormResult } from '../../data/sports/types'

// Small inline SVG rather than an icon font/library dependency (see the
// redesign task's performance constraints — no giant icon dependency).
function VenueIcon() {
  return (
    <svg className="event-header-venue-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2C7.6 2 4 5.6 4 10c0 5.5 7 11.5 7.3 11.7a1 1 0 0 0 1.4 0C13 21.5 20 15.5 20 10c0-4.4-3.6-8-8-8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

// Real live score/clock only when the data genuinely is real (see
// SportEvent.isLiveHeuristic's own doc comment) — a heuristic-live event
// (every non-football sport, plus football fixtures whose live state
// couldn't be confirmed) gets the restrained LIVE badge alone, never a
// fabricated clock or score.
function LiveIndicator({ event }: { event: SportEvent }) {
  return (
    <span className="event-header-live">
      <span className="event-header-live-badge">
        <span className="event-header-live-dot" />
        LIVE
      </span>
      {!event.isLiveHeuristic && event.liveClock && <span className="event-header-live-clock">{event.liveClock}</span>}
    </span>
  )
}

function venueText(event: SportEvent): string | null {
  if (!event.venue) return null
  return event.venueCity ? `${event.venue}, ${event.venueCity}` : event.venue
}

function CompetitionLine({ event }: { event: SportEvent }) {
  if (!event.league) return null
  return (
    <div className="event-header-competition">
      {event.leagueBadge && <img className="event-header-competition-badge" src={event.leagueBadge} alt="" />}
      <span className="event-header-competition-name">{event.league}</span>
      {event.round && <span className="event-header-competition-round"> • {event.round}</span>}
    </div>
  )
}

function TeamBlock({
  name,
  badge,
  score,
  form,
  align,
}: {
  name: string
  badge?: string
  score?: string
  form?: TeamFormResult[]
  align: 'left' | 'right'
}) {
  return (
    <div className={`event-header-team-block event-header-team-block-${align}`}>
      <div className={`event-header-team event-header-team-${align}`}>
        {badge && <img className="event-header-team-badge" src={badge} alt="" />}
        <span className="event-header-team-name">{name}</span>
        {/* Real football live data only (see SportEvent.homeScore/awayScore's
            own doc comment) — undefined for every heuristic-live/upcoming
            event, so nothing renders rather than a fabricated "0". */}
        {score != null && <span className="event-header-team-score">{score}</span>}
      </div>
      <TeamFormStrip form={form} />
    </div>
  )
}

// Secondary decoration (see the redesign task) — server-computed by
// ninety-api from real footballdata.io results (see teamForm.ts), never
// fetched or derived on the TV. Renders nothing at all, preserving layout,
// when ninety-api hasn't computed form for this team yet — never a
// placeholder row of empty pips.
function TeamFormStrip({ form }: { form?: TeamFormResult[] }) {
  if (!form || form.length === 0) return null
  return (
    <div className="event-header-form">
      {form.map((result, index) => (
        <span key={index} className={`event-header-form-pip form-${result.toLowerCase()}`}>
          {result}
        </span>
      ))}
    </div>
  )
}

function CenterFixtureInfo({ event }: { event: SportEvent }) {
  const venue = venueText(event)
  return (
    <div className="event-header-center">
      <span className="event-header-vs">VS</span>
      {event.isLive ? (
        <LiveIndicator event={event} />
      ) : (
        <>
          <span className="event-header-day">{formatEventDayLabel(event.dateTimeUtc)}</span>
          <span className="event-header-time">{formatKickoffTime(event.dateTimeUtc)}</span>
        </>
      )}
      {venue && (
        <span className="event-header-venue">
          <VenueIcon />
          {venue}
        </span>
      )}
    </div>
  )
}

// Team-vs-team fixtures (currently football only — see SportEvent.sportKey).
// Form (W/D/L strips) is server-computed by ninety-api from real
// footballdata.io results (see teamForm.ts) and arrives as part of the
// event data this screen already fetches — never derived or fetched here.
export function FootballEventHeader({ event }: { event: SportEvent }) {
  return (
    <div className="event-header">
      <CompetitionLine event={event} />
      <div className="event-header-matchup">
        <TeamBlock name={event.homeTeam!} badge={event.homeBadge} score={event.homeScore} form={event.homeForm} align="left" />
        <CenterFixtureInfo event={event} />
        <TeamBlock name={event.awayTeam!} badge={event.awayBadge} score={event.awayScore} form={event.awayForm} align="right" />
      </div>
    </div>
  )
}

// Single-entrant events (F1 sessions today; any future non-team sport free
// with the same shape) — no home/away teams to render, so the event's own
// title takes the center spot instead of a "vs" matchup.
export function GenericEventHeader({ event }: { event: SportEvent }) {
  const venue = venueText(event)
  return (
    <div className="event-header event-header-generic">
      <div className="event-header-competition">
        {event.leagueBadge && <img className="event-header-competition-badge" src={event.leagueBadge} alt="" />}
        <span className="event-header-competition-name">{event.league || event.sportLabel}</span>
      </div>
      <h1 className="event-header-generic-title">{event.title}</h1>
      <div className="event-header-center">
        {event.isLive ? (
          <LiveIndicator event={event} />
        ) : (
          <>
            <span className="event-header-day">{formatEventDayLabel(event.dateTimeUtc)}</span>
            <span className="event-header-time">{formatKickoffTime(event.dateTimeUtc)}</span>
          </>
        )}
        {venue && (
          <span className="event-header-venue">
            <VenueIcon />
            {venue}
          </span>
        )}
      </div>
    </div>
  )
}
