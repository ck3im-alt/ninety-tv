import { describe, expect, it } from 'vitest'
import {
  namesOverlap,
  namesExactMatch,
  textMatchesTeam,
  STALE_STATUS_WORDS,
  extractCandidateDates,
  isPlausibleEventDate,
  normalizeCountryKey,
} from './channelMatchCore'
import { foldForMatching } from '../fancyUnicode'

describe('namesOverlap', () => {
  // "TV3", "TV3 Sport", and "TV3+" are three distinct real channels — see
  // BRAND_QUALIFIER_WORDS in channelMatchCore.ts.
  it('does not match TV3+ against TV3', () => {
    expect(namesOverlap('TV3+', 'TV3')).toBe(false)
    expect(namesOverlap('TV3', 'TV3+')).toBe(false)
  })

  it('does not match TV3 Sport against TV3+', () => {
    expect(namesOverlap('TV3 Sport', 'TV3+')).toBe(false)
  })

  it('matches TV3 Plus against TV3+ (spelled-out Plus == + marker)', () => {
    expect(namesOverlap('TV3 Plus', 'TV3+')).toBe(true)
  })

  // Real-world false positive: "Arena Sport Premium 1" matching "Arena
  // Fight" purely off the shared root word "Arena".
  it('does not match Arena Sport Premium 1 against Arena Fight', () => {
    expect(namesOverlap('Arena Sport Premium 1', 'Arena Fight')).toBe(false)
  })

  it('does not match Arena Sport Premium 1 against unrelated Arena siblings', () => {
    expect(namesOverlap('Arena Sport Premium 1', 'Arena eSport')).toBe(false)
    expect(namesOverlap('Arena Sport Premium 1', 'Arena 1X2')).toBe(false)
    expect(namesOverlap('Arena Sport Premium 1', 'NTV Arena')).toBe(false)
    expect(namesOverlap('Arena Sport Premium 1', 'Arena Cloud')).toBe(false)
  })

  it('does not match Arena Sport 1 against Arena Sport 2 (mandatory channel number)', () => {
    expect(namesOverlap('Arena Sport 1', 'Arena Sport 2')).toBe(false)
  })

  it('matches Arena Sport Premium 1 against the same numbered channel with an extra quality tag', () => {
    expect(namesOverlap('Arena Sport Premium 1', 'Arena Sport Premium 1 HD')).toBe(true)
  })

  // Real-world false positive: "V Sport Premium"/"V Film Premium"/"TV2
  // Sport Premium"/"Viaplay Sport Premium" all sharing only "PREMIUM".
  it('does not match unrelated brands sharing only a marketing suffix', () => {
    expect(namesOverlap('Arena Sport Premium 1', 'V Sport Premium')).toBe(false)
    expect(namesOverlap('Arena Sport Premium 1', 'TV2 Sport Premium')).toBe(false)
  })

  // Single-brand-word station ("beIN" reduces to just "BEIN") is trusted on
  // a shared word alone, unlike a multi-word station like "Arena Cloud".
  it('trusts a single-word broadcaster identity as a whole-name match', () => {
    expect(namesOverlap('beIN Sports', 'beIN Sports 1')).toBe(true)
  })

  // Real-world false positive: "TVP Sport"/"TVP 2" matching every unrelated
  // "TVP ..." sibling channel (Historia, ABC, ...).
  it('does not match an umbrella broadcaster against unrelated numbered siblings', () => {
    expect(namesOverlap('TVP 2', 'TVP Historia 2')).toBe(false)
    expect(namesOverlap('TVP 2', 'TVP ABC 2')).toBe(false)
  })

  it('tolerates naming drift via shared meaningful words', () => {
    expect(namesOverlap('TV3 Sport HD', 'SE: TV3 Sport 1')).toBe(false) // station has no number, channel adds one -> extra word
    expect(namesOverlap('TV 2 Sport 1', 'TV2 Sport 1')).toBe(true) // space-separated brand token merges the same as no space
  })
})

describe('namesExactMatch (exact vs fuzzy broadcaster match)', () => {
  it('is true only for the identical word sequence, quality tags aside', () => {
    expect(namesExactMatch('Arena Sport Premium 1', 'Arena Sport Premium 1')).toBe(true)
    expect(namesExactMatch('Arena Sport Premium 1', 'Arena Sport Premium 1 HD')).toBe(true)
  })

  it('is false for a fuzzy/overlap-only match that is not the same sequence', () => {
    expect(namesExactMatch('Arena Sport Premium 1', 'Arena Sport 1')).toBe(false)
    expect(namesExactMatch('Arena Sport Premium 1', 'Arena Sport 1 Premium')).toBe(false)
  })
})

describe('textMatchesTeam (Manchester City vs Coventry City)', () => {
  it('does not match Manchester City text against Coventry City merely via the generic word City', () => {
    const foldedCoventry = foldForMatching('Coventry City vs Sunderland')
    expect(textMatchesTeam(foldedCoventry, 'Manchester City')).toBe(false)
  })

  it('does match when the distinctive club word is actually present', () => {
    const foldedManchester = foldForMatching('Manchester City vs Arsenal')
    expect(textMatchesTeam(foldedManchester, 'Manchester City')).toBe(true)
  })

  it('still matches a genuine Coventry City mention (generic word not stripped from searched text)', () => {
    const foldedCoventry = foldForMatching('Coventry City vs Sunderland')
    expect(textMatchesTeam(foldedCoventry, 'Coventry City')).toBe(true)
  })
})

describe('PPV title containing both teams', () => {
  it('matches a PPV channel name that mentions both home and away teams', () => {
    const folded = foldForMatching('LIVE | Arsenal vs Manchester City | Mon 17 Aug 20:55 CEST')
    expect(textMatchesTeam(folded, 'Arsenal')).toBe(true)
    expect(textMatchesTeam(folded, 'Manchester City')).toBe(true)
  })

  it('does not match when only one of the two teams is present', () => {
    const folded = foldForMatching('LIVE | Arsenal vs Everton | Mon 17 Aug 20:55 CEST')
    expect(textMatchesTeam(folded, 'Arsenal')).toBe(true)
    expect(textMatchesTeam(folded, 'Manchester City')).toBe(false)
  })
})

describe('STALE_STATUS_WORDS (rejecting finished PPV listings)', () => {
  it('flags ENDED / FT / POSTPONED / CANCELLED / ABANDONED as stale', () => {
    for (const status of ['ENDE', 'ENDED', 'FT', 'POSTPONED', 'CANCELLED', 'CANCELED', 'ABANDONED']) {
      expect(STALE_STATUS_WORDS.test(`${status} | DEPORTIVO VS ELCHE`)).toBe(true)
    }
  })

  it('does not flag a live/unstarted listing', () => {
    expect(STALE_STATUS_WORDS.test('LIVE | DEPORTIVO VS ELCHE | MON 17 AUG 20:55')).toBe(false)
  })

  it('does not misfire on an unrelated word merely containing the same letters', () => {
    expect(STALE_STATUS_WORDS.test('ENDEAVOUR SPORTS NETWORK')).toBe(false)
  })
})

describe('extractCandidateDates / isPlausibleEventDate (PPV date rejection)', () => {
  const kickoff = new Date('2026-08-17T20:55:00Z')

  it('accepts a listing dated the same day as kickoff', () => {
    const dates = extractCandidateDates('LIVE | DEPORTIVO VS ELCHE | MON 17 AUG 20:55 CEST')
    expect(dates.length).toBeGreaterThan(0)
    expect(dates.some((d) => isPlausibleEventDate(d, kickoff))).toBe(true)
  })

  it('accepts an ISO-dated listing within tolerance', () => {
    const dates = extractCandidateDates('(STAN 14) | ... (2026-08-18 04:00:29)')
    expect(dates.some((d) => isPlausibleEventDate(d, kickoff))).toBe(true)
  })

  it('rejects a listing dated months away from the real fixture', () => {
    // extractCandidateDates matches month-name text uppercased, mirroring the
    // already-folded text it's actually called with in matchViaPpvChannelName.
    const namedDates = extractCandidateDates('ARSENAL VS MANCHESTER CITY | 17 NOV 20:37 (GMT)')
    expect(namedDates.length).toBeGreaterThan(0)
    expect(namedDates.some((d) => isPlausibleEventDate(d, kickoff))).toBe(false)
  })
})

describe('normalizeCountryKey (UK/GB country normalization)', () => {
  it('normalizes both UK and GB to the same United Kingdom key', () => {
    expect(normalizeCountryKey('GB')).toBe(normalizeCountryKey('UK'))
    expect(normalizeCountryKey('GB')).toBe('UNITED KINGDOM')
  })

  it('is case-insensitive on the input code', () => {
    expect(normalizeCountryKey('gb')).toBe('UNITED KINGDOM')
  })

  it('falls back to the raw (uppercased) value for an unrecognized code', () => {
    expect(normalizeCountryKey('zz')).toBe('ZZ')
  })
})
