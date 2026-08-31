// Normalization of the language metadata a stream declares on an audio
// rendition, plus the label rule that turns (name, language) into something
// a viewer can read.
//
// Lives in core/player, not in the Player screen, because BOTH layers need
// it and they must not drift: htmlVideoPlayer builds each AudioTrack's
// `label` from it, and the OSD's Audio popup builds the small left chip
// from the same raw language value carried on the model.
//
// Packagers declare language in whatever shape they felt like emitting —
// ISO 639-1 ('no', 'sv'), ISO 639-2/B or /T ('nor', 'swe', 'dan', and the
// B/T split pairs like 'ger'/'deu'), or a BCP-47 tag with a region or
// script subtag ('nb-NO', 'sv-SE', 'zh-Hans'). All of those mean the same
// thing to a viewer, so everything funnels through one canonical key here
// rather than being string-compared raw anywhere else.

interface LanguageEntry {
  // Canonical key — the ISO 639-1 code, used only for identity/comparison.
  key: string
  // Endonym: what speakers of that language call it. A Norwegian viewer
  // picking commentary reads 'Norsk' faster than 'Norwegian', and the row
  // is being chosen BY a speaker of that language.
  displayName: string
  // Short code for the popup's left chip. Deliberately the conventional
  // short form a Nordic viewer recognizes (NO/SE/DK), which is NOT the same
  // thing as a country: an audio track has a language, not a nationality,
  // and nothing here resolves to a flag or a country identity. The chip is
  // a compact restatement of `displayName`, nothing more.
  chip: string
  // Every code seen in the wild that means this language, canonical key
  // included. Matched case-insensitively after the region subtag is cut.
  codes: readonly string[]
}

// Ordered by how likely Ninety is to meet them (Nordic first — see the
// playlists this app actually serves), though lookup is by map, not order.
const LANGUAGES: readonly LanguageEntry[] = [
  // Norwegian, including the two written standards Bokmål ('nb'/'nob') and
  // Nynorsk ('nn'/'nno'). A commentary track is spoken, so the written
  // standard is not a distinction worth showing a viewer — all three
  // collapse to one row label.
  { key: 'no', displayName: 'Norsk', chip: 'NO', codes: ['no', 'nb', 'nn', 'nor', 'nob', 'nno'] },
  { key: 'sv', displayName: 'Svenska', chip: 'SE', codes: ['sv', 'swe'] },
  { key: 'da', displayName: 'Dansk', chip: 'DK', codes: ['da', 'dan'] },
  { key: 'en', displayName: 'English', chip: 'EN', codes: ['en', 'eng'] },
  { key: 'fi', displayName: 'Suomi', chip: 'FI', codes: ['fi', 'fin'] },
  { key: 'is', displayName: 'Íslenska', chip: 'IS', codes: ['is', 'isl', 'ice'] },
  { key: 'de', displayName: 'Deutsch', chip: 'DE', codes: ['de', 'deu', 'ger'] },
  { key: 'fr', displayName: 'Français', chip: 'FR', codes: ['fr', 'fra', 'fre'] },
  { key: 'es', displayName: 'Español', chip: 'ES', codes: ['es', 'spa'] },
  { key: 'it', displayName: 'Italiano', chip: 'IT', codes: ['it', 'ita'] },
  { key: 'nl', displayName: 'Nederlands', chip: 'NL', codes: ['nl', 'nld', 'dut'] },
  { key: 'pt', displayName: 'Português', chip: 'PT', codes: ['pt', 'por'] },
  { key: 'pl', displayName: 'Polski', chip: 'PL', codes: ['pl', 'pol'] },
]

const ENTRY_BY_CODE = new Map<string, LanguageEntry>(LANGUAGES.flatMap((entry) => entry.codes.map((code) => [code, entry] as const)))

// Codes that exist specifically to say "we don't know" — treating them as a
// language would put a meaningless 'UND' chip on a row. 'mul' (multiple)
// and 'zxx' (no linguistic content) are the same kind of non-answer.
const UNKNOWN_LANGUAGE_CODES = new Set(['und', 'mis', 'mul', 'zxx', 'qaa'])

// Neutral chip for a track whose language the stream never declared (or
// declared as "undetermined"). Matches the existing OFF/CC chip style in
// the player's other popups.
export const UNKNOWN_AUDIO_LANGUAGE_CHIP = 'AUDIO'

// 'nb-NO' -> 'nb', 'SV_SE' -> 'sv', ' eng ' -> 'eng'. Underscore is
// accepted alongside the BCP-47 hyphen because Tizen's own locale strings
// use it ('eng_US' — see core/platform/deviceRegion.ts), and a stream muxed
// on that kind of pipeline can carry the same shape.
function primarySubtag(raw: string): string {
  return raw.trim().toLowerCase().split(/[-_]/)[0] ?? ''
}

function lookup(raw: string | null | undefined): LanguageEntry | null {
  if (!raw) return null
  const code = primarySubtag(raw)
  if (!code || UNKNOWN_LANGUAGE_CODES.has(code)) return null
  return ENTRY_BY_CODE.get(code) ?? null
}

// Canonical ISO 639-1 key for any recognized spelling, else null. Exists so
// two differently-spelled declarations of the same language ('nor' on the
// track, 'nb' on the manifest) compare equal without either caller inventing
// its own alias table.
export function normalizeAudioLanguage(raw: string | null | undefined): string | null {
  return lookup(raw)?.key ?? null
}

// Human-readable name, or null when the language is unrecognized/absent —
// null rather than a guess, so callers can fall back to the raw value the
// stream declared instead of this module inventing one.
export function audioLanguageDisplayName(raw: string | null | undefined): string | null {
  return lookup(raw)?.displayName ?? null
}

// Chip text for the popup's left column. An unrecognized but present code
// still beats nothing — a viewer who sees 'CES' at least knows the rows
// differ by language — so it falls back to the raw primary subtag before
// giving up on the neutral chip.
export function audioLanguageChip(raw: string | null | undefined): string {
  const entry = lookup(raw)
  if (entry) return entry.chip
  const code = raw ? primarySubtag(raw) : ''
  if (!code || UNKNOWN_LANGUAGE_CODES.has(code)) return UNKNOWN_AUDIO_LANGUAGE_CHIP
  return code.toUpperCase().slice(0, 4)
}

// True when a stream-supplied track name adds nothing over the language it
// already declares — i.e. the name IS the language, spelled as a code
// ('nor'), as the endonym ('Norsk'), or as the English name ('Norwegian').
// hls.js in particular falls back to `NAME = attrs.NAME || lang`, so a
// manifest that omits NAME hands us the bare code as the "name"; taking it
// at face value would render a row reading 'nor' instead of 'Norsk'.
function nameRestatesLanguage(name: string, language: string | null | undefined): boolean {
  const entry = lookup(language)
  if (!entry) return false
  const normalizedName = name.trim().toLowerCase()
  if (entry.codes.includes(primarySubtag(normalizedName))) return true
  return normalizedName === entry.displayName.toLowerCase() || normalizedName === entry.chip.toLowerCase()
}

// The label rule for one audio rendition, in strict preference order:
//
//   1. a meaningful name the STREAM supplied ('Ekspertkommentar', 'Original
//      commentary') — the packager knows things we don't, and a track can
//      differ from its neighbours by something other than language,
//   2. the normalized language name ('Norsk'),
//   3. the raw language value, when it's a code this module doesn't know
//      ('ces') — honest, and still distinguishes the rows,
//   4. a positional 'Audio N', the only case where nothing at all was
//      declared.
//
// Never combines 1 and 2: 'Norsk — Norwegian' is redundant text, and a
// stream that only supplied a language code must not produce 'nor — Norsk'.
export function buildAudioTrackLabel(name: string | null | undefined, language: string | null | undefined, index: number): string {
  const trimmedName = name?.trim() ?? ''
  if (trimmedName && !nameRestatesLanguage(trimmedName, language)) return trimmedName
  const displayName = audioLanguageDisplayName(language)
  if (displayName) return displayName
  const rawLanguage = language?.trim() ?? ''
  if (rawLanguage && !UNKNOWN_LANGUAGE_CODES.has(primarySubtag(rawLanguage))) return rawLanguage
  // A name that only restated an UNRECOGNIZED language still beats a bare
  // position — it's the one piece of text the stream gave us.
  if (trimmedName) return trimmedName
  return `Audio ${index + 1}`
}
