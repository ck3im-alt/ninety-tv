import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FocusContext, getCurrentFocusKey, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler, useFocusScrollIntoView } from '../../core/platform'
import { flagSrc } from '../../data/countryCodes'
import { loadPreferences } from '../../data/preferences'
import { canGoToPreviousScheduleDay, useScheduleDay } from '../../data/sports/useScheduleDay'
import { buildScheduleGroups } from '../../data/sports/scheduleRanking'
import type { ScheduleGroup } from '../../data/sports/scheduleRanking'
import { formatKickoffTime } from '../eventDetails/eventTimeFormat'
import { describeScheduleDay } from './scheduleDayLabel'
import {
  SCHEDULE_NEXT_DAY_FOCUS_KEY as NEXT_DAY_FOCUS_KEY,
  SCHEDULE_PREV_DAY_FOCUS_KEY as PREV_DAY_FOCUS_KEY,
  SCHEDULE_SCREEN_FOCUS_KEY as SCREEN_FOCUS_KEY,
  canClaimScheduleEntryFocus,
  firstFixtureFocusKey,
  scheduleFixtureFocusKey as fixtureFocusKey,
} from './scheduleFocus'
import type { SportEvent } from '../../data/sports/types'
import './ScheduleScreen.css'

// Schedule — Ninety's football fixture guide, one local calendar day at a
// time. It replaced the old Competitions browser (pick a competition -> load
// it -> expand a round -> see fixtures); the app's internal screen id is
// still 'competitions' (see core/appScreens.ts) because renaming a persisted
// navigation identifier buys nothing and risks a stale value.
//
// THE FOCUS GRAPH IS FLAT, and that is the point of the screen:
//
//   date navigator
//     |
//   fixture -> fixture -> fixture -> ...      (every fixture of the day)
//
// Competitions are cards with an informational header, NOT a level of
// navigation. The header is plain DOM — no focusable, no collapse, no
// chevron — so a competition boundary costs the viewer exactly zero key
// presses: Down from the last fixture of one competition lands on the first
// fixture of the next. On a 60-fixture Saturday that difference is the
// difference between browsing and grinding.
// Focus keys, the first-fixture target and the page-entry claim rule all
// live in scheduleFocus.ts — pure, and therefore testable without mounting a
// focus tree.

function DayArrow({
  direction,
  focusKey,
  enabled,
  onActivate,
  onArrowLeft,
  onArrowRight,
  onArrowDown,
  onFocused,
}: {
  direction: 'prev' | 'next'
  focusKey: string
  enabled: boolean
  onActivate: () => void
  onArrowLeft?: () => void
  onArrowRight?: () => void
  onArrowDown?: () => void
  onFocused: () => void
}) {
  // `focusable: enabled` rather than unmounting: the panel's shape must not
  // change when the backwards boundary is reached, and a control that
  // vanishes from under the highlight is the exact failure this screen is
  // written to avoid. Per the focus-state contract (tokens.css) a disabled
  // control is still out of the spatial-nav tree — the library also
  // suppresses onEnterPress for a non-focusable component, so the boundary
  // holds even if focus is somehow still sitting on it.
  const { ref, focused } = useFocusable({
    focusKey,
    focusable: enabled,
    onEnterPress: onActivate,
    onFocus: onFocused,
    onArrowPress: (arrow) => {
      // Every direction out of the date bar is stated, never inferred. The
      // arrows are two ~52px circles at opposite ends of a 1728px panel, and
      // norigin's geometric search only treats siblings as adjacent when
      // they overlap by >=20% of the REFERENCE's width — from a full-width
      // fixture row that is 345px, which two small circles never satisfy.
      if (arrow === 'left' && onArrowLeft) {
        onArrowLeft()
        return false
      }
      if (arrow === 'right' && onArrowRight) {
        onArrowRight()
        return false
      }
      if (arrow === 'down' && onArrowDown) {
        onArrowDown()
        return false
      }
      // Down with no onArrowDown is a day with nothing on it (loading,
      // empty, error): consumed rather than defaulted, because there is no
      // content focus key to target and the library's geometric search
      // would only find the other arrow.
      // Nothing above the date bar inside this screen — Up falls through to
      // the library, which finds TopNav.
      return arrow === 'up'
    },
  })
  useFocusScrollIntoView(ref, focused)
  return (
    <button
      ref={ref}
      type="button"
      className={`schedule-day-arrow ${focused ? 'focused' : ''} ${enabled ? '' : 'disabled'}`}
      aria-label={direction === 'prev' ? 'Previous day' : 'Next day'}
      onClick={enabled ? onActivate : undefined}
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d={direction === 'prev' ? 'M10 2.5 4.5 8l5.5 5.5' : 'M6 2.5 11.5 8 6 13.5'}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

// The one control at the top of the screen: which day is being shown, and
// the two ways to change it. Stays mounted through every load — moving
// between days must never blank the thing you are moving with. Kept to a
// compact toolbar height (see the CSS): every pixel it does not spend is a
// pixel of fixtures visible without scrolling.
function DateNavigator({
  dayOffset,
  title,
  canGoBack,
  onChangeDay,
  onEnterContent,
  onDateControlFocused,
}: {
  dayOffset: number
  title: string
  canGoBack: boolean
  onChangeDay: (next: number) => void
  onEnterContent?: () => void
  onDateControlFocused: (focusKey: string) => void
}) {
  return (
    <div className="schedule-datebar">
      <DayArrow
        direction="prev"
        focusKey={PREV_DAY_FOCUS_KEY}
        enabled={canGoBack}
        onActivate={() => onChangeDay(dayOffset - 1)}
        onArrowRight={() => void setFocus(NEXT_DAY_FOCUS_KEY)}
        onArrowLeft={() => {}}
        onArrowDown={onEnterContent}
        onFocused={() => onDateControlFocused(PREV_DAY_FOCUS_KEY)}
      />
      <div className="schedule-day-label">
        <span className="schedule-day-title">{title}</span>
      </div>
      <DayArrow
        direction="next"
        focusKey={NEXT_DAY_FOCUS_KEY}
        enabled
        onActivate={() => onChangeDay(dayOffset + 1)}
        onArrowLeft={() => {
          // Consumed either way: at the backwards boundary the previous
          // arrow is out of the tree, and Left must not wander off into the
          // fixtures below instead.
          if (canGoBack) void setFocus(PREV_DAY_FOCUS_KEY)
        }}
        onArrowRight={() => {}}
        onArrowDown={onEnterContent}
        onFocused={() => onDateControlFocused(NEXT_DAY_FOCUS_KEY)}
      />
    </div>
  )
}

// One fixture. A fixed three-column grid — [home][center][away] — with equal
// 1fr team halves, a fixed-width centre and symmetric edge padding, so the
// time/score axis lands on the same vertical line in every row of every
// competition on the page. That single alignment is what makes a 60-fixture
// day scannable from a sofa.
//
// Crests sit INSIDE the names, against the centre — deliberately the mirror
// image of the Match View header, which puts the crest outermost (see
// EventHeader.tsx). On a single wide header, crest-outermost frames the
// matchup; down a list of 60 rows it is the opposite that works, because the
// crests then form two tight vertical columns flanking the time axis and the
// eye can find a club without reading a word.
//
// NOTHING HERE SAYS WHETHER THE FIXTURE IS ON TELEVISION. Schedule answers a
// sporting question — what football is on today — and the broadcast data is
// still on SportEvent for Event Details to rank streams out of. It simply
// isn't a column: an untelevised fixture is not a lesser row, and a mark
// that appears on some rows and not others reads as one.
//
// No match minute is shown either. footballdata.io has no clock field at all
// (see SportEvent.liveClock), so anything beyond LIVE would be invented —
// and a heuristically-live fixture (see isLiveHeuristic) never shows a
// score, because there isn't one, only a start-time guess.
function FixtureRow({
  event,
  focusKey,
  onSelect,
  onArrowUp,
  onArrowDown,
}: {
  event: SportEvent
  focusKey: string
  onSelect: (event: SportEvent) => void
  // Stated ONLY where a competition boundary is being crossed (see
  // CompetitionSection) — inside a competition the rows are full-width and
  // stacked in one column, which norigin resolves geometrically without
  // help.
  onArrowUp?: () => void
  onArrowDown?: () => void
}) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: () => onSelect(event),
    onArrowPress: (direction) => {
      if (direction === 'up' && onArrowUp) {
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
  // The screen owns vertical scrolling (see .schedule-screen's overflow-y)
  // — a full Saturday is several screens tall.
  useFocusScrollIntoView(ref, focused)

  const hasRealScore = event.homeScore != null && event.awayScore != null && !event.isLiveHeuristic
  const isTeamFixture = Boolean(event.homeTeam && event.awayTeam)
  const score = `${event.homeScore} – ${event.awayScore}`

  return (
    <div ref={ref} className={`fixture-row ${focused ? 'focused' : ''}`} onClick={() => onSelect(event)}>
      {isTeamFixture ? (
        <>
          <span className="fixture-team fixture-team-home">
            <span className="fixture-team-name">{event.homeTeam}</span>
            {event.homeBadge && <img className="fixture-crest" src={event.homeBadge} alt="" />}
          </span>
          <span className="fixture-center">
            {event.isLive ? (
              <>
                <span className={`fixture-center-value ${hasRealScore ? 'score' : 'live'}`}>{hasRealScore ? score : 'LIVE'}</span>
                {hasRealScore && (
                  <span className="fixture-center-status live">
                    <span className="fixture-live-dot" />
                    LIVE
                  </span>
                )}
              </>
            ) : event.status === 'complete' ? (
              // A real backend-confirmed final result — the same signal
              // Event Details renders as FINISHED, not a guess about a
              // match whose kickoff time has merely passed.
              <>
                <span className={`fixture-center-value ${hasRealScore ? 'score' : ''}`}>{hasRealScore ? score : 'FT'}</span>
                {hasRealScore && <span className="fixture-center-status">FT</span>}
              </>
            ) : (
              <span className="fixture-center-value">{formatKickoffTime(event.dateTimeUtc)}</span>
            )}
          </span>
          <span className="fixture-team fixture-team-away">
            {event.awayBadge && <img className="fixture-crest" src={event.awayBadge} alt="" />}
            <span className="fixture-team-name">{event.awayTeam}</span>
          </span>
        </>
      ) : (
        // No two named sides (a competition-level entry with no teams
        // resolved yet). The event's own title takes the home half rather
        // than an empty matchup being rendered; the centre axis is left
        // holding the kickoff time, exactly as on every other row.
        <>
          <span className="fixture-team fixture-team-home">
            <span className="fixture-team-name">{event.title}</span>
          </span>
          <span className="fixture-center">
            <span className="fixture-center-value">{formatKickoffTime(event.dateTimeUtc)}</span>
          </span>
          <span className="fixture-team fixture-team-away" />
        </>
      )}
    </div>
  )
}

// "England – Premier League" with the country's flag, or the competition's
// own badge for a supranational one.
//
// The country comes from ninety-api's canonical competition registry
// (LeagueDef.region/countryCode, carried alongside the fixtures by
// useScheduleDay) — never parsed out of a competition name. A supranational
// competition has countryCode null by definition (see
// competitionGrouping.ts), so it keeps its registry region ('Europe',
// 'International', 'South America') as its label and its badge as its mark:
// no national flag is invented for it.
function CompetitionMark({ group }: { group: ScheduleGroup }) {
  const flag = group.countryCode ? flagSrc(group.countryCode) : null
  if (flag) return <img className="schedule-competition-flag" src={flag} alt="" />
  if (group.competitionBadge) return <img className="schedule-competition-badge" src={group.competitionBadge} alt="" />
  return <span className="schedule-competition-mark-empty" />
}

function competitionHeading(group: ScheduleGroup): string {
  return group.region ? `${group.region} – ${group.competitionName}` : group.competitionName
}

// One competition card: an informational header band, then every fixture.
// The header is a plain <div> ON PURPOSE — it registers no focusable, takes
// no Enter and has no expanded/collapsed state, so the D-pad walks straight
// past it. Everything a viewer can land on inside this card is a fixture.
//
// The two boundary handlers are the whole of this screen's explicit
// navigation: Up from the FIRST fixture and Down from the LAST fixture are
// the only moves that leave the card, and stating them is what guarantees
// the flat chain rather than trusting geometry to step over a header band
// and a 24px gap.
function CompetitionSection({
  group,
  dayOffset,
  onSelectEvent,
  onFirstFixtureUp,
  onLastFixtureDown,
}: {
  group: ScheduleGroup
  dayOffset: number
  onSelectEvent: (event: SportEvent) => void
  onFirstFixtureUp?: () => void
  onLastFixtureDown?: () => void
}) {
  const lastIndex = group.fixtures.length - 1
  return (
    <section className="schedule-competition">
      <div className="schedule-competition-header">
        <CompetitionMark group={group} />
        <span className="schedule-competition-title">{competitionHeading(group)}</span>
      </div>
      <div className="schedule-fixtures">
        {group.fixtures.map((event, index) => (
          <FixtureRow
            key={event.id}
            event={event}
            focusKey={fixtureFocusKey(dayOffset, event.id)}
            onSelect={onSelectEvent}
            onArrowUp={index === 0 ? onFirstFixtureUp : undefined}
            onArrowDown={index === lastIndex ? onLastFixtureDown : undefined}
          />
        ))}
      </div>
    </section>
  )
}

// Two ghost cards while an unvisited day is fetched. Deliberately not a
// spinner and deliberately not a blanked page: the date navigator stays put,
// the page keeps its shape, and nothing jumps when the real fixtures land.
function ScheduleSkeleton() {
  return (
    <div className="schedule-skeleton" aria-hidden="true">
      {[0, 1].map((card) => (
        <div key={card} className="schedule-skeleton-card">
          <div className="schedule-skeleton-header" />
          <div className="schedule-skeleton-row" />
          <div className="schedule-skeleton-row" />
        </div>
      ))}
    </div>
  )
}

export function ScheduleScreen({ onSelectEvent, onBack }: { onSelectEvent: (event: SportEvent) => void; onBack: () => void }) {
  // 0 = the viewer's local today, -1 yesterday, +1 tomorrow, and forward
  // without a ceiling. The backwards boundary is the hook's (see
  // MIN_SCHEDULE_DAY_OFFSET) — the product's, not this component's.
  const [dayOffset, setDayOffset] = useState(0)
  const scheduleState = useScheduleDay(dayOffset)
  // Which of the two date controls the viewer last used, so coming back Up
  // out of the fixtures returns to the one they left rather than always the
  // same one.
  const lastDateControlRef = useRef(NEXT_DAY_FOCUS_KEY)

  // Read once per mount, not per render: this screen is lazy-mounted fresh
  // on every navigation to it, so a preference changed in Settings is picked
  // up the next time Schedule is opened, without this re-reading
  // localStorage on every render or re-grouping fixtures because the array
  // identity changed.
  const favoriteLeagueIds = useMemo(() => loadPreferences().footballLeagueIds, [])

  const day = useMemo(() => describeScheduleDay(dayOffset), [dayOffset])
  const canGoBack = canGoToPreviousScheduleDay(dayOffset)

  const fixtures = scheduleState.status === 'ready' ? scheduleState.fixtures : null
  const competitions = scheduleState.status === 'ready' ? scheduleState.competitions : undefined
  const groups = useMemo(
    () => (fixtures ? buildScheduleGroups(fixtures, favoriteLeagueIds, competitions) : []),
    [fixtures, favoriteLeagueIds, competitions],
  )

  useBackHandler(() => {
    // The date navigator's left arrow is NOT Back — it is one day earlier.
    // Back leaves the screen, exactly as it always did.
    onBack()
    return true
  })

  // The day's first fixture, and the key that focuses it — the target a
  // fresh entry into Schedule is supposed to land on. Undefined while the
  // day is loading, failed, or genuinely has no football on it.
  const entryFixtureFocusKey = firstFixtureFocusKey(groups, dayOffset)

  // `ref` is the <main> element, which is BOTH this screen's focus container
  // and its one scroll owner — the scroll-reset effect below writes through
  // the same ref rather than a second one racing it onto the same node.
  const { ref, focusKey } = useFocusable<unknown, HTMLElement>({
    focusKey: SCREEN_FOCUS_KEY,
    trackChildren: true,
    // THE FIRST GAME OF THE DAY, falling back to the next-day arrow.
    //
    // The arrow alone used to be this value, for a real reason: it is the
    // one target that exists in EVERY state of the screen — loading, error,
    // empty and ready — which is the "always resolvable at mount" contract
    // App.tsx's SCREEN_FOCUS_KEYS relies on for a lazy screen. It stays the
    // fallback for exactly that reason. But it is the wrong LANDING: opening
    // Schedule to browse today's football and finding the highlight on a
    // date arrow makes the viewer's first press a correction.
    //
    // Both halves are needed and neither is redundant. This one covers the
    // case where the fixtures are already in hand when App focuses the
    // screen (a cached day — see useScheduleDay — reads ready on its first
    // render); the effect below covers the case where they arrive later,
    // which preferredChildFocusKey cannot, since changing it only affects
    // FUTURE focus resolutions and never moves focus that has already
    // settled on the arrow.
    preferredChildFocusKey: entryFixtureFocusKey ?? NEXT_DAY_FOCUS_KEY,
  })

  // Whether the page-entry landing has had its one chance. Set when it fires,
  // and set when the viewer takes over — see changeDay below.
  const entryFocusSettledRef = useRef(false)

  const changeDay = useCallback((next: number) => {
    // CHANGING DAY ENDS THE PAGE-ENTRY WINDOW, permanently. Someone pressing
    // a date arrow while the current day is still loading must keep the
    // highlight on that arrow when the fixtures land — otherwise the arrows
    // become unusable exactly when they are being used, since every press
    // would throw focus into the list. Recorded here, at the deliberate
    // action, rather than inferred afterwards from where focus happens to be.
    entryFocusSettledRef.current = true
    setDayOffset(next)
  }, [])

  // FRESH ENTRY LANDS ON THE FIRST GAME. Fires once, on the transition from
  // "no fixtures yet" to "fixtures", and only while nobody has chosen to be
  // anywhere else (canClaimScheduleEntryFocus — the next-day arrow counts as
  // nobody, because that is where the container's own fallback PUT focus
  // rather than anywhere a viewer navigated to).
  //
  // Both guards are load-bearing and cover different things: the ref stops
  // this from ever running twice (a later day's fixtures arriving is not a
  // fresh entry), and the focus-key check stops the very first run from
  // stealing a highlight the viewer moved during the load.
  useEffect(() => {
    if (entryFocusSettledRef.current) return
    if (!entryFixtureFocusKey) return
    entryFocusSettledRef.current = true
    if (!canClaimScheduleEntryFocus(getCurrentFocusKey())) return
    void setFocus(entryFixtureFocusKey)
  }, [entryFixtureFocusKey])

  // Back to the top of the new day's fixtures. Runs after the DOM for the
  // new day exists (skeleton or content), so nothing can scroll it again.
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0
    // `ref` is stable for the life of the component; the day is the only
    // real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayOffset])

  // THE ONE FOCUS RECOVERY THIS SCREEN NEEDS. Pressing Enter on the previous
  // arrow at today lands on yesterday, where that same arrow leaves the
  // spatial-nav tree under the highlight. Handled from an effect, not the
  // handler: by the time effects run the arrow's `focusable: false` update
  // has been applied, and setFocus cancels norigin's own debounced
  // restore-to-parent (which would resolve through the screen root and land
  // somewhere unrelated — the Settings bug pattern, see useFocusRecovery).
  useEffect(() => {
    if (!canGoBack && getCurrentFocusKey() === PREV_DAY_FOCUS_KEY) void setFocus(NEXT_DAY_FOCUS_KEY)
  }, [canGoBack])

  // Down out of the date bar goes to the day's very first FIXTURE — never to
  // a competition, because a competition is not something you can focus. The
  // same target a fresh entry lands on, deliberately: one answer to "where
  // does the content start", used by both. Undefined when the day has
  // nothing on it, so no stale key is targeted in the loading/empty/error
  // states.
  const enterContent = entryFixtureFocusKey ? () => void setFocus(entryFixtureFocusKey) : undefined
  const backToDateBar = () => void setFocus(lastDateControlRef.current)

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} className="schedule-screen">
        <DateNavigator
          dayOffset={dayOffset}
          title={day.title}
          canGoBack={canGoBack}
          onChangeDay={changeDay}
          onEnterContent={enterContent}
          onDateControlFocused={(key) => {
            lastDateControlRef.current = key
          }}
        />

        {/* Keyed on the day so the whole fixture region remounts when the
            date changes — see the focus-key note at the top of this file. */}
        <div className="schedule-content" key={dayOffset}>
          {scheduleState.status === 'loading' && <ScheduleSkeleton />}
          {scheduleState.status === 'error' && <p className="schedule-status">{day.errorMessage}</p>}
          {scheduleState.status === 'ready' && groups.length === 0 && <p className="schedule-status">{day.emptyMessage}</p>}
          {groups.map((group, index) => {
            // The fixture immediately above this card's first row, and the
            // one immediately below its last — i.e. the neighbouring
            // competitions' edge fixtures. This is where the flat chain is
            // sewn together; the very first fixture on the page reaches the
            // date bar instead, and the very last has nothing below it.
            const previous = groups[index - 1]
            const next = groups[index + 1]
            const above = previous?.fixtures[previous.fixtures.length - 1]
            const below = next?.fixtures[0]
            return (
              <CompetitionSection
                key={group.competitionId}
                group={group}
                dayOffset={dayOffset}
                onSelectEvent={onSelectEvent}
                onFirstFixtureUp={
                  above ? () => void setFocus(fixtureFocusKey(dayOffset, above.id)) : index === 0 ? backToDateBar : undefined
                }
                onLastFixtureDown={below ? () => void setFocus(fixtureFocusKey(dayOffset, below.id)) : undefined}
              />
            )
          })}
        </div>
      </main>
    </FocusContext.Provider>
  )
}
