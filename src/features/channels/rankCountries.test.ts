import { describe, expect, it } from 'vitest'
import { OTHER_COUNTRY, preferredBoundary, rankCountries, type CountryEntry } from './rankCountries'

const country = (name: string, count: number): CountryEntry => ({ name, code: null, count })

// A realistic playlist shape: a big non-preferred market, a couple of
// smaller preferred ones, and the catch-all bucket.
const PLAYLIST: CountryEntry[] = [
  country('Germany', 4000),
  country('Norway', 800),
  country(OTHER_COUNTRY, 12000),
  country('United Kingdom', 3000),
  country('Sweden', 600),
  country('Denmark', 500),
]

describe('rankCountries', () => {
  // THE RULE, and the regression this file exists for: finishing onboarding
  // used to seed hiddenCountries with every country the viewer had NOT
  // preferred, so "I mostly watch Norway" deleted Germany, Denmark and the
  // rest of a 30,000-channel playlist from Channels outright.
  it('never removes a country, however few are preferred', () => {
    const ranked = rankCountries(PLAYLIST, ['Norway'])
    expect(ranked.map((r) => r.country.name).sort()).toEqual(PLAYLIST.map((c) => c.name).sort())
  })

  it('puts preferred countries first, in the viewer\'s own stored order', () => {
    const ranked = rankCountries(PLAYLIST, ['Norway', 'Sweden', 'United Kingdom'])
    expect(ranked.slice(0, 3).map((r) => r.country.name)).toEqual(['Norway', 'Sweden', 'United Kingdom'])
    // Preference order is priority order — Norway is primary even though the
    // UK carries four times as many channels.
    expect(ranked[0].preferred).toBe(true)
  })

  it('orders everything else biggest-first, with the catch-all bucket last', () => {
    const ranked = rankCountries(PLAYLIST, ['Norway'])
    expect(ranked.map((r) => r.country.name)).toEqual([
      'Norway',
      'Germany',
      'United Kingdom',
      'Sweden',
      'Denmark',
      OTHER_COUNTRY,
    ])
  })

  it('keeps "Other" last even when it is by far the biggest bucket', () => {
    const ranked = rankCountries(PLAYLIST, [])
    expect(ranked.at(-1)?.country.name).toBe(OTHER_COUNTRY)
  })

  it('never treats the catch-all bucket as preferred, even if it is listed', () => {
    // Not reachable through the UI, but a hand-edited store could hold it,
    // and "Other" is a bucket rather than a market.
    const ranked = rankCountries(PLAYLIST, [OTHER_COUNTRY])
    expect(ranked.at(-1)?.country.name).toBe(OTHER_COUNTRY)
    expect(ranked.every((r) => !r.preferred)).toBe(true)
  })

  it('ignores a preferred country the playlist does not carry', () => {
    const ranked = rankCountries(PLAYLIST, ['Japan', 'Norway'])
    expect(ranked[0].country.name).toBe('Norway')
    expect(ranked).toHaveLength(PLAYLIST.length)
  })

  it('falls back to size order with no preferences at all', () => {
    const ranked = rankCountries(PLAYLIST, [])
    expect(ranked.map((r) => r.country.name)).toEqual([
      'Germany',
      'United Kingdom',
      'Norway',
      'Sweden',
      'Denmark',
      OTHER_COUNTRY,
    ])
  })

  it('is deterministic — ranking an already-ranked list changes nothing', () => {
    const once = rankCountries(PLAYLIST, ['Sweden', 'Norway'])
    const twice = rankCountries(
      once.map((r) => r.country),
      ['Sweden', 'Norway'],
    )
    expect(twice.map((r) => r.country.name)).toEqual(once.map((r) => r.country.name))
  })

  it('does not mutate its input', () => {
    const input = [...PLAYLIST]
    rankCountries(input, ['Denmark'])
    expect(input).toEqual(PLAYLIST)
  })
})

describe('preferredBoundary', () => {
  it('points at the first non-preferred row', () => {
    const ranked = rankCountries(PLAYLIST, ['Norway', 'Sweden'])
    expect(preferredBoundary(ranked)).toBe(2)
  })

  it('reports no boundary when nothing is preferred — no stray divider', () => {
    expect(preferredBoundary(rankCountries(PLAYLIST, []))).toBe(-1)
  })

  it('reports no boundary when every country is preferred', () => {
    const small = [country('Norway', 5), country('Sweden', 3)]
    expect(preferredBoundary(rankCountries(small, ['Norway', 'Sweden']))).toBe(-1)
  })

  it('reports no boundary for an empty list', () => {
    expect(preferredBoundary([])).toBe(-1)
  })
})
