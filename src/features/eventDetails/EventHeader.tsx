import { formatKickoffTime } from './eventTimeFormat'
import { StadiumIcon } from '../onboarding/sportIcons'
import { competitionMatchHero } from '../../data/sports/competitionArtwork'
import type { SportEvent } from '../../data/sports/types'

// Venue is a STADIUM name, so it gets a stadium mark rather than the
// map-pin this used to draw — shared with Home's own venue line (see
// StadiumIcon in sportIcons.tsx) so the two screens speak the same visual
// language instead of each inventing a venue glyph. Sized/coloured by
// .event-header-meta-icon, same as ClockIcon below.
function VenueIcon() {
  return <StadiumIcon className="event-header-meta-icon" />
}

// Small inline SVG rather than an icon font/library dependency.
function ClockIcon() {
  return (
    <svg className="event-header-meta-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Extremely subtle, purely decorative — thin arcs + a faint top vignette
// behind the header, built entirely from Ninety's own existing dark/navy
// tokens. Deliberately kept close to invisible (5-10% visual intensity,
// not a visible illustration). Absolutely positioned behind the header
// content, spans the full fixed 1920px canvas via plain pixel offsets (see
// the CSS rule's own comment).
//
// Competitions with curated artwork get a real photo instead (see
// data/sports/competitionArtwork.ts, which owns both WHICH competitions
// have one and how each is framed) — same idea as leagues.ts's existing
// staticBackground override for F1's Home hero, just scoped to this screen,
// since football competitions have no such field on their LeagueDef (they
// come from ninety-api's registry, not STATIC_LEAGUES). The arcs are
// skipped in that case — the photo already carries its own visual richness,
// and layering line-art on top of it would look cluttered.
//
// The gradient wash and the arc strokes are deliberately TWO separate
// elements (a plain div for the CSS background, an inner SVG for just the
// paths) rather than one SVG carrying both — applying a CSS `background`
// directly to an absolutely-positioned, 100vw-wide SVG root with
// preserveAspectRatio="none" non-uniform scaling triggered a real Chromium
// paint/compositing bug here: the SVG's raster layer bled downward and
// visually painted over the first stream row's content (near-solid dark
// block, text/logo hidden) even though hit-testing/elementFromPoint still
// correctly reported the row underneath — a pure raster glitch, not a
// stacking/z-index issue. Confirmed by isolating it: hiding just the SVG
// fixed the row instantly. Splitting the gradient onto a plain div (a much
// more boring, well-tested code path) avoids it entirely.
function HeaderBackdrop({ event }: { event: SportEvent }) {
  const hero = competitionMatchHero(event.leagueId)
  return (
    <div
      className={`event-header-backdrop ${hero ? 'event-header-backdrop-photo' : ''}`}
      style={
        hero
          ? {
              // Two layers: a fade that dissolves the photo's bottom into
              // the page, then the photo itself. Only the URL is set here
              // (it needs import.meta.env.BASE_URL); sizing and framing are
              // shared by every banner and live in the CSS rule.
              //
              // These stops are tuned against the box --header-bleed
              // produces, and the thing they are tuned FOR is the first
              // country header in the stream list below: it is small muted
              // uppercase text, and it lands on the outer left edge, which
              // is exactly where these banners put their brightest content.
              // The artwork has to be essentially gone by then or that label
              // washes out.
              //
              // That row sits ~51% down the box on a fixture with no
              // status line, and ~65% down on one that has a LIVE/FINISHED
              // line. The stops target the EARLIER (tighter) case, so both
              // are covered: the dissolve runs 18% -> 54%, leaving the
              // artwork at roughly 9% where the label starts. Above it the
              // ramp is ~160px long, so the matchup still sits on strong
              // artwork and the venue/kickoff line on a soft remnant.
              //
              // Reaching the background colour BEFORE the box edge rather
              // than at it is also what removes the hard horizontal border
              // this used to draw above the stream list — interpolating
              // right up to the edge left the image faintly visible on the
              // last few pixels and then cut.
              backgroundImage: `linear-gradient(180deg, transparent 0%, transparent 18%, var(--bg-primary) 54%, var(--bg-primary) 100%), url(${hero})`,
            }
          : undefined
      }
    >
      {!hero && (
        <svg className="event-header-backdrop-arcs" viewBox="0 0 1920 420" preserveAspectRatio="none" aria-hidden="true">
          <path className="event-header-backdrop-arc event-header-backdrop-arc-1" d="M -80 320 Q 960 60 2000 320" />
          <path className="event-header-backdrop-arc event-header-backdrop-arc-2" d="M -80 380 Q 960 160 2000 380" />
        </svg>
      )}
    </div>
  )
}

// Real football lifecycle data only (see SportEvent.status's own doc
// comment) — a heuristic-live event never gets a fabricated clock, only
// the restrained LIVE line alone. Reuses Home screen's own established
// LIVE treatment (live-red dot + text, " · clock") rather than inventing a
// new look for this screen alone.
function LiveStatusLine({ event }: { event: SportEvent }) {
  return (
    <span className="event-header-status-line event-header-status-live">
      <span className="event-header-live-dot" />
      LIVE
      {!event.isLiveHeuristic && event.liveClock && <> · {event.liveClock}</>}
    </span>
  )
}

// Only shown for a real backend-confirmed final result (status ===
// 'complete'), never for a heuristic-live sport, which has no completion
// signal at all.
function FinishedStatusLine() {
  return <span className="event-header-status-line event-header-status-finished">FINISHED</span>
}

// The one line beneath the matchup that carries LIVE/FINISHED status. This
// is the ONLY place any of that text may appear; it must never be
// concatenated into the team-matchup row itself. Scheduled/upcoming
// fixtures get no status line at all here — the matchup row's own "VS"
// already reads correctly on its own ("Team VS Team"), and the kickoff time
// is already shown in the stadium/kickoff row below, so a "Today"/
// "Tomorrow" line here would be redundant. Returns its own full-span row
// wrapper (or null for a scheduled fixture), so callers never render an
// empty row that would still eat a row-gap.
function MatchStatusLine({ event }: { event: SportEvent }) {
  if (event.isLive) {
    return (
      <div className="event-header-row-full">
        <LiveStatusLine event={event} />
      </div>
    )
  }
  if (event.status === 'complete') {
    return (
      <div className="event-header-row-full">
        <FinishedStatusLine />
      </div>
    )
  }
  return null
}

function venueText(event: SportEvent): string | null {
  if (!event.venue) return null
  return event.venueCity ? `${event.venue}, ${event.venueCity}` : event.venue
}

function CompetitionBadgeAndName({ event }: { event: SportEvent }) {
  return (
    <span className="event-header-competition">
      {event.leagueBadge && <img className="event-header-competition-badge" src={event.leagueBadge} alt="" />}
      <span className="event-header-competition-name">{event.league}</span>
    </span>
  )
}

// One row of the shared alignment grid (see .event-header-grid in
// EventDetailsScreen.css): left content, a centered axis glyph, right
// content — OR, when there's nothing to put on one side, a single
// full-span row instead so nothing reads as a dangling separator. Grid
// auto-placement fills exactly 3 cells or exactly 1 full-span cell per
// call, so successive rows never leave a stray empty cell.
function AxisRow({ left, axis, right }: { left: React.ReactNode; axis: React.ReactNode; right: React.ReactNode }) {
  if (left && right) {
    return (
      <>
        <div className="event-header-cell event-header-cell-left">{left}</div>
        <div className="event-header-cell event-header-cell-center">{axis}</div>
        <div className="event-header-cell event-header-cell-right">{right}</div>
      </>
    )
  }
  if (!left && !right) return null
  return <div className="event-header-row-full">{left || right}</div>
}

// Team-vs-team fixtures (currently football only — see SportEvent.sportKey).
// The matchup row reads strictly left to right as a real fixture would be
// written — home crest, home team, home score, [VS], away score, away team,
// away crest — laid out as two plain flex groups (one per side, each pushed
// toward the shared center grid column) rather than one flat row of
// concatenated text nodes, so each side grows OUTWARD from the fixed center
// and a long team name can never shift the center point.
//
// Neither side is flex-reversed. The away group's DOM order (score, name,
// crest) IS its visual order: crest outside the name, score innermost
// against VS, mirroring the home side. It previously carried a
// `row-reverse` class, which flipped exactly those three elements and made
// the whole row read "[home crest] Home — [away crest] Away" — crests both
// on the same side of their names, scores on the outside. Only the score's
// margin still needs a side-aware rule (see .event-header-team-away in
// EventDetailsScreen.css), since it sits after the name on one side and
// before it on the other.
//
// The center column always shows "VS", regardless of whether a score exists
// yet — an upcoming fixture reads "Team VS Team", never a fabricated score
// and never any status/day text inside this row. All status/day information
// lives in ONE separate line below the matchup (see MatchStatusLine) —
// never here.
export function FootballEventHeader({ event }: { event: SportEvent }) {
  const venue = venueText(event)
  const kickoff = formatKickoffTime(event.dateTimeUtc) || null

  return (
    <div className="event-header">
      <HeaderBackdrop event={event} />
      <div className="event-header-grid">
        {event.league && (
          <div className="event-header-row-full">
            <CompetitionBadgeAndName event={event} />
          </div>
        )}

        <div className="event-header-cell event-header-cell-left">
          <div className="event-header-team event-header-team-home">
            {event.homeBadge && <img className="event-header-team-badge" src={event.homeBadge} alt="" />}
            <span className="event-header-team-name">{event.homeTeam}</span>
            {event.homeScore != null && <span className="event-header-score">{event.homeScore}</span>}
          </div>
        </div>
        <div className="event-header-cell event-header-cell-center">
          <span className="event-header-vs">VS</span>
        </div>
        <div className="event-header-cell event-header-cell-right">
          <div className="event-header-team event-header-team-away">
            {event.awayScore != null && <span className="event-header-score">{event.awayScore}</span>}
            <span className="event-header-team-name">{event.awayTeam}</span>
            {event.awayBadge && <img className="event-header-team-badge" src={event.awayBadge} alt="" />}
          </div>
        </div>

        <MatchStatusLine event={event} />

        <AxisRow
          left={
            venue && (
              <span className="event-header-meta">
                <VenueIcon />
                {venue}
              </span>
            )
          }
          axis={<span className="event-header-axis-glyph">|</span>}
          right={
            kickoff && (
              <span className="event-header-meta">
                <ClockIcon />
                Kick-off {kickoff}
              </span>
            )
          }
        />
      </div>
    </div>
  )
}

// Single-entrant events (F1 sessions today; any future non-team sport
// shares the same shape) — no home/away teams to render, so the event's own
// title takes the center spot instead of a "vs" matchup. No strict
// left/center/right axis to hold (there's no team on either side of
// anything), so this stays a simple centered column; venue/kickoff still
// share one row when both are known, same graceful single/omitted fallback
// as the football header.
export function GenericEventHeader({ event }: { event: SportEvent }) {
  const venue = venueText(event)
  const kickoff = formatKickoffTime(event.dateTimeUtc) || null

  return (
    <div className="event-header event-header-generic">
      <HeaderBackdrop event={event} />
      {event.league || event.sportLabel ? (
        <span className="event-header-competition">
          {event.leagueBadge && <img className="event-header-competition-badge" src={event.leagueBadge} alt="" />}
          <span className="event-header-competition-name">{event.league || event.sportLabel}</span>
        </span>
      ) : null}
      <h1 className="event-header-generic-title">{event.title}</h1>
      <MatchStatusLine event={event} />
      {venue && kickoff ? (
        <span className="event-header-meta">
          <VenueIcon />
          {venue}
          <span className="event-header-axis-glyph">|</span>
          <ClockIcon />
          Kick-off {kickoff}
        </span>
      ) : venue ? (
        <span className="event-header-meta">
          <VenueIcon />
          {venue}
        </span>
      ) : (
        kickoff && (
          <span className="event-header-meta">
            <ClockIcon />
            Kick-off {kickoff}
          </span>
        )
      )}
    </div>
  )
}
