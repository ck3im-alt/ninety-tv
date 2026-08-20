import { describe, expect, it } from 'vitest'
import {
  SUPPORTED_VIEWER_MARKETS,
  isSupportedViewerMarket,
  normalizeToViewerMarket,
  deriveViewerMarkets,
} from './viewerMarket'

describe('isSupportedViewerMarket', () => {
  it('accepts every currently-supported market code', () => {
    for (const code of SUPPORTED_VIEWER_MARKETS) {
      expect(isSupportedViewerMarket(code)).toBe(true)
    }
  })

  it('is case-insensitive', () => {
    expect(isSupportedViewerMarket('no')).toBe(true)
  })

  it('rejects a market with no EPG coverage', () => {
    expect(isSupportedViewerMarket('ES')).toBe(false)
  })
})

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

  it('normalizes both United Kingdom spellings to GB', () => {
    expect(normalizeToViewerMarket('United Kingdom')).toBe('GB')
    expect(normalizeToViewerMarket('UK')).toBe('GB')
  })

  it('is case-insensitive and trims whitespace', () => {
    expect(normalizeToViewerMarket('  norway  ')).toBe('NO')
    expect(normalizeToViewerMarket('NORWAY')).toBe('NO')
  })

  it('accepts an already-bare supported code defensively', () => {
    expect(normalizeToViewerMarket('NO')).toBe('NO')
    expect(normalizeToViewerMarket('no')).toBe('NO')
  })

  it('returns null for a real country with no EPG coverage, rather than throwing', () => {
    expect(normalizeToViewerMarket('Spain')).toBeNull()
    expect(normalizeToViewerMarket('ES')).toBeNull()
  })

  it('returns null for empty/unrecognized input', () => {
    expect(normalizeToViewerMarket('')).toBeNull()
    expect(normalizeToViewerMarket('   ')).toBeNull()
    expect(normalizeToViewerMarket('Not A Real Country')).toBeNull()
  })
})

describe('deriveViewerMarkets', () => {
  it('preserves favoriteCountries order as market rank', () => {
    expect(deriveViewerMarkets(['Sweden', 'Norway', 'United Kingdom'])).toEqual(['SE', 'NO', 'GB'])
  })

  it('drops entries with no EPG coverage without breaking the rest', () => {
    expect(deriveViewerMarkets(['Spain', 'Norway', 'Brazil'])).toEqual(['NO'])
  })

  it('collapses duplicate resolved codes (e.g. UK and United Kingdom both present)', () => {
    expect(deriveViewerMarkets(['United Kingdom', 'UK', 'Norway'])).toEqual(['GB', 'NO'])
  })

  it('returns an empty array for an empty favoriteCountries list, not an error', () => {
    expect(deriveViewerMarkets([])).toEqual([])
  })

  it('returns an empty array when nothing normalizes', () => {
    expect(deriveViewerMarkets(['Spain', 'Brazil'])).toEqual([])
  })
})
