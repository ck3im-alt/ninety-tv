import { describe, expect, it } from 'vitest'
import { isWithinLocalDay, localDayRange } from './localDay'

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
