import { describe, expect, it } from 'vitest'
import { formatClockTime24h, formatIsoClockTime24h } from './clockFormat'

// The bug this module exists for: on a TV whose locale is en-US,
// `toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })` renders
// 19:00 as "7 PM". Asserting the exact string (rather than a loose
// /\d{1,2}:\d{2}/, which "09:00 PM" also satisfies — that is precisely why
// the old eventTimeFormat test never caught it) is the whole point.
describe('formatClockTime24h', () => {
  it('renders an evening time in 24-hour form, never AM/PM', () => {
    expect(formatClockTime24h(new Date(2026, 7, 28, 19, 0))).toBe('19:00')
  })

  it('pads both fields to two digits', () => {
    expect(formatClockTime24h(new Date(2026, 7, 28, 9, 5))).toBe('09:05')
  })

  it('renders midnight as 00:00, not 24:00 — the h24 trap `hour12: false` can fall into', () => {
    expect(formatClockTime24h(new Date(2026, 7, 28, 0, 0))).toBe('00:00')
  })

  it('renders noon as 12:00', () => {
    expect(formatClockTime24h(new Date(2026, 7, 28, 12, 0))).toBe('12:00')
  })

  it('renders the last minute of the day as 23:59', () => {
    expect(formatClockTime24h(new Date(2026, 7, 28, 23, 59))).toBe('23:59')
  })

  // The output must not move when the device's locale does. A reduced-ICU
  // TV build is the case that matters and cannot be simulated here, so this
  // asserts the property that makes that case safe: no Intl involvement.
  it('does not consult the locale at all', () => {
    const at = new Date(2026, 7, 28, 19, 0)
    const original = Date.prototype.toLocaleTimeString
    Date.prototype.toLocaleTimeString = () => {
      throw new Error('formatClockTime24h must not go through Intl')
    }
    try {
      expect(formatClockTime24h(at)).toBe('19:00')
    } finally {
      Date.prototype.toLocaleTimeString = original
    }
  })
})

describe('formatIsoClockTime24h', () => {
  it('converts a UTC instant to the viewer\'s own local wall clock', () => {
    // Timezone is deliberately NOT fixed by this module, so the expectation
    // is derived the same way the platform would — what is pinned is the
    // SHAPE, and that it matches the Date-taking overload exactly.
    const iso = '2026-08-28T19:00:00Z'
    expect(formatIsoClockTime24h(iso)).toBe(formatClockTime24h(new Date(iso)))
    expect(formatIsoClockTime24h(iso)).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
  })

  it('returns an empty string rather than a fabricated time', () => {
    expect(formatIsoClockTime24h(null)).toBe('')
    expect(formatIsoClockTime24h(undefined)).toBe('')
    expect(formatIsoClockTime24h('')).toBe('')
    expect(formatIsoClockTime24h('garbage')).toBe('')
  })
})
