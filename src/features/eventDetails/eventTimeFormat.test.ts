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
  it('formats a valid timestamp as a localized HH:MM time', () => {
    const time = formatKickoffTime(isoAtOffsetDays(0))
    expect(time).toMatch(/\d{1,2}:\d{2}/)
  })

  it('returns an empty string for a null or invalid timestamp', () => {
    expect(formatKickoffTime(null)).toBe('')
    expect(formatKickoffTime('garbage')).toBe('')
  })
})
