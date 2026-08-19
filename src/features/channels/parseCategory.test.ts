import { describe, expect, it } from 'vitest'
import { parseCategory, isPpvCategory } from './parseCategory'

describe('parseCategory', () => {
  it('detects a leading country code prefix and strips it from the label', () => {
    const parsed = parseCategory('NO| Sports 1')
    expect(parsed.countryCode).toBe('NO')
    expect(parsed.countryName).toBe('Norway')
    expect(parsed.mergedLabel).toBe('Sports 1')
  })

  it('detects a leading full country name prefix (longest-match-first) before falling back to a code', () => {
    // "United Kingdom" must win over any single-word/code match — the code
    // returned is whichever of UK/GB is listed FIRST in COUNTRY_NAMES (UK),
    // per countryCodes.ts's "first code wins" NAME_TO_CODE construction.
    const parsed = parseCategory('UNITED KINGDOM SPORTS')
    expect(parsed.countryName).toBe('United Kingdom')
    expect(parsed.countryCode).toBe('UK')
    expect(parsed.mergedLabel).toBe('SPORTS')
  })

  it('falls back to no-country-detected honestly when nothing recognized prefixes the label', () => {
    const parsed = parseCategory('Random Category')
    expect(parsed.countryCode).toBeNull()
    expect(parsed.countryName).toBeNull()
    expect(parsed.label).toBe('Random Category')
  })

  it('never strips PPV as a quality tag — a PPV category keeps its own non-empty mergedLabel', () => {
    const parsed = parseCategory('NO| PPV')
    expect(parsed.mergedLabel).toBe('PPV')
    expect(isPpvCategory(parsed)).toBe(true)
  })

  it('folds a category that is nothing but quality tags into the empty general bucket', () => {
    const parsed = parseCategory('NORWAY VIP')
    expect(parsed.countryName).toBe('Norway')
    expect(parsed.mergedLabel).toBe('')
  })

  it('strips a multi-word quality tag combo as a whole rather than partially', () => {
    const parsed = parseCategory('NO| Sports 1 ULTRA RAW GOLD')
    expect(parsed.mergedLabel).toBe('Sports 1')
  })

  it('isPpvCategory is false for an ordinary, non-PPV category', () => {
    expect(isPpvCategory(parseCategory('NO| Sports 1'))).toBe(false)
  })

  it('memoizes by the exact raw input string — repeated calls return the identical object', () => {
    const raw = `unique-memo-check-${Math.random()}`
    const first = parseCategory(raw)
    const second = parseCategory(raw)
    expect(second).toBe(first) // reference equality proves the cache hit, not just structural equality
  })

  it('does not conflate two different raw strings under one cache entry', () => {
    const a = parseCategory('NO| Sports 1')
    const b = parseCategory('NO| Sports 2')
    expect(a).not.toBe(b)
    expect(a.mergedLabel).toBe('Sports 1')
    expect(b.mergedLabel).toBe('Sports 2')
  })
})
