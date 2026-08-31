// The presentation rule for one audio rendition. Pure, so it can be pinned
// exactly — which matters because the inputs are whatever a packager
// happened to emit, and the failure mode is a viewer staring at a menu
// reading "nor / swe / dan" and having to guess.
import { describe, expect, it } from 'vitest'
import {
  UNKNOWN_AUDIO_LANGUAGE_CHIP,
  audioLanguageChip,
  audioLanguageDisplayName,
  buildAudioTrackLabel,
  normalizeAudioLanguage,
} from './audioLanguage'

describe('normalizeAudioLanguage', () => {
  // ISO 639-1, 639-2/B and 639-2/T spellings of one language all have to
  // collapse, or the same commentary track compares unequal to itself
  // depending on which field the packager filled in.
  it.each([
    ['no', 'no'],
    ['nb', 'no'],
    ['nn', 'no'],
    ['nor', 'no'],
    ['nob', 'no'],
    ['nno', 'no'],
    ['sv', 'sv'],
    ['swe', 'sv'],
    ['da', 'da'],
    ['dan', 'da'],
    ['en', 'en'],
    ['eng', 'en'],
  ])('maps %s to the canonical %s', (raw, expected) => {
    expect(normalizeAudioLanguage(raw)).toBe(expected)
  })

  it('strips a region or script subtag, in either BCP-47 or Tizen spelling', () => {
    expect(normalizeAudioLanguage('nb-NO')).toBe('no')
    expect(normalizeAudioLanguage('sv-SE')).toBe('sv')
    // Tizen's own locale strings use an underscore (see deviceRegion.ts),
    // and a stream muxed on that kind of pipeline can carry the same shape.
    expect(normalizeAudioLanguage('dan_DK')).toBe('da')
  })

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(normalizeAudioLanguage(' NOR ')).toBe('no')
    expect(normalizeAudioLanguage('SWE')).toBe('sv')
  })

  it('treats an explicit "we do not know" code as no language at all', () => {
    // 'und' is what a muxer writes when the source had no language
    // descriptor. Rendering it as a language would put a meaningless UND
    // chip on the row.
    expect(normalizeAudioLanguage('und')).toBeNull()
    expect(normalizeAudioLanguage('mul')).toBeNull()
    expect(normalizeAudioLanguage('zxx')).toBeNull()
  })

  it('returns null rather than guessing at an unrecognized code', () => {
    expect(normalizeAudioLanguage('ces')).toBeNull()
    expect(normalizeAudioLanguage('')).toBeNull()
    expect(normalizeAudioLanguage(undefined)).toBeNull()
  })
})

describe('audioLanguageDisplayName', () => {
  // Endonyms: the row is being chosen BY a speaker of that language.
  it('uses the endonym for the Scandinavian languages this app actually meets', () => {
    expect(audioLanguageDisplayName('nor')).toBe('Norsk')
    expect(audioLanguageDisplayName('swe')).toBe('Svenska')
    expect(audioLanguageDisplayName('dan')).toBe('Dansk')
    expect(audioLanguageDisplayName('eng')).toBe('English')
  })

  it('collapses both Norwegian written standards onto one spoken language', () => {
    // Bokmål vs Nynorsk is a WRITTEN distinction; a commentary track is
    // spoken, so showing two differently-named Norwegian rows would be a
    // distinction the viewer cannot act on.
    expect(audioLanguageDisplayName('nb')).toBe('Norsk')
    expect(audioLanguageDisplayName('nn')).toBe('Norsk')
  })

  it('returns null for an unknown code instead of inventing a name', () => {
    expect(audioLanguageDisplayName('ces')).toBeNull()
    expect(audioLanguageDisplayName(null)).toBeNull()
  })
})

describe('audioLanguageChip', () => {
  it('gives the conventional short code for a known language', () => {
    expect(audioLanguageChip('nor')).toBe('NO')
    expect(audioLanguageChip('swe')).toBe('SE')
    expect(audioLanguageChip('dan')).toBe('DK')
    expect(audioLanguageChip('eng')).toBe('EN')
  })

  it('still distinguishes rows for an unrecognized but present code', () => {
    // Better than the neutral chip: the viewer can at least see the rows
    // differ by language, even if we cannot name it.
    expect(audioLanguageChip('ces')).toBe('CES')
  })

  it('falls back to a neutral chip when no language was declared', () => {
    expect(audioLanguageChip(undefined)).toBe(UNKNOWN_AUDIO_LANGUAGE_CHIP)
    expect(audioLanguageChip('')).toBe(UNKNOWN_AUDIO_LANGUAGE_CHIP)
    expect(audioLanguageChip('und')).toBe(UNKNOWN_AUDIO_LANGUAGE_CHIP)
  })
})

describe('buildAudioTrackLabel', () => {
  it('prefers a meaningful name the stream supplied over the language', () => {
    // The packager knows things we do not — a track can differ from its
    // neighbours by something other than language.
    expect(buildAudioTrackLabel('Ekspertkommentar', 'nor', 0)).toBe('Ekspertkommentar')
    expect(buildAudioTrackLabel('Stadium atmosphere', 'eng', 1)).toBe('Stadium atmosphere')
  })

  it('never pairs the name with the language when the name only restates it', () => {
    // hls.js falls back to `NAME = attrs.NAME || lang`, so a manifest with
    // no NAME hands us the bare code as the "name". Taking that at face
    // value renders a row reading 'nor'; combining them renders the
    // redundant 'nor — Norsk'.
    expect(buildAudioTrackLabel('nor', 'nor', 0)).toBe('Norsk')
    expect(buildAudioTrackLabel('Norsk', 'nb-NO', 0)).toBe('Norsk')
    expect(buildAudioTrackLabel('NO', 'no', 0)).toBe('Norsk')
    expect(buildAudioTrackLabel('swe', 'swe', 1)).toBe('Svenska')
  })

  it('falls back to the normalized language name when there is no name', () => {
    expect(buildAudioTrackLabel(undefined, 'nor', 0)).toBe('Norsk')
    expect(buildAudioTrackLabel('', 'swe', 1)).toBe('Svenska')
    expect(buildAudioTrackLabel('   ', 'dan', 2)).toBe('Dansk')
  })

  it('falls back to the raw language value for a code it does not know', () => {
    // Honest, and still tells the rows apart.
    expect(buildAudioTrackLabel(undefined, 'ces', 0)).toBe('ces')
  })

  it('keeps a stream-supplied name even when it restated an unknown language', () => {
    expect(buildAudioTrackLabel('ces', 'ces', 0)).toBe('ces')
  })

  it('falls back to a positional label only when nothing at all was declared', () => {
    expect(buildAudioTrackLabel(undefined, undefined, 0)).toBe('Audio 1')
    expect(buildAudioTrackLabel('', 'und', 2)).toBe('Audio 3')
  })

  // The motivating case, end to end: three commentary renditions on one
  // channel, declared the way an HLS packager typically declares them.
  it('produces a readable menu for a Scandinavian multi-commentary channel', () => {
    const declared = [
      { name: 'Norsk', lang: 'nor' },
      { name: 'Svenska', lang: 'swe' },
      { name: 'Dansk', lang: 'dan' },
    ]
    expect(declared.map((track, i) => buildAudioTrackLabel(track.name, track.lang, i))).toEqual(['Norsk', 'Svenska', 'Dansk'])
    expect(declared.map((track) => audioLanguageChip(track.lang))).toEqual(['NO', 'SE', 'DK'])
  })
})
