import { describe, expect, it } from 'vitest'
import { matchLeadingCountry, matchTrailingCountry } from './countryCodes'

describe('matchLeadingCountry', () => {
  it('recognizes a 2-letter ISO code with a pipe separator', () => {
    expect(matchLeadingCountry('UK | SKY SPORTS MAIN EVENT UHD')).toMatchObject({ code: 'UK', countryName: 'United Kingdom', rest: 'SKY SPORTS MAIN EVENT UHD' })
  })

  it('recognizes a 2-letter ISO code with a colon separator', () => {
    expect(matchLeadingCountry('ES: LA 1')).toMatchObject({ code: 'ES', countryName: 'Spain', rest: 'LA 1' })
  })

  // Colloquial 3-letter forms are what real IPTV panels actually use, not
  // real ISO 3166-1 alpha-3 codes — M3U-corpus validation (2026-08-20)
  // found all of these unrecognized before this table was extended.
  for (const [prefix, expectedName] of [
    ['USA', 'United States'],
    ['GER', 'Germany'],
    ['NOR', 'Norway'],
    ['SWE', 'Sweden'],
    ['DEN', 'Denmark'],
    ['MEX', 'Mexico'],
    ['CAN', 'Canada'],
    ['BRA', 'Brazil'],
    ['ARG', 'Argentina'],
    ['AUS', 'Australia'],
  ] as const) {
    it(`recognizes the colloquial 3-letter code "${prefix}"`, () => {
      const result = matchLeadingCountry(`${prefix}: SOME CHANNEL HD`)
      expect(result?.countryName).toBe(expectedName)
      expect(result?.rest).toBe('SOME CHANNEL HD')
    })
  }

  it('does not misread "USA" as code "US" plus stray "A"', () => {
    // Regression guard for the underscore/boundary fix: "US" must not match
    // as a partial prefix of "USA" before the longer/more-specific "USA"
    // entry gets a chance.
    const result = matchLeadingCountry('USA: ESPN 2 HD')
    expect(result?.code).toBe('USA')
    expect(result?.rest).toBe('ESPN 2 HD')
  })

  it('recognizes a leading country wrapped in brackets', () => {
    expect(matchLeadingCountry('[UK] Sky Sports 1')).toMatchObject({ code: 'UK', rest: 'Sky Sports 1' })
  })

  it('recognizes a leading country wrapped in parens', () => {
    expect(matchLeadingCountry('(NO) TV2 Sport 1')).toMatchObject({ code: 'NO', rest: 'TV2 Sport 1' })
  })

  it('recognizes a leading country separated by an underscore', () => {
    expect(matchLeadingCountry('US_ESPN')).toMatchObject({ code: 'US', rest: 'ESPN' })
  })

  it('prefers the full country name over a code when both could match', () => {
    const result = matchLeadingCountry('SPAIN: DAZN 1 FHD')
    expect(result?.countryName).toBe('Spain')
    expect(result?.rest).toBe('DAZN 1 FHD')
  })

  it('returns null honestly when no recognized prefix is present', () => {
    expect(matchLeadingCountry('ESPN 2')).toBeNull()
  })
})

describe('matchTrailingCountry', () => {
  it('recognizes a trailing 2-letter code with no separator/quality tag', () => {
    expect(matchTrailingCountry('SBS AU')).toMatchObject({ code: 'AU', countryName: 'Australia', rest: 'SBS' })
  })

  it('recognizes a trailing 2-letter code with no separator at all (attached word)', () => {
    expect(matchTrailingCountry('NPO 1 NL')).toMatchObject({ code: 'NL', rest: 'NPO 1' })
  })

  it('recognizes a trailing colloquial 3-letter code', () => {
    expect(matchTrailingCountry('TELEFE ARG')).toMatchObject({ code: 'ARG', countryName: 'Argentina', rest: 'TELEFE' })
  })

  it('requires an actual separator before the code — does not misread a real word ending in a code-shaped substring', () => {
    // "PARKS" must never be read as "PAR" + trailing code "KS" (not a real
    // code anyway, but this is the general shape of the risk this guards).
    expect(matchTrailingCountry('CBSSPORTSNETWORKUS')).toBeNull()
  })

  it('recognizes a trailing code with a leading-pipe-style separator', () => {
    expect(matchTrailingCountry('CBS SPORTS NETWORK US')).toMatchObject({ code: 'US', rest: 'CBS SPORTS NETWORK' })
  })

  it('returns null honestly when nothing recognized trails the text', () => {
    expect(matchTrailingCountry('ESPN 2')).toBeNull()
  })
})
