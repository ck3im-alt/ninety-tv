import { describe, expect, it } from 'vitest'
import { formatEventDayLabel, formatKickoffTime } from './eventTimeFormat'

function isoAtOffsetDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

describe('formatEventDayLabel', () => {
  it('returns "Today" for a timestamp on the current calendar day', () => {
    expect(formatEventDayLabel(isoAtOffsetDays(0))).toBe('Today')
  })

  it('returns "Tomorrow" for a timestamp on the next calendar day', () => {
    expect(formatEventDayLabel(isoAtOffsetDays(1))).toBe('Tomorrow')
  })

  it('returns a short localized date otherwise', () => {
    const label = formatEventDayLabel(isoAtOffsetDays(5))
    expect(label).not.toBe('Today')
    expect(label).not.toBe('Tomorrow')
    expect(label.length).toBeGreaterThan(0)
  })

  it('returns an empty string for a null or invalid timestamp', () => {
    expect(formatEventDayLabel(null)).toBe('')
    expect(formatEventDayLabel('not-a-date')).toBe('')
  })
})

describe('formatKickoffTime', () => {
  // The old assertion here was /\d{1,2}:\d{2}/, which "09:00 PM" satisfies —
  // so it passed for months on a device whose locale is en-US while the
  // header actually read "7 PM". Anchored and hour-bounded now: 00-23 only,
  // nothing before or after.
  it('formats a valid timestamp as a 24-hour HH:MM time', () => {
    const time = formatKickoffTime(isoAtOffsetDays(0))
    expect(time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
  })

  it('never renders AM/PM, whatever the device locale says', () => {
    const time = formatKickoffTime('2026-08-28T19:00:00Z')
    expect(time).not.toMatch(/[AP]M/i)
  })

  it('returns an empty string for a null or invalid timestamp', () => {
    expect(formatKickoffTime(null)).toBe('')
    expect(formatKickoffTime('garbage')).toBe('')
  })
})
