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

// Uppercased, same length as input — safe to slice the original by any
// match length found in this folded version. Used for matching only (tag
// detection, country-prefix detection), never shown to the user.
export function foldForMatching(text: string): string {
  return foldForDisplay(text).toUpperCase()
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
