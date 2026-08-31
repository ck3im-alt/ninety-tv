import { describe, expect, it } from 'vitest'
import { describeScheduleDay } from './scheduleDayLabel'

// A fixed local `now` — built from LOCAL calendar fields, so these hold in
// every timezone the test process might run in (same contract as
// localDay.test.ts). Sunday 30 August 2026 is `now - 1`; Monday 31 August is
// today; Tuesday 1 September is tomorrow.
const NOW = new Date(2026, 7, 31, 14, 0, 0, 0)

// ONE LINE, ALWAYS. The date navigator is a compact toolbar now, so the
// label is the whole of what it says: a relative name for the three days a
// viewer names rather than dates, and '<Weekday> dd.mm' for everything else.
describe('describeScheduleDay — the one-line date label', () => {
  it('calls today exactly "Today"', () => {
    expect(describeScheduleDay(0, NOW).title).toBe('Today')
  })

  it('calls yesterday exactly "Yesterday"', () => {
    expect(describeScheduleDay(-1, NOW).title).toBe('Yesterday')
  })

  it('calls tomorrow exactly "Tomorrow"', () => {
    expect(describeScheduleDay(1, NOW).title).toBe('Tomorrow')
  })

  it('names any other day "<Weekday> dd.mm"', () => {
    expect(describeScheduleDay(2, NOW).title).toBe('Wednesday 02.09')
    expect(describeScheduleDay(5, NOW).title).toBe('Saturday 05.09')
  })

  it('zero-pads both halves, so the label never changes width', () => {
    // 31.08 (two digits either side) and 02.09 (both padded) — the same
    // number of characters, which is what keeps the centred label still
    // while the viewer holds the next-day arrow down.
    expect(describeScheduleDay(3, new Date(2026, 7, 28, 12, 0, 0, 0)).title).toBe('Monday 31.08')
    expect(describeScheduleDay(2, NOW).title).toBe('Wednesday 02.09')
  })

  it('crosses a month end', () => {
    expect(describeScheduleDay(2, new Date(2026, 8, 29, 9, 0, 0, 0)).title).toBe('Thursday 01.10')
  })

  it('crosses a year end', () => {
    expect(describeScheduleDay(2, new Date(2026, 11, 30, 20, 0, 0, 0)).title).toBe('Friday 01.01')
  })

  it('never carries a year, a month name, or a comma', () => {
    for (const offset of [-1, 0, 1, 2, 9, 40, 200]) {
      const { title } = describeScheduleDay(offset, NOW)
      expect(title).not.toMatch(/,/)
      expect(title).not.toMatch(/20\d\d/)
      expect(title).not.toMatch(/January|February|March|April|May|June|July|August|September|October|November|December/)
      expect(title.split('\n')).toHaveLength(1)
    }
  })

  it('reads the day off the same local-day arithmetic the API window uses', () => {
    // 23:30 local, i.e. the hour where a UTC-derived date would already have
    // rolled over for a viewer east of Greenwich.
    const lateEvening = new Date(2026, 7, 31, 23, 30, 0, 0)
    expect(describeScheduleDay(0, lateEvening).title).toBe('Today')
    expect(describeScheduleDay(2, lateEvening).title).toBe('Wednesday 02.09')
  })
})

// Product language: the day is named the way a person would say it, and no
// message anywhere mentions a backend, an endpoint or a status code. These
// are sentences rather than toolbar labels, so they keep their month in
// words — see ScheduleDayLabel.emptyMessage.
describe('describeScheduleDay — empty and error copy', () => {
  it('names the day naturally when nothing is on', () => {
    expect(describeScheduleDay(0, NOW).emptyMessage).toBe('No fixtures today.')
    expect(describeScheduleDay(-1, NOW).emptyMessage).toBe('No fixtures yesterday.')
    expect(describeScheduleDay(1, NOW).emptyMessage).toBe('No fixtures tomorrow.')
    expect(describeScheduleDay(2, NOW).emptyMessage).toBe('No fixtures on Wednesday 2 September.')
  })

  it('stays in product language when the day cannot be loaded', () => {
    expect(describeScheduleDay(0, NOW).errorMessage).toBe("Unable to load today's fixtures.")
    expect(describeScheduleDay(2, NOW).errorMessage).toBe('Unable to load fixtures for Wednesday 2 September.')
  })

  it('never mentions the backend in any state', () => {
    for (const offset of [-1, 0, 1, 5, 40]) {
      const label = describeScheduleDay(offset, NOW)
      const copy = `${label.title} ${label.emptyMessage} ${label.errorMessage}`
      expect(copy).not.toMatch(/api|http|event|endpoint|fetch/i)
    }
  })
})
