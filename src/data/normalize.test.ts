import { describe, expect, it } from 'vitest'
import { normalizeChannelName, normalizeCategoryLabel } from './normalize'

describe('normalizeChannelName — quality tags', () => {
  const cases: Array<[string, string]> = [
    ['ESPN 4K', '4K'],
    ['ESPN UHD', 'UHD'],
    ['ESPN FHD', 'FHD'],
    ['ESPN HD', 'HD'],
    ['ESPN SD', 'SD'],
    ['ESPN HEVC', 'HEVC'],
    ['ESPN H265', 'H265'],
    ['ESPN H264', 'H264'],
    ['ESPN H.265', 'H.265'],
    ['ESPN H.264', 'H.264'],
    ['ESPN 50FPS', '50FPS'],
    ['ESPN 60FPS', '60FPS'],
  ]
  for (const [input, expectedTag] of cases) {
    it(`extracts "${expectedTag}" from "${input}" and leaves a clean canonical name`, () => {
      const result = normalizeChannelName(input)
      expect(result.qualityTag).toBe(expectedTag)
      expect(result.canonicalName).toBe('ESPN')
    })
  }

  it('treats "FULL HD" as one compound tag, not "FULL" left dangling in the name', () => {
    const result = normalizeChannelName('ESPN FULL HD')
    expect(result.canonicalName).toBe('ESPN')
    expect(result.qualityTag).toBe('FULL HD')
  })
})

describe('normalizeChannelName — separators', () => {
  const separators = ['|', ':', '-', '_', '[', '(']
  it.each(separators)('strips a trailing quality tag regardless of separator character (%s)', (sep) => {
    const closing = sep === '[' ? ']' : sep === '(' ? ')' : ''
    const input = sep === '[' || sep === '(' ? `ESPN ${sep}HD${closing}` : `ESPN${sep}HD`
    const result = normalizeChannelName(input)
    expect(result.qualityTag).toBe('HD')
    expect(result.canonicalName).toBe('ESPN')
  })

  it('collapses repeated internal whitespace-insensitive matching without corrupting the display name', () => {
    const result = normalizeChannelName('  ESPN   2   HD  ')
    expect(result.qualityTag).toBe('HD')
    expect(result.canonicalName.trim()).toBe('ESPN   2')
  })

  it('is case-insensitive for both country and quality-tag detection', () => {
    const result = normalizeChannelName('us | espn fhd')
    expect(result.qualityTag).toBe('FHD')
    expect(result.canonicalName.trim().toUpperCase()).toBe('ESPN')
  })
})

describe('normalizeChannelName — country prefix/suffix handling', () => {
  it('strips a leading country and a trailing quality tag together', () => {
    const result = normalizeChannelName('UK | SKY SPORTS MAIN EVENT UHD')
    expect(result.canonicalName).toBe('SKY SPORTS MAIN EVENT')
    expect(result.qualityTag).toBe('UHD')
  })

  it('strips a TRAILING country code that sits before the quality tag', () => {
    const result = normalizeChannelName('TNT SPORTS 1 UK HD')
    expect(result.canonicalName).toBe('TNT SPORTS 1')
    expect(result.qualityTag).toBe('HD')
  })

  it('strips a TRAILING country code that sits AFTER the quality tag', () => {
    const result = normalizeChannelName('TELEFE HD ARG')
    expect(result.canonicalName).toBe('TELEFE')
    expect(result.qualityTag).toBe('HD')
  })

  it('strips a trailing country code with no quality tag and no separator at all', () => {
    const result = normalizeChannelName('SBS AU')
    expect(result.canonicalName).toBe('SBS')
    expect(result.qualityTag).toBeNull()
  })
})

describe('normalizeCategoryLabel — unaffected by channel-name-only changes', () => {
  it('still strips quality tags from a category label the same way as before', () => {
    expect(normalizeCategoryLabel('Sports 1 ULTRA RAW GOLD')).toBe('Sports 1')
  })

  it('never strips a country from a category label mid-string (only leading, via parseCategory)', () => {
    // normalizeCategoryLabel itself only strips quality tags, not country —
    // country stripping for categories is parseCategory's job (see
    // parseCategory.test.ts) and is unaffected by the channel-name-only
    // trailing-country logic added to normalizeChannelName.
    expect(normalizeCategoryLabel('Sports 1 HD')).toBe('Sports 1')
  })
})
