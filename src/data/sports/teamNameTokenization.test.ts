// THE ACCENTED-LETTER MATCH EXPLOSION — regression coverage.
//
// Reported from a real Samsung TV on 2026-08-31: opening København vs
// SønderjyskE produced ~50 "trusted" stream rows, including Dutch radio
// stations, Nicktoons and Rikstoto Direkt, took many seconds to build, and
// made the remote unusable. The top pick had 50 unrelated playlist channels
// merged behind it — so pressing Watch could have started Røa vs Lyn.
//
// One cause, two steps:
//
//   1. foldForMatching deliberately preserved Æ/Ø/Å, so "København" folded
//      to "KØBENHAVN".
//   2. Every tokenizer downstream splits on /[^A-Z0-9 ]+/, so Ø became a
//      WORD BREAK: ["BENHAVN", "K"].
//
// textMatchesTeam asks whether a channel name CONTAINS one of those tokens,
// so the fixture matched every channel with a "K" in it AND an "S" in it —
// which is very nearly every channel in any playlist.
//
// This affects a large share of the leagues Ninety tracks: Nordic clubs
// (København, Brøndby, Bodø/Glimt, Tromsø, Malmö), German (München),
// Spanish (Alavés), French (Saint-Étienne). It is not an edge case.
import { describe, expect, it } from 'vitest'
import { foldForMatching, foldForDisplay } from '../fancyUnicode'
import { significantWords, textMatchesTeam } from './channelMatchCore'

// Real names from the reported playlist. Not one of them is showing Danish
// football; every one of them matched before the fix.
const JUNK_CHANNELS = [
  "SKY RADIO 90'S",
  'AMSTERDAM FUNK CHANNEL',
  'KERST RADIO',
  'SINTERKLAAS FM',
  'NICKTOONS',
  'RIKSTOTO DIREKT',
  'SKY SHOWTIME 1',
  'GOLD: NRK1 MØRE OG ROMSDAL',
  'BILKANALEN AUTO MOTOR OG SPORT TV',
  // A sibling PPV slot on the same provider, showing a DIFFERENT fixture.
  // This is the one that actually got merged into the top pick.
  'NEXT | RØA - LYN | Mon 31 Aug 17:40 CEST (NO) | 8K EXCLUSIVE | NO: TV2 PLAY PPV 1',
  'NEXT | BAYERN MÜNCHEN - MAINZ | Mon 31 Aug 17:55 CEST (NO) | 8K EXCLUSIVE | NO: TV2 PLAY PPV 3',
]

const matchesFixture = (channelName: string, home: string, away: string) => {
  const folded = foldForMatching(channelName)
  return textMatchesTeam(folded, home) && textMatchesTeam(folded, away)
}

describe('foldForMatching folds accented letters to ASCII', () => {
  it('folds the Nordic letters that caused this', () => {
    expect(foldForMatching('København')).toBe('KOBENHAVN')
    expect(foldForMatching('SønderjyskE')).toBe('SONDERJYSKE')
    expect(foldForMatching('Bodø/Glimt')).toBe('BODO/GLIMT')
    expect(foldForMatching('Malmö')).toBe('MALMO')
  })

  it('folds the other diacritics Ninety’s leagues are full of', () => {
    expect(foldForMatching('Bayern München')).toBe('BAYERN MUNCHEN')
    expect(foldForMatching('Saint-Étienne')).toBe('SAINT-ETIENNE')
    expect(foldForMatching('Alavés')).toBe('ALAVES')
  })

  // THE CONTRACT THIS MUST NOT BREAK. Callers slice the ORIGINAL string by
  // offsets found in the folded one (parseCategory does exactly this), so
  // the fold is strictly one character to one character — which is why Æ
  // folds to A rather than AE.
  it('never changes the length of the string', () => {
    for (const name of ['København', 'Ærø', 'Bodø/Glimt', 'Bayern München', 'Þór', ...JUNK_CHANNELS]) {
      expect(foldForMatching(name)).toHaveLength(name.length)
    }
  })

  // Matching only. A viewer must still see their channel spelled the way
  // their provider spelled it.
  it('leaves the display fold alone', () => {
    expect(foldForDisplay('Bodø/Glimt')).toBe('Bodø/Glimt')
  })
})

describe('significantWords never yields a token too short to identify a team', () => {
  it('keeps an accented name whole instead of splitting it at the accent', () => {
    expect(significantWords('København')).toEqual(['KOBENHAVN'])
    expect(significantWords('SønderjyskE')).toEqual(['SONDERJYSKE'])
  })

  it('produces no one- or two-character tokens for any tracked-league name', () => {
    const names = [
      'København', 'SønderjyskE', 'Bodø/Glimt', 'Tromsø', 'Malmö', 'Göteborg',
      'Bayern München', 'Saint-Étienne', 'Alavés', 'Brøndby', 'Åtvidaberg',
    ]
    for (const name of names) {
      for (const word of significantWords(name)) {
        expect(word.length, `${name} produced the token "${word}"`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('still splits on genuine separators', () => {
    expect(significantWords('Bodø/Glimt')).toContain('GLIMT')
    expect(significantWords('Bayern München')).toContain('BAYERN')
  })
})

describe('a Nordic fixture no longer matches the whole playlist', () => {
  it('matches none of the channels that flooded the real screen', () => {
    for (const name of JUNK_CHANNELS) {
      expect(matchesFixture(name, 'København', 'SønderjyskE'), `"${name}" must not match`).toBe(false)
    }
  })

  // The other half of the regression: the fix must not have been achieved by
  // simply matching less.
  it('still matches the entries that genuinely are this fixture', () => {
    const real = [
      'TV2 PLAY | København - SønderjyskE | Mon 31 Aug 19:00 CEST (NO) | 8K EXCLUSIVE',
      'NO: DIREKTESPORT | Kobenhavn - Sonderjyske | 19:00',
      'VIAPLAY | KØBENHAVN - SØNDERJYSKE | 19:00',
    ]
    for (const name of real) {
      expect(matchesFixture(name, 'København', 'SønderjyskE'), `"${name}" must still match`).toBe(true)
    }
  })

  // A provider spelling a team without its accents (very common in M3U
  // titles) has to keep working — that is the whole reason both sides are
  // folded the same way rather than the team name alone being normalized.
  it('matches across an accent mismatch in either direction', () => {
    expect(matchesFixture('BODO GLIMT - TROMSO', 'Bodø/Glimt', 'Tromsø')).toBe(true)
    expect(matchesFixture('BODØ/GLIMT - TROMSØ', 'Bodo/Glimt', 'Tromso')).toBe(true)
  })

  it('does not match a different fixture from the same competition', () => {
    expect(matchesFixture('NEXT | BRØNDBY - MIDTJYLLAND | 19:00', 'København', 'SønderjyskE')).toBe(false)
  })
})
