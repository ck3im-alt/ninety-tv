import { describe, expect, it } from 'vitest'
import {
  UNKNOWN_VIEWER_COUNTRY,
  dominantPlaylistCountry,
  playlistCountries,
  regionFromLocaleTag,
  regionFromTizenLocale,
  resolveViewerCountry,
} from './viewerCountry'
import type { Channel } from './channel'

function channel(groupTitle: string, id = groupTitle): Channel {
  return { id, name: id, groupTitle, sources: [] } as unknown as Channel
}

describe('regionFromLocaleTag', () => {
  it('extracts the region from an ordinary BCP-47 tag', () => {
    expect(regionFromLocaleTag('nb-NO')).toBe('NO')
    expect(regionFromLocaleTag('de-DE')).toBe('DE')
  })

  it('accepts POSIX-style underscores and a charset suffix', () => {
    expect(regionFromLocaleTag('nb_NO')).toBe('NO')
    expect(regionFromLocaleTag('en_US.UTF-8')).toBe('US')
  })

  it('looks past a script subtag', () => {
    expect(regionFromLocaleTag('zh-Hans-CN')).toBe('CN')
  })

  it('returns null for a bare language — a language is not a country', () => {
    expect(regionFromLocaleTag('en')).toBeNull()
    expect(regionFromLocaleTag('nb')).toBeNull()
  })

  it('returns null for a UN M.49 macro-region, which is not a country', () => {
    expect(regionFromLocaleTag('es-419')).toBeNull()
  })

  it('returns null for empty/garbage input rather than throwing', () => {
    expect(regionFromLocaleTag('')).toBeNull()
    expect(regionFromLocaleTag('-')).toBeNull()
  })

  it('canonicalizes UK to GB, matching ninety-api competition country codes', () => {
    expect(regionFromLocaleTag('en-UK')).toBe('GB')
    expect(regionFromLocaleTag('en-GB')).toBe('GB')
  })
})

describe('regionFromTizenLocale', () => {
  it("parses Tizen's (LANGUAGE)_(REGION) locale shape", () => {
    expect(regionFromTizenLocale('eng_US')).toBe('US')
    expect(regionFromTizenLocale('nor_NO')).toBe('NO')
  })

  it('returns null for a language-only value or nothing at all', () => {
    expect(regionFromTizenLocale('eng')).toBeNull()
    expect(regionFromTizenLocale(null)).toBeNull()
    expect(regionFromTizenLocale(undefined)).toBeNull()
  })
})

describe('playlistCountries', () => {
  it('counts channels per country, biggest first', () => {
    const channels = [channel('NO| Sport 1'), channel('NO| Sport 2'), channel('UK| Sport 1'), channel('SE| Sport 1')]
    expect(playlistCountries(channels).map((c) => [c.name, c.count])).toEqual([
      ['Norway', 2],
      ['Sweden', 1],
      ['United Kingdom', 1],
    ])
  })

  it('ignores channels with no recognizable country', () => {
    expect(playlistCountries([channel('Random Category')])).toEqual([])
  })

  it('has no dominant country for an empty playlist', () => {
    expect(dominantPlaylistCountry([])).toBeNull()
  })
})

describe('resolveViewerCountry', () => {
  it('prefers the TV system region over everything else', () => {
    expect(
      resolveViewerCountry({ tizenLocale: 'nor_NO', localeTags: ['en-GB'], playlistCountryCode: 'US' }),
    ).toEqual({ code: 'NO', source: 'tizen-region' })
  })

  it('falls back to a locale with a usable region', () => {
    expect(resolveViewerCountry({ tizenLocale: null, localeTags: ['nb-NO', 'en'], playlistCountryCode: 'US' })).toEqual({
      code: 'NO',
      source: 'locale',
    })
  })

  it('skips locale tags that carry only a language and keeps looking', () => {
    expect(resolveViewerCountry({ localeTags: ['en', 'de-DE'] })).toEqual({ code: 'DE', source: 'locale' })
  })

  it('falls back to the dominant playlist country when no locale carries a region', () => {
    expect(resolveViewerCountry({ localeTags: ['en'], playlistCountryCode: 'DK' })).toEqual({
      code: 'DK',
      source: 'playlist',
    })
  })

  it('canonicalizes a playlist UK prefix to GB', () => {
    expect(resolveViewerCountry({ playlistCountryCode: 'UK' })).toEqual({ code: 'GB', source: 'playlist' })
  })

  it('degrades to unknown when no signal exists at all', () => {
    expect(resolveViewerCountry({})).toEqual(UNKNOWN_VIEWER_COUNTRY)
    expect(resolveViewerCountry({ tizenLocale: null, localeTags: [], playlistCountryCode: null })).toEqual(
      UNKNOWN_VIEWER_COUNTRY,
    )
  })
})
