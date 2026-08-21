import { matchLeadingCountry, matchTrailingCountry } from './countryCodes'
import { foldForDisplay, foldForMatching, stripDecorativeEdges } from './fancyUnicode'

// IPTV category/channel names carry a quality/tier suffix (or prefix) that
// isn't a real distinguishing category — the same channel is listed once per
// source quality. Longest/multi-word tags first so e.g. "ULTRA RAW GOLD"
// matches whole before its component words would. "PPV" is deliberately
// NOT in this list — it's a genuine distinct category (pay-per-view), not a
// quality tier, so it's never stripped/merged away.
//
// Kept deliberately narrow: standalone "GOLD" and "PREMIUM" were tried and
// dropped — they collide with real channel branding ("TV 2 Sport Premium",
// "ITV Gold"), so only the exact combos the user identified ("GOLD RAW",
// "ULTRA RAW GOLD") are stripped, never bare "GOLD"/"PREMIUM". "4K"/"SD"/
// "HEVC"/"H264"/"H265"/"H.264"/"H.265"/"50FPS"/"60FPS" are codec/resolution/
// framerate technical suffixes, not brand words, so they're low-risk
// additions beyond the user's explicit list. The dotted H.26x forms are
// separate entries (not just punctuation the separator strips) because the
// dot sits INSIDE the tag itself, between the two characters real playlists
// write it with either way — M3U-corpus validation (2026-08-20) found both
// spellings in real use.
export const QUALITY_TAGS = [
  'ULTRA RAW GOLD',
  'GOLD RAW',
  'RAW HD',
  'ULTRA HD',
  'FULL HD',
  'FHD',
  'UHD',
  '4K',
  'RAW',
  'VIP',
  'HEVC',
  'H.265',
  'H.264',
  'H265',
  'H264',
  '50FPS',
  '60FPS',
  'SD',
  'HD',
]

// Escapes regex metacharacters in a literal tag string before it's spliced
// into a constructed RegExp — QUALITY_TAGS entries are plain data, but
// "H.265" contains a "." which means "any character" if inserted raw
// (silently also matching "HX265"). Every character escaped here is inert
// in the tag vocabulary actually used (letters/digits/spaces/dot), so this
// is a pure correctness fix, not a behavior change for any tag without a
// dot.
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Separator characters real playlists use around a quality tag — a plain
// space/colon/pipe/hyphen/underscore/slash run, or the tag wrapped in
// brackets/parens ("[HD]", "(UHD)"). `*` (zero-or-more) throughout: a tag
// glued directly onto the name with no separator at all is still expected
// to be found via the not-alnum boundary checks below, same as before.
const EDGE_SEPARATOR = '[\\s:|\\-_/[\\]()]*'

// Precompiled once at module init rather than per-call/per-loop-iteration —
// stripEdgeTags/extractQualityTag used to construct up to ~2 fresh RegExp
// objects per tag on every single call (dozens of allocations per channel
// name/category label), which dominated ingestion cost at ~30k-channel
// playlist scale. Same tags, same order (QUALITY_TAGS is already
// longest-match-first), same leading/trailing pattern shape as before — this
// is purely a "when is the RegExp built" change, not a behavior change.
//
// `(?![A-Z0-9])`/`(?<![A-Z0-9])` rather than `\b` for the boundary right
// next to the tag: `\b` treats "_" as a word character, so it never fires
// between a tag and an immediately-adjacent "_" separator ("ESPN_HD") —
// same underscore blind spot fixed in countryCodes.ts's leading/trailing
// matchers, for the identical reason. A plain not-alnum lookaround has no
// such gap and still rejects a real substring collision the same way `\b`
// did (e.g. "HD" must not match inside "HDTV" — "T" right after is alnum,
// so the lookahead still correctly fails there). The extra trailing/leading
// EDGE_SEPARATOR on the "outside" of the boundary check (before the tag in
// the leading pattern isn't needed since `^` already anchors it, but after
// the tag in trailing and before `$`) absorbs a closing bracket/paren that
// wrapped the tag itself, e.g. "ESPN [HD]" — without it, the pattern would
// need the tag to sit immediately before end-of-string, which "]" prevents.
const QUALITY_TAG_PATTERNS = QUALITY_TAGS.map((tag) => {
  const escaped = escapeRegExp(tag)
  return {
    tag,
    leading: new RegExp(`^${EDGE_SEPARATOR}${escaped}(?![A-Z0-9])${EDGE_SEPARATOR}`),
    trailing: new RegExp(`${EDGE_SEPARATOR}(?<![A-Z0-9])${escaped}${EDGE_SEPARATOR}$`),
  }
})

// Matches against a fancy-Unicode-folded copy (see fancyUnicode.ts) so tags
// written with "aesthetic" superscript/small-caps glyphs (ⱽᴵᴾ, ᴴᴰ, ᴿᴬᵂ — very
// common in real IPTV category names) are recognized the same as plain
// ASCII ones, then slices the ORIGINAL text by the same offsets.
function stripEdgeTags(input: string, patterns: typeof QUALITY_TAG_PATTERNS): string {
  let text = stripDecorativeEdges(input)
  let changed = true
  while (changed) {
    changed = false
    const folded = foldForMatching(text)
    for (const { leading, trailing } of patterns) {
      const leadingMatch = folded.match(leading)
      if (leadingMatch) {
        text = stripDecorativeEdges(text.slice(leadingMatch[0].length))
        changed = true
        break
      }
      const trailingMatch = folded.match(trailing)
      if (trailingMatch) {
        text = stripDecorativeEdges(text.slice(0, text.length - trailingMatch[0].length))
        changed = true
        break
      }
    }
  }
  return text
}

// The quality tag actually driving this variant, if any — used as the
// human-readable label for the source picker (e.g. "RAW", "UHD").
export function extractQualityTag(input: string): string | null {
  const folded = foldForMatching(stripDecorativeEdges(input))
  for (const { tag, leading, trailing } of QUALITY_TAG_PATTERNS) {
    if (trailing.test(folded)) return tag
    if (leading.test(folded)) return tag
  }
  return null
}

// No `|| label` fallback here: a category whose entire label is quality
// tags (e.g. raw "NORWAY VIP" once the country prefix is parsed off,
// leaving just "VIP") should genuinely reduce to "" — that's the category
// merging into the country's general bucket, not a bug to paper over.
//
// foldForDisplay as a final pass handles words that AREN'T in QUALITY_TAGS
// (so never get stripped) but are still written in fancy Unicode — e.g.
// "ˢᵘᵖᵉʳ" in "VIAPLAY PPV super". Nothing shown to the user should still be
// in tiny modifier-letter glyphs even when we don't treat it as a tag.
export function normalizeCategoryLabel(label: string): string {
  return foldForDisplay(stripEdgeTags(label, QUALITY_TAG_PATTERNS))
}

export interface NormalizedChannelName {
  canonicalName: string
  qualityTag: string | null
}

// Real channel NAMES (as opposed to category/group-title labels, which only
// ever carry a LEADING country per matchLeadingCountry) commonly carry the
// country marker at either end, and a trailing marker can land on either
// side of the quality tag ("TNT SPORTS 1 UK HD" — country before the tag;
// "TELEFE HD ARG" — country after it). A single one-shot check in either
// order misses one of those two shapes, since stripping the tag first
// leaves the country exposed and vice versa. This loops, alternating
// quality-tag stripping (leading or trailing, reusing the exact patterns
// normalizeCategoryLabel already trusts) and trailing-country stripping,
// until neither matches — order-independent by construction. The returned
// qualityTag is whichever tag is found FIRST (still checked in
// longest-combo-first QUALITY_TAG_PATTERNS order within each pass), same
// "the tag actually driving this variant" meaning extractQualityTag always
// had.
function stripTrailingNoise(input: string): { text: string; qualityTag: string | null } {
  let text = input
  let qualityTag: string | null = null
  let changed = true
  while (changed) {
    changed = false
    const folded = foldForMatching(stripDecorativeEdges(text))
    for (const { tag, leading, trailing } of QUALITY_TAG_PATTERNS) {
      const leadingMatch = folded.match(leading)
      if (leadingMatch) {
        text = stripDecorativeEdges(text.slice(leadingMatch[0].length))
        if (qualityTag === null) qualityTag = tag
        changed = true
        break
      }
      const trailingMatch = folded.match(trailing)
      if (trailingMatch) {
        text = stripDecorativeEdges(text.slice(0, text.length - trailingMatch[0].length))
        if (qualityTag === null) qualityTag = tag
        changed = true
        break
      }
    }
    if (changed) continue

    const trailingCountry = matchTrailingCountry(text)
    if (trailingCountry) {
      text = trailingCountry.rest
      changed = true
    }
  }
  return { text, qualityTag }
}

export function normalizeChannelName(rawName: string): NormalizedChannelName {
  const cleaned = stripDecorativeEdges(rawName.trim())
  const countryMatch = matchLeadingCountry(cleaned)
  const withoutCountry = countryMatch ? countryMatch.rest : cleaned
  const { text: canonicalName, qualityTag } = stripTrailingNoise(withoutCountry)
  // A channel always needs a name, so this fallback (unlike the category
  // one above) is load-bearing: falls back to the pre-tag-stripped name if
  // stripping happened to consume everything.
  return { canonicalName: foldForDisplay(canonicalName || withoutCountry || rawName.trim()), qualityTag }
}
