import { describe, expect, it } from 'vitest'
import { normalizeToViewerMarket, deriveViewerMarkets } from './viewerMarket'

describe('normalizeToViewerMarket', () => {
  it('normalizes a favoriteCountries display name to its code', () => {
    expect(normalizeToViewerMarket('Norway')).toBe('NO')
    expect(normalizeToViewerMarket('Sweden')).toBe('SE')
    expect(normalizeToViewerMarket('Denmark')).toBe('DK')
    expect(normalizeToViewerMarket('France')).toBe('FR')
    expect(normalizeToViewerMarket('Turkey')).toBe('TR')
    expect(normalizeToViewerMarket('Germany')).toBe('DE')
    expect(normalizeToViewerMarket('Portugal')).toBe('PT')
  })

  // Phase 2C: this module no longer maintains its own backend-coverage
  // allowlist, so a country ninety-api gains EPG coverage for later (or
  // never gets around to) is recognized here exactly the same way --
  // Spain/Italy are ordinary recognized countries now, not a special case.
  it('normalizes newly-relevant markets the same way as any other recognized country', () => {
    expect(normalizeToViewerMarket('Spain')).toBe('ES')
    expect(normalizeToViewerMarket('Italy')).toBe('IT')
  })

  it('normalizes both United Kingdom spellings to GB', () => {
    expect(normalizeToViewerMarket('United Kingdom')).toBe('GB')
    expect(normalizeToViewerMarket('UK')).toBe('GB')
  })

  it('is case-insensitive and trims whitespace', () => {
    expect(normalizeToViewerMarket('  norway  ')).toBe('NO')
    expect(normalizeToViewerMarket('NORWAY')).toBe('NO')
  })

  it('accepts an already-bare 2-letter code defensively, even one the backend has no coverage for', () => {
    expect(normalizeToViewerMarket('NO')).toBe('NO')
    expect(normalizeToViewerMarket('no')).toBe('NO')
    expect(normalizeToViewerMarket('ES')).toBe('ES')
    expect(normalizeToViewerMarket('BR')).toBe('BR')
  })

  it('returns null for empty/unrecognized input -- garbage is still safely ignored', () => {
    expect(normalizeToViewerMarket('')).toBeNull()
    expect(normalizeToViewerMarket('   ')).toBeNull()
    expect(normalizeToViewerMarket('Not A Real Country')).toBeNull()
  })
})

describe('deriveViewerMarkets', () => {
  it('preserves favoriteCountries order as market rank', () => {
    expect(deriveViewerMarkets(['Sweden', 'Norway', 'United Kingdom'])).toEqual(['SE', 'NO', 'GB'])
  })

  it('passes through a recognized country regardless of current backend EPG coverage (the whole point of Phase 2C)', () => {
    expect(deriveViewerMarkets(['Spain', 'Norway', 'Brazil'])).toEqual(['ES', 'NO', 'BR'])
  })

  it('still drops genuinely unrecognized garbage without breaking the rest', () => {
    expect(deriveViewerMarkets(['Not A Real Country', 'Norway'])).toEqual(['NO'])
  })

  it('collapses duplicate resolved codes (e.g. UK and United Kingdom both present)', () => {
    expect(deriveViewerMarkets(['United Kingdom', 'UK', 'Norway'])).toEqual(['GB', 'NO'])
  })

  it('returns an empty array for an empty favoriteCountries list, not an error', () => {
    expect(deriveViewerMarkets([])).toEqual([])
  })

  it('returns an empty array when nothing normalizes', () => {
    expect(deriveViewerMarkets(['Not A Real Country', 'Also Not Real'])).toEqual([])
  })

  it('ordering is deterministic and repeatable for the same input (no hidden sort/shuffle)', () => {
    const input = ['Italy', 'Norway', 'Spain', 'Germany']
    expect(deriveViewerMarkets(input)).toEqual(deriveViewerMarkets(input))
    expect(deriveViewerMarkets(input)).toEqual(['IT', 'NO', 'ES', 'DE'])
  })
})
