// IPTV panels commonly decorate category/channel names with Unicode
// "superscript"/"small caps" modifier-letter glyphs for visual flair
// (e.g. "ⱽᴵᴾ", "ᴴᴰ/ᴿᴬᵂ", "ˢᵘᵖᵉʳ") instead of plain ASCII letters. A plain
// ASCII regex never matches these, so tag-stripping silently no-ops on them.
// This maps the common Latin superscript/modifier-letter ranges back to
// their ASCII base letter — 1:1, so the output is always the same length as
// the input, which lets callers match against the folded text and slice the
// ORIGINAL string by the same offsets.
//
// Two separate tables (rather than one): the "modifier letter" range
// (ᴬᴮᴰ...) is visually uppercase-shaped and the "superscript" range
// (ᵃᵇᶜ...) is visually lowercase-shaped, so folding for *display* should
// preserve that instead of forcing everything to uppercase.
const MODIFIER_UPPER: Record<string, string> = {
  ᴬ: 'A', ᴮ: 'B', ᴰ: 'D', ᴱ: 'E', ᴳ: 'G', ᴴ: 'H', ᴵ: 'I', ᴶ: 'J', ᴷ: 'K', ᴸ: 'L',
  ᴹ: 'M', ᴺ: 'N', ᴼ: 'O', ᴾ: 'P', ᴿ: 'R', ᵀ: 'T', ᵁ: 'U', ⱽ: 'V', ᵂ: 'W',
}
const SUPERSCRIPT_LOWER: Record<string, string> = {
  ᵃ: 'a', ᵇ: 'b', ᶜ: 'c', ᵈ: 'd', ᵉ: 'e', ᶠ: 'f', ᵍ: 'g', ʰ: 'h', ⁱ: 'i', ʲ: 'j',
  ᵏ: 'k', ˡ: 'l', ᵐ: 'm', ⁿ: 'n', ᵒ: 'o', ᵖ: 'p', ʳ: 'r', ˢ: 's', ᵗ: 't', ᵘ: 'u',
  ᵛ: 'v', ʷ: 'w', ˣ: 'x', ʸ: 'y', ᶻ: 'z',
}

// Case-preserving fold, for cleaning up text that's kept and shown to the
// user (e.g. a leftover word we don't strip as a tag, like "super") — turns
// it back into plain, normally-sized readable text instead of tiny glyphs.
export function foldForDisplay(text: string): string {
  return [...text].map((ch) => MODIFIER_UPPER[ch] ?? SUPERSCRIPT_LOWER[ch] ?? ch).join('')
}

// ACCENTED LETTERS, FOLDED TO THEIR ASCII BASE — matching only, never
// display.
//
// This exists because of a real, severe bug. Every consumer that tokenizes
// a folded string does it with /[^A-Z0-9 ]+/ -> ' ', so a letter that
// survives folding but isn't A-Z becomes a WORD BREAK. "København" folded
// to "KØBENHAVN" and then tokenized to ["BENHAVN", "K"] — and a
// single-letter token, matched as a substring, matches almost every channel
// in a playlist. The visible result (2026-08-31, real device): a Danish
// fixture matched ~50 unrelated PPV slots and a pile of Dutch radio
// stations, because every one of their names contains a K and an S. See
// channelMatchCore.ts's significantWords.
//
// STRICTLY ONE CHARACTER TO ONE CHARACTER. foldForMatching's contract is
// that its output is the same length as its input, so callers can slice the
// ORIGINAL string by offsets found in the folded one (parseCategory does
// exactly this). So Æ folds to A rather than AE, and Þ to T rather than TH —
// lossy, but this string is only ever compared, never shown.
const ASCII_FOLD: Record<string, string> = {
  À: 'A', Á: 'A', Â: 'A', Ã: 'A', Ä: 'A', Å: 'A', Æ: 'A',
  Ç: 'C', Ð: 'D',
  È: 'E', É: 'E', Ê: 'E', Ë: 'E',
  Ì: 'I', Í: 'I', Î: 'I', Ï: 'I',
  Ñ: 'N',
  Ò: 'O', Ó: 'O', Ô: 'O', Õ: 'O', Ö: 'O', Ø: 'O',
  Ù: 'U', Ú: 'U', Û: 'U', Ü: 'U',
  Ý: 'Y', Þ: 'T',
  Š: 'S', Ž: 'Z', Č: 'C', Ć: 'C', Đ: 'D', Ł: 'L', Ń: 'N', Ś: 'S', Ź: 'Z', Ż: 'Z',
  Ā: 'A', Ē: 'E', Ī: 'I', Ō: 'O', Ū: 'U',
}

// Uppercased and ASCII-folded, same length as input — safe to slice the
// original by any match length found in this folded version. Used for
// matching only (tag detection, country-prefix detection, team-name
// tokenization), never shown to the user: foldForDisplay is what preserves
// a name's real spelling for the screen.
export function foldForMatching(text: string): string {
  return [...foldForDisplay(text).toUpperCase()].map((ch) => ASCII_FOLD[ch] ?? ch).join('')
}

// Decorative separators/dividers some panels wrap category names in
// (e.g. "##### NORWAY VIP #####") aren't part of the name — strip runs of
// these specific decorative symbols from either edge. Deliberately a
// curated list, not "anything non-alphanumeric": that would also strip the
// fancy Unicode letters this module exists to fold (ⱽᴵᴾ, ᴴᴰ, ...) and real
// accented letters real channel names use (Æ/Ø/Å, etc).
const DECORATIVE_EDGE = /^[\s#=*~•·▪]+|[\s#=*~•·▪]+$/g

export function stripDecorativeEdges(text: string): string {
  return text.replace(DECORATIVE_EDGE, '').trim()
}
