import { localDayRangeOffset } from '../../data/sports/localDay'

// How Schedule names the day it is showing — the one line in the date
// navigator, and the product copy for the empty/error states beneath it.
//
// EVERYTHING IS DERIVED FROM localDayRangeOffset, never from a second piece
// of date arithmetic: the label and the API window must agree about which
// calendar day is on screen, in every timezone and across every DST
// transition. Pass the same offset to both and they cannot drift.
//
// NAMES ARE HARDCODED ENGLISH rather than asked of Intl. Two reasons, and
// the app already works this way (see mapEvent.ts's WEEKDAYS and
// core/time/clockFormat.ts): the whole UI is English, and the Tizen floor is
// Chromium 76 on a device build whose ICU data we do not control — a
// reduced-ICU build answers a locale request it cannot honour rather than
// failing loudly. It also makes these tests mean the same thing on every
// machine that runs them.
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export interface ScheduleDayLabel {
  // THE WHOLE LABEL, on one line. 'Yesterday' / 'Today' / 'Tomorrow' for the
  // three days a viewer names rather than dates, and '<Weekday> dd.mm' for
  // every other — no second line, no month in words, no year, no comma.
  // Numeric dd.mm is what fits a compact toolbar and what a European viewer
  // reads as a date without parsing it.
  title: string
  // "No fixtures today." / "No fixtures on Wednesday 2 September."
  //
  // Deliberately NOT dd.mm: this is a sentence, not a toolbar, and a date
  // read aloud inside one wants its month in words. The toolbar's format
  // rules are about the toolbar.
  emptyMessage: string
  // Product language only. Never a backend error, never ninety-api
  // terminology — see the screen's error state.
  errorMessage: string
}

// Zero-padded, always two digits: '02.09', never '2.9'. A fixed-width date
// is what lets the label sit still in the toolbar as the viewer holds the
// next-day arrow down.
const pad2 = (value: number) => String(value).padStart(2, '0')

export function describeScheduleDay(dayOffset: number, now: Date = new Date()): ScheduleDayLabel {
  const date = new Date(localDayRangeOffset(dayOffset, now).startMs)
  const weekday = WEEKDAYS_LONG[date.getDay()]
  const longDate = `${weekday} ${date.getDate()} ${MONTHS_LONG[date.getMonth()]}`

  if (dayOffset === 0) {
    return {
      title: 'Today',
      emptyMessage: 'No fixtures today.',
      errorMessage: "Unable to load today's fixtures.",
    }
  }
  if (dayOffset === -1) {
    return {
      title: 'Yesterday',
      emptyMessage: 'No fixtures yesterday.',
      errorMessage: "Unable to load yesterday's fixtures.",
    }
  }
  if (dayOffset === 1) {
    return {
      title: 'Tomorrow',
      emptyMessage: 'No fixtures tomorrow.',
      errorMessage: "Unable to load tomorrow's fixtures.",
    }
  }
  return {
    // getDate()/getMonth() read the LOCAL calendar fields of the same
    // local-midnight instant the events query is built from, so the number
    // on screen is by construction the day being fetched — month and year
    // ends included, since the instant itself already rolled over.
    title: `${weekday} ${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}`,
    emptyMessage: `No fixtures on ${longDate}.`,
    errorMessage: `Unable to load fixtures for ${longDate}.`,
  }
}
