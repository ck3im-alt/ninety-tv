import { describe, expect, it } from 'vitest'
import { normalizeHumanText, normalizeVenueName, repairMojibake } from './humanText'

describe('repairMojibake', () => {
  // The exact defect this exists for, from real ninety-api venue data.
  it('repairs UTF-8 that was decoded as Latin-1 ("BernabÃ©u" -> "Bernabéu")', () => {
    expect(repairMojibake('Estadio Santiago BernabÃ©u')).toBe('Estadio Santiago Bernabéu')
  })

  it('leaves an already-correct venue name untouched', () => {
    expect(repairMojibake('Estadio Santiago Bernabéu')).toBe('Estadio Santiago Bernabéu')
  })

  // The signature check has to be tight enough that ordinary accented
  // European text never trips it — every one of these is a legal single-byte
  // character that is ALSO a legal UTF-8 lead byte, so only the "followed by
  // a continuation byte" half of the rule keeps them safe.
  it.each([
    'Allianz Arena, München',
    'Estádio do Dragão',
    'Parc des Princes',
    'Ullevaal Stadion, Oslo',
    'Malmö Stadion',
    'Vodafone Park, Beşiktaş',
    'Estadio Ramón Sánchez-Pizjuán',
    'Stade Océane, Le Havre',
    'Brøndby Stadion',
    'Stadion Miejski, Kraków',
  ])('leaves correct Unicode intact: %s', (name) => {
    expect(repairMojibake(name)).toBe(name)
  })

  it('repairs a Windows-1252 mangling (the 0x80–0x9F window), not just Latin-1', () => {
    // "–" (U+2013) UTF-8-encodes to E2 80 93; a CP1252 decoder renders those
    // three bytes as "â", "€", "“".
    expect(repairMojibake('Arena â€“ North Stand')).toBe('Arena – North Stand')
  })

  it('repairs a double-encoded string in one call', () => {
    expect(repairMojibake('BernabÃƒÂ©u')).toBe('Bernabéu')
  })

  it('leaves plain ASCII completely alone', () => {
    expect(repairMojibake('Old Trafford')).toBe('Old Trafford')
  })

  it('leaves a string mixing mojibake with real multi-byte Unicode alone rather than half-repairing it', () => {
    // The CJK character cannot have come from a single byte, so recovery is
    // abandoned outright — a conservative refusal, not a partial rewrite.
    const mixed = 'BernabÃ©u 東京'
    expect(repairMojibake(mixed)).toBe(mixed)
  })

  it('never emits a replacement character', () => {
    // 0xC3 with no valid continuation after it: the signature does not match,
    // so nothing is attempted and the text survives as-is.
    expect(repairMojibake('Stadio Ã')).toBe('Stadio Ã')
  })
})

describe('normalizeHumanText', () => {
  it('applies the mojibake repair', () => {
    expect(normalizeHumanText('Estadio Santiago BernabÃ©u')).toBe('Estadio Santiago Bernabéu')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeHumanText('  Old Trafford  ')).toBe('Old Trafford')
  })

  it('normalizes decomposed Unicode to NFC so one spelling of an accent reaches the UI', () => {
    // "e" + U+0301 combining acute — renders identically to the precomposed
    // "\u00e9", compares unequal until normalized.
    const decomposed = 'Bernab\u0065\u0301u'
    const precomposed = 'Bernab\u00e9u'
    expect(decomposed).not.toBe(precomposed)
    expect(normalizeHumanText(decomposed)).toBe(precomposed)
  })
})

describe('normalizeVenueName', () => {
  it('passes null/undefined through as undefined (never a placeholder string)', () => {
    expect(normalizeVenueName(null)).toBeUndefined()
    expect(normalizeVenueName(undefined)).toBeUndefined()
  })

  it('normalizes a real value', () => {
    expect(normalizeVenueName('Estadio Santiago BernabÃ©u')).toBe('Estadio Santiago Bernabéu')
  })
})
