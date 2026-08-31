// The viewer's own calendar day, expressed as UTC instants the ninety-api
// events endpoint can be queried with.
//
// This exists because GET /v1/events?date=YYYY-MM-DD is NOT the viewer's
// today: ninety-api implements that filter as `e.start_time_utc::date`, i.e.
// the UTC calendar date. For anyone outside UTC that misfiles fixtures
// around midnight — a 21:00 Saturday kickoff in Los Angeles is Sunday in
// UTC, and a 00:30 Sunday kickoff in Oslo is still Saturday in UTC. The
// from/to window below asks the same endpoint the question the viewer
// actually means, with no backend change required.
//
// Pure and timezone-agnostic: the local boundaries come from the platform's
// own Date arithmetic, so the device's real timezone (whatever it is) is the
// only input. Nothing here hardcodes a region or an offset.

export interface LocalDayRange {
  // Inclusive start of the viewer's day, as a UTC ISO instant.
  fromUtc: string
  // End of the viewer's day, as a UTC ISO instant — deliberately the LAST
  // millisecond of today rather than midnight tomorrow. The endpoint's
  // inclusive/exclusive treatment of `to` isn't something this client should
  // have to know: landing one millisecond short makes a fixture kicking off
  // at exactly 00:00 tomorrow impossible to include either way, so tomorrow
  // can never leak in as a duplicate of the next day's first fixture.
  toUtc: string
  // The same boundaries as epoch milliseconds, for the client-side
  // belt-and-braces filter (see isWithinLocalDay) — half-open [start, end)
  // so exactly-midnight-tomorrow is excluded there too, by the same rule.
  startMs: number
  endMs: number
}

// `new Date(y, m, d, ...)` builds an instant from LOCAL calendar fields, and
// tolerates out-of-range components by rolling over — so d + 1 correctly
// crosses month and year ends without any calendar arithmetic here, and DST
// transitions are handled by the platform (a 23- or 25-hour day still runs
// from local midnight to local midnight).
export function localDayRange(now: Date = new Date()): LocalDayRange {
  return localDayRangeOffset(0, now)
}

// The viewer's local day `offset` calendar days from today, on exactly the
// same rules — localDayRange is this function at 0.
//
//   -1 = yesterday      0 = today      +1 = tomorrow
//
// NEGATIVE OFFSETS ARE FIRST-CLASS. This was `localDayRangeAhead(days)`
// until Schedule became a browsable day-by-day fixture guide (it can go one
// day back), and a name that only reads forwards would have made the
// yesterday case look like a misuse of the API rather than the ordinary
// thing it is. The arithmetic never cared about the sign — `new Date(y, m,
// d + offset, ...)` rolls backwards over month/year starts exactly as it
// rolls forwards over their ends.
//
// Home's forward expansion (see homeFeedDensity.ts) is the other caller: it
// asks for the next FORWARD_EXPANSION_DAYS days and needs that phrase to
// mean local CALENDAR days rather than `now + n * 24h`. Two things follow
// from the difference, and both matter:
//
//   - the requested window is identical for every refresh within the same
//     local day, which is what makes the expansion request cacheable at all
//     (see useHomeFeed's forward-expansion cache), and what lets Schedule
//     key a visited-day cache on it (see useScheduleDay);
//   - a DST transition inside the window cannot shift its far end by an
//     hour, so the day is whole in either direction.
export function localDayRangeOffset(offset: number, now: Date = new Date()): LocalDayRange {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 0, 0, 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset + 1, 0, 0, 0, 0)
  const startMs = start.getTime()
  const endMs = end.getTime()
  return {
    fromUtc: start.toISOString(),
    toUtc: new Date(endMs - 1).toISOString(),
    startMs,
    endMs,
  }
}

// Second, independent guard on the same boundary: whatever comparison the
// backend applies to from/to, an event only reaches the schedule if its own
// kickoff instant really falls inside the viewer's local day. Events with no
// known kickoff time can't be placed on a day at all, so they're excluded.
export function isWithinLocalDay(dateTimeUtc: string | null | undefined, range: LocalDayRange): boolean {
  if (!dateTimeUtc) return false
  const ms = new Date(dateTimeUtc).getTime()
  if (Number.isNaN(ms)) return false
  return ms >= range.startMs && ms < range.endMs
}
