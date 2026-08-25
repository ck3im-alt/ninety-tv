import { describe, expect, it } from 'vitest'
import { MAX_PREFERRED_COUNTRIES } from '../../data/preferences'
import type { PlaylistCountry } from '../../data/viewerCountry'
import { buildRecommendedCountries, getNeighborCountryCodes, pickInitialPrimaryCountry } from './recommendedCountries'

const names = (countries: { name: string }[]) => countries.map((c) => c.name)

// A realistically Nordic-heavy playlist, biggest country first — the shape
// playlistCountries() produces.
const NORDIC_PLAYLIST: PlaylistCountry[] = [
  { name: 'Norway', code: 'NO', count: 900 },
  { name: 'United Kingdom', code: 'UK', count: 700 },
  { name: 'Sweden', code: 'SE', count: 500 },
  { name: 'Denmark', code: 'DK', count: 400 },
  { name: 'United States', code: 'US', count: 300 },
  { name: 'Germany', code: 'DE', count: 200 },
]

describe('getNeighborCountryCodes', () => {
  it('returns the expected neighbouring markets for the Nordics', () => {
    expect(getNeighborCountryCodes('NO')).toEqual(['SE', 'DK'])
    expect(getNeighborCountryCodes('SE')).toEqual(['NO', 'DK'])
    expect(getNeighborCountryCodes('DK')).toEqual(['SE', 'DE'])
  })

  it('treats UK and GB as the same market', () => {
    expect(getNeighborCountryCodes('UK')).toEqual(getNeighborCountryCodes('GB'))
  })

  it('is case-insensitive', () => {
    expect(getNeighborCountryCodes('no')).toEqual(['SE', 'DK'])
  })

  it('returns only genuinely adjacent markets, even when that means just one', () => {
    // Canada borders only the United States — padding the row with Mexico
    // would be calling a non-neighbour a neighbour.
    expect(getNeighborCountryCodes('CA')).toEqual(['US'])
  })

  it('returns nothing for an unmapped or missing country rather than throwing', () => {
    expect(getNeighborCountryCodes('ZA')).toEqual([])
    expect(getNeighborCountryCodes(null)).toEqual([])
    expect(getNeighborCountryCodes(undefined)).toEqual([])
  })
})

describe('buildRecommendedCountries', () => {
  it('recommends home + neighbours + UK + US for a Norwegian TV', () => {
    expect(names(buildRecommendedCountries({ homeCountryCode: 'NO', available: NORDIC_PLAYLIST }))).toEqual([
      'Norway',
      'Sweden',
      'Denmark',
      'United Kingdom',
      'United States',
    ])
  })

  it('never exceeds the five-country preference cap', () => {
    const result = buildRecommendedCountries({ homeCountryCode: 'NO', available: NORDIC_PLAYLIST })
    expect(result.length).toBeLessThanOrEqual(MAX_PREFERRED_COUNTRIES)
  })

  it('does not duplicate a country that is both home and a global fallback', () => {
    const result = names(buildRecommendedCountries({ homeCountryCode: 'GB', available: NORDIC_PLAYLIST }))
    expect(result.filter((n) => n === 'United Kingdom')).toHaveLength(1)
    expect(new Set(result).size).toBe(result.length)
  })

  it('collapses the UK/GB alias to one card rather than showing both', () => {
    // The playlist's own entry uses the non-ISO 'UK' prefix while the
    // global fallback asks for 'GB' — same display name, one card.
    const result = buildRecommendedCountries({ homeCountryCode: 'NO', available: NORDIC_PLAYLIST })
    expect(result.filter((c) => c.name === 'United Kingdom')).toHaveLength(1)
  })

  it("backfills from the playlist's biggest countries when a wished-for one isn't carried", () => {
    // No Denmark and no United States in this playlist: those two slots are
    // filled by its largest remaining countries instead of left short.
    const available: PlaylistCountry[] = [
      { name: 'Norway', code: 'NO', count: 900 },
      { name: 'United Kingdom', code: 'UK', count: 700 },
      { name: 'Sweden', code: 'SE', count: 500 },
      { name: 'Germany', code: 'DE', count: 400 },
      { name: 'Spain', code: 'ES', count: 300 },
    ]
    expect(names(buildRecommendedCountries({ homeCountryCode: 'NO', available }))).toEqual([
      'Norway',
      'Sweden',
      'United Kingdom',
      'Germany',
      'Spain',
    ])
  })

  it('offers the home/neighbour/UK/US set even with no playlist connected (step 1 skipped)', () => {
    const result = buildRecommendedCountries({ homeCountryCode: 'NO', available: [] })
    expect(names(result)).toEqual(['Norway', 'Sweden', 'Denmark', 'United Kingdom', 'United States'])
    // Nothing to count against yet — the screen renders these as suggestions.
    expect(result.every((c) => c.count === 0)).toBe(true)
  })

  it('falls back to UK/US plus the playlist when no country was detected', () => {
    expect(names(buildRecommendedCountries({ homeCountryCode: null, available: NORDIC_PLAYLIST }))).toEqual([
      'United Kingdom',
      'United States',
      'Norway',
      'Sweden',
      'Denmark',
    ])
  })

  it('still offers the global fallbacks with no signal and no playlist', () => {
    // Nothing detected and step 1 skipped: the screen must still be usable,
    // so the two always-relevant markets are offered rather than an empty
    // grid. Nothing is pre-selected on the user's behalf (see
    // pickInitialPrimaryCountry).
    expect(names(buildRecommendedCountries({ homeCountryCode: null, available: [] }))).toEqual([
      'United Kingdom',
      'United States',
    ])
  })

  it('skips a detected country Ninety has no display name for', () => {
    const result = names(buildRecommendedCountries({ homeCountryCode: 'ZZ', available: [] }))
    expect(result).toEqual(['United Kingdom', 'United States'])
  })
})

describe('pickInitialPrimaryCountry', () => {
  it('makes the detected home country primary when the playlist carries it', () => {
    expect(pickInitialPrimaryCountry('NO', NORDIC_PLAYLIST)).toBe('Norway')
  })

  it('makes it primary even with no playlist at all', () => {
    expect(pickInitialPrimaryCountry('NO', [])).toBe('Norway')
  })

  it("falls back to the playlist's dominant country when home isn't carried", () => {
    const available: PlaylistCountry[] = [
      { name: 'United Kingdom', code: 'UK', count: 700 },
      { name: 'Germany', code: 'DE', count: 200 },
    ]
    expect(pickInitialPrimaryCountry('NO', available)).toBe('United Kingdom')
  })

  it("falls back to the playlist's dominant country when nothing was detected", () => {
    expect(pickInitialPrimaryCountry(null, NORDIC_PLAYLIST)).toBe('Norway')
  })

  it('selects nothing at all when there is neither a detection nor a playlist', () => {
    expect(pickInitialPrimaryCountry(null, [])).toBeNull()
  })
})
