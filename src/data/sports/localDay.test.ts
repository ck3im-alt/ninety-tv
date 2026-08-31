import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isWithinLocalDay, localDayRange, localDayRangeOffset } from './localDay'

// These assert RELATIONSHIPS, not literal ISO strings: the test process runs
// in whatever timezone the machine has, and hardcoding "the UTC instant of
// local midnight" would only be true in one of them. The properties below
// hold in every timezone, which is the actual contract — see localDay.ts for
// why ninety-api's own `date` filter (a UTC calendar-date comparison) is the
// wrong question to ask on a viewer's behalf.
describe('localDayRange', () => {
  it("starts at the viewer's own local midnight, not UTC midnight", () => {
    const now = new Date(2026, 7, 26, 14, 32, 5, 123)
    const range = localDayRange(now)
    const start = new Date(range.startMs)
    expect(start.getFullYear()).toBe(2026)
    expect(start.getMonth()).toBe(7)
    expect(start.getDate()).toBe(26)
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
    expect(start.getSeconds()).toBe(0)
    expect(start.getMilliseconds()).toBe(0)
  })

  it('ends at the next local midnight, exclusive', () => {
    const range = localDayRange(new Date(2026, 7, 26, 14, 0, 0, 0))
    const end = new Date(range.endMs)
    expect(end.getDate()).toBe(27)
    expect(end.getHours()).toBe(0)
    expect(end.getMinutes()).toBe(0)
  })

  it('sends UTC ISO instants to the API, whatever the local offset is', () => {
    const range = localDayRange(new Date(2026, 7, 26, 14, 0, 0, 0))
    expect(range.fromUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(range.toUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(new Date(range.fromUtc).getTime()).toBe(range.startMs)
  })

  // The one thing that must not happen: tomorrow's first fixture showing up
  // as today's last. `toUtc` deliberately stops one millisecond short of the
  // next local midnight, so the boundary holds whether the backend treats
  // `to` as inclusive or exclusive.
  it('cannot include midnight tomorrow, regardless of how the API treats `to`', () => {
    const range = localDayRange(new Date(2026, 7, 26, 14, 0, 0, 0))
    expect(new Date(range.toUtc).getTime()).toBe(range.endMs - 1)
    expect(new Date(range.toUtc).getTime()).toBeLessThan(range.endMs)
  })

  it('rolls over month ends', () => {
    const range = localDayRange(new Date(2026, 7, 31, 23, 59, 0, 0))
    const end = new Date(range.endMs)
    expect(end.getMonth()).toBe(8)
    expect(end.getDate()).toBe(1)
  })

  it('rolls over year ends', () => {
    const range = localDayRange(new Date(2026, 11, 31, 12, 0, 0, 0))
    const end = new Date(range.endMs)
    expect(end.getFullYear()).toBe(2027)
    expect(end.getMonth()).toBe(0)
    expect(end.getDate()).toBe(1)
  })
})

// Two callers, both of which need a whole local calendar day rather than a
// 24-hour slice of wall clock: Home's density expansion asks for "the next
// seven days" (see localDay.ts's own note on why the far end is anchored to
// midnight rather than to now + N * 24h), and Schedule browses one day at a
// time in either direction (-1 = yesterday, +1 = tomorrow).
describe('localDayRangeOffset', () => {
  it('is localDayRange at zero', () => {
    const now = new Date(2026, 7, 26, 14, 32, 5, 123)
    expect(localDayRangeOffset(0, now)).toEqual(localDayRange(now))
  })

  it('starts at local midnight on the day N days from today', () => {
    const range = localDayRangeOffset(7, new Date(2026, 7, 26, 14, 0, 0, 0))
    const start = new Date(range.startMs)
    expect(start.getMonth()).toBe(8)
    expect(start.getDate()).toBe(2)
    expect(start.getHours()).toBe(0)
  })

  it('ends one millisecond before the following local midnight, so the last day is whole', () => {
    const range = localDayRangeOffset(7, new Date(2026, 7, 26, 14, 0, 0, 0))
    expect(new Date(range.toUtc).getTime()).toBe(range.endMs - 1)
    const end = new Date(range.endMs)
    expect(end.getDate()).toBe(3)
    expect(end.getHours()).toBe(0)
  })

  // What makes the expansion request cacheable at all: every refresh within
  // the same local day asks for exactly the same window.
  it('asks for an identical window at any hour of the same local day', () => {
    const morning = localDayRangeOffset(7, new Date(2026, 7, 26, 6, 0, 0, 0))
    const midnightish = localDayRangeOffset(7, new Date(2026, 7, 26, 23, 59, 59, 999))
    expect(midnightish).toEqual(morning)
  })

  it('rolls over month and year ends', () => {
    const range = localDayRangeOffset(7, new Date(2026, 11, 29, 12, 0, 0, 0))
    const start = new Date(range.startMs)
    expect(start.getFullYear()).toBe(2027)
    expect(start.getMonth()).toBe(0)
    expect(start.getDate()).toBe(5)
  })

  // Schedule's backwards direction. -1 has to be the viewer's YESTERDAY,
  // whole, on exactly the rules +1 gets — not "24 hours before now".
  it('is the viewer’s yesterday at -1', () => {
    const range = localDayRangeOffset(-1, new Date(2026, 7, 26, 14, 32, 5, 123))
    const start = new Date(range.startMs)
    expect(start.getMonth()).toBe(7)
    expect(start.getDate()).toBe(25)
    expect(start.getHours()).toBe(0)
    const end = new Date(range.endMs)
    expect(end.getDate()).toBe(26)
    expect(end.getHours()).toBe(0)
  })

  it('is the viewer’s tomorrow at +1', () => {
    const range = localDayRangeOffset(1, new Date(2026, 7, 26, 14, 0, 0, 0))
    const start = new Date(range.startMs)
    expect(start.getMonth()).toBe(7)
    expect(start.getDate()).toBe(27)
    expect(start.getHours()).toBe(0)
  })

  it('rolls a negative offset backwards over a month start', () => {
    const range = localDayRangeOffset(-1, new Date(2026, 8, 1, 0, 30, 0, 0))
    const start = new Date(range.startMs)
    expect(start.getMonth()).toBe(7)
    expect(start.getDate()).toBe(31)
  })

  it('rolls a negative offset backwards over a year start', () => {
    const range = localDayRangeOffset(-1, new Date(2027, 0, 1, 2, 0, 0, 0))
    const start = new Date(range.startMs)
    expect(start.getFullYear()).toBe(2026)
    expect(start.getMonth()).toBe(11)
    expect(start.getDate()).toBe(31)
  })

  it('crosses a month end going forward from the last day of a month', () => {
    const range = localDayRangeOffset(1, new Date(2026, 7, 31, 22, 0, 0, 0))
    const start = new Date(range.startMs)
    expect(start.getMonth()).toBe(8)
    expect(start.getDate()).toBe(1)
  })

  it('crosses a year end going forward from New Year’s Eve', () => {
    const range = localDayRangeOffset(1, new Date(2026, 11, 31, 22, 0, 0, 0))
    const start = new Date(range.startMs)
    expect(start.getFullYear()).toBe(2027)
    expect(start.getMonth()).toBe(0)
    expect(start.getDate()).toBe(1)
  })

  // Timezone-agnostic DST property: whatever zone the machine is in, every
  // offset produces a window that BEGINS at local midnight and ENDS at the
  // next local midnight. In a DST zone that means some days are 23 or 25
  // hours long — which is the point: the window is a calendar day, never a
  // fixed 24-hour slice.
  it('runs local-midnight to local-midnight for every day of a year', () => {
    const now = new Date(2026, 0, 1, 12, 0, 0, 0)
    for (let offset = 0; offset < 365; offset += 1) {
      const range = localDayRangeOffset(offset, now)
      const start = new Date(range.startMs)
      const end = new Date(range.endMs)
      expect(start.getHours()).toBe(0)
      expect(start.getMinutes()).toBe(0)
      expect(end.getHours()).toBe(0)
      expect(end.getMinutes()).toBe(0)
      const hours = (range.endMs - range.startMs) / 3_600_000
      expect([23, 24, 25]).toContain(hours)
    }
  })
})

// The same DST contract stated as a FACT rather than a property, by pinning
// a zone that actually transitions. Node re-reads process.env.TZ for Dates
// created after it changes, but a runtime without tzdata for the zone would
// silently answer as UTC — hence the capability probe rather than a test
// that fails for an unrelated reason on such a machine.
const OSLO_TZ_SUPPORTED = (() => {
  const previous = process.env.TZ
  process.env.TZ = 'Europe/Oslo'
  const winter = new Date(2026, 0, 15, 12).getTimezoneOffset()
  const summer = new Date(2026, 6, 15, 12).getTimezoneOffset()
  process.env.TZ = previous
  return winter === -60 && summer === -120
})()

describe.skipIf(!OSLO_TZ_SUPPORTED)('localDayRangeOffset — across a real DST transition', () => {
  const previous = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'Europe/Oslo'
  })
  afterAll(() => {
    process.env.TZ = previous
  })

  // 29 March 2026, the European spring-forward: 02:00 local never happens,
  // so the day is 23 hours long. A "now + 24h" window would end at 23:00 and
  // leave the last hour of fixtures on the wrong day.
  it('keeps a 23-hour spring-forward day whole', () => {
    const range = localDayRangeOffset(0, new Date(2026, 2, 29, 15, 0, 0, 0))
    expect(range.endMs - range.startMs).toBe(23 * 3_600_000)
    expect(new Date(range.startMs).getDate()).toBe(29)
    expect(new Date(range.endMs).getDate()).toBe(30)
    expect(new Date(range.endMs).getHours()).toBe(0)
  })

  // 25 October 2026, the autumn fall-back: 25 hours.
  it('keeps a 25-hour fall-back day whole', () => {
    const range = localDayRangeOffset(0, new Date(2026, 9, 25, 15, 0, 0, 0))
    expect(range.endMs - range.startMs).toBe(25 * 3_600_000)
    expect(new Date(range.endMs).getDate()).toBe(26)
    expect(new Date(range.endMs).getHours()).toBe(0)
  })

  // Stepping BACK over the transition from Schedule's date navigator: the
  // day before a spring-forward is a normal 24-hour day, and asking for it
  // from the transition day itself must not land an hour early.
  it('steps back across the transition onto whole local days', () => {
    const range = localDayRangeOffset(-1, new Date(2026, 2, 29, 15, 0, 0, 0))
    expect(new Date(range.startMs).getDate()).toBe(28)
    expect(new Date(range.startMs).getHours()).toBe(0)
    expect(new Date(range.endMs).getDate()).toBe(29)
    expect(new Date(range.endMs).getHours()).toBe(0)
  })
})

describe('isWithinLocalDay', () => {
  const now = new Date(2026, 7, 26, 14, 0, 0, 0)
  const range = localDayRange(now)

  it('includes a fixture at exactly local midnight today', () => {
    expect(isWithinLocalDay(new Date(range.startMs).toISOString(), range)).toBe(true)
  })

  it('includes a fixture in the middle of the local day', () => {
    expect(isWithinLocalDay(new Date(2026, 7, 26, 20, 45).toISOString(), range)).toBe(true)
  })

  it('includes a fixture in the final millisecond of the local day', () => {
    expect(isWithinLocalDay(new Date(range.endMs - 1).toISOString(), range)).toBe(true)
  })

  it('excludes a fixture at exactly local midnight tomorrow', () => {
    expect(isWithinLocalDay(new Date(range.endMs).toISOString(), range)).toBe(false)
  })

  it('excludes yesterday', () => {
    expect(isWithinLocalDay(new Date(range.startMs - 1).toISOString(), range)).toBe(false)
  })

  it('excludes a fixture with no kickoff time at all rather than guessing a day for it', () => {
    expect(isWithinLocalDay(null, range)).toBe(false)
    expect(isWithinLocalDay(undefined, range)).toBe(false)
    expect(isWithinLocalDay('not a date', range)).toBe(false)
  })
})
