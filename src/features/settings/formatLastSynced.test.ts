import { describe, expect, it } from 'vitest'
import { formatLastSynced } from './formatLastSynced'

const NOW = new Date('2026-08-25T14:32:00').getTime()

describe('formatLastSynced', () => {
  it('says so plainly when a playlist has never synced — never a fabricated timestamp', () => {
    expect(formatLastSynced(null, NOW)).toBe('Never synced')
  })

  it('collapses the last minute to "just now"', () => {
    expect(formatLastSynced(NOW - 5_000, NOW)).toBe('Synced just now')
  })

  it('shows a clock time for earlier the same day', () => {
    expect(formatLastSynced(new Date('2026-08-25T09:05:00').getTime(), NOW)).toBe('Synced 09:05')
  })

  it('shows the weekday within the last week', () => {
    expect(formatLastSynced(new Date('2026-08-23T09:05:00').getTime(), NOW)).toMatch(/^Synced \w+day$/)
  })

  it('falls back to a date for anything older', () => {
    const result = formatLastSynced(new Date('2026-06-01T09:05:00').getTime(), NOW)
    expect(result.startsWith('Synced ')).toBe(true)
    expect(result).not.toMatch(/day$/)
  })
})
