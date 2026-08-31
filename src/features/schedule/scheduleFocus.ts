// Schedule's focus keys, and the two decisions the screen makes about focus
// that are worth testing without a layout engine: which fixture a fresh
// entry lands on, and whether it is still allowed to claim focus by the time
// the day's data actually arrives.
//
// Split out of ScheduleScreen.tsx because that file exports only its
// component (Fast Refresh) and because the interesting part here is pure:
// jsdom can tell us which key was targeted, never whether the row was
// visible, so the test is written against the key.
import type { ScheduleGroup } from '../../data/sports/scheduleRanking'

export const SCHEDULE_SCREEN_FOCUS_KEY = 'schedule-screen'
export const SCHEDULE_PREV_DAY_FOCUS_KEY = 'schedule-day-prev'
export const SCHEDULE_NEXT_DAY_FOCUS_KEY = 'schedule-day-next'

// Focus keys carry the day they belong to, and the whole content region is
// React-keyed on the same day (see .schedule-content). That pairing is
// deliberate: norigin registers a focusable under the key it had AT MOUNT
// (its addFocusable effect has an empty dep array), so a key that changes on
// an already-mounted component silently keeps the old registration. Keying
// the region forces a real remount, so day-scoped keys are always the ones
// actually registered — and a stale key from the previous day can never be
// a live focus target.
export function scheduleFixtureFocusKey(dayOffset: number, eventId: string): string {
  return `schedule-d${dayOffset}-fx-${eventId}`
}

// THE FIRST FIXTURE IN RENDERED ORDER, which is what "open Schedule and the
// first game is focused" has to mean.
//
// It is groups[0].fixtures[0] and not "the earliest kickoff": the page is
// ordered by buildScheduleGroups (competitions ranked, fixtures within each),
// and focus has to land on the row the viewer's eye lands on. Undefined for
// a day that is still loading, failed, or genuinely has no football on it —
// there is no fixture to name, and the caller must not invent a key.
//
// Deliberately NOT any of the page's chrome: the date arrows, the day label
// and (historically) the league filter are things you go to when the answer
// on screen is not the one you wanted. Landing on one of them makes the
// viewer's first press a correction rather than a step.
export function firstFixtureFocusKey(groups: readonly ScheduleGroup[], dayOffset: number): string | undefined {
  const first = groups[0]?.fixtures[0]
  return first ? scheduleFixtureFocusKey(dayOffset, first.id) : undefined
}

// MAY THE PAGE-ENTRY FOCUS STILL CLAIM THE HIGHLIGHT?
//
// A day's fixtures arrive asynchronously, so "focus the first game" can only
// run once they exist — by which time the viewer may already have moved. The
// three keys this says yes to are the three that mean "nobody has chosen to
// be here":
//
//   null                  nothing focused yet at all
//   the screen container  focus resolved to the root and no further
//   the NEXT-day arrow    the container's own mount-time fallback (see
//                         ScheduleScreen's preferredChildFocusKey) — where
//                         focus is PUT while a day loads, never somewhere a
//                         viewer navigated to
//
// The previous-day arrow is pointedly absent: reaching it takes a deliberate
// press, so focus sitting there is a choice and must be left alone. Fixture
// rows likewise. This is only half the guard — the screen also stops
// claiming focus outright once the viewer changes day (see ScheduleScreen) —
// but it is the half that answers "did an async load steal my highlight".
export function canClaimScheduleEntryFocus(currentFocusKey: string | null | undefined): boolean {
  return (
    currentFocusKey == null ||
    currentFocusKey === SCHEDULE_SCREEN_FOCUS_KEY ||
    currentFocusKey === SCHEDULE_NEXT_DAY_FOCUS_KEY
  )
}
