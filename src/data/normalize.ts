import { matchLeadingCountry } from './countryCodes'
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
// "HEVC"/"H264"/"H265" are codec/resolution technical suffixes, not brand
// words, so they're low-risk additions beyond the user's explicit list.
export const QUALITY_TAGS = [
  'ULTRA RAW GOLD',
  'GOLD RAW',
  'RAW HD',
  'ULTRA HD',
  'FHD',
  'UHD',
  '4K',
  'RAW',
  'VIP',
  'HEVC',
  'H265',
  'H264',
  'SD',
  'HD',
]

const EDGE_SEPARATOR = '[\\s:|\\-_/]*'

// Matches against a fancy-Unicode-folded copy (see fancyUnicode.ts) so tags
// written with "aesthetic" superscript/small-caps glyphs (ⱽᴵᴾ, ᴴᴰ, ᴿᴬᵂ — very
// common in real IPTV category names) are recognized the same as plain
// ASCII ones, then slices the ORIGINAL text by the same offsets.
function stripEdgeTags(input: string, tags: string[]): string {
  let text = stripDecorativeEdges(input)
  let changed = true
  while (changed) {
    changed = false
    const folded = foldForMatching(text)
    for (const tag of tags) {
      const leadingMatch = folded.match(new RegExp(`^${tag}\\b${EDGE_SEPARATOR}`))
      if (leadingMatch) {
        text = stripDecorativeEdges(text.slice(leadingMatch[0].length))
        changed = true
        break
      }
      const trailingMatch = folded.match(new RegExp(`${EDGE_SEPARATOR}\\b${tag}$`))
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
  for (const tag of QUALITY_TAGS) {
    if (new RegExp(`${EDGE_SEPARATOR}\\b${tag}$`).test(folded)) return tag
    if (new RegExp(`^${tag}\\b${EDGE_SEPARATOR}`).test(folded)) return tag
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
  return foldForDisplay(stripEdgeTags(label, QUALITY_TAGS))
}

export interface NormalizedChannelName {
  canonicalName: string
  qualityTag: string | null
}

export function normalizeChannelName(rawName: string): NormalizedChannelName {
  const cleaned = stripDecorativeEdges(rawName.trim())
  const countryMatch = matchLeadingCountry(cleaned)
  const withoutCountry = countryMatch ? countryMatch.rest : cleaned
  const qualityTag = extractQualityTag(withoutCountry)
  const canonicalName = stripEdgeTags(withoutCountry, QUALITY_TAGS)
  // A channel always needs a name, so this fallback (unlike the category
  // one above) is load-bearing: falls back to the pre-tag-stripped name if
  // stripping happened to consume everything.
  return { canonicalName: foldForDisplay(canonicalName || withoutCountry || rawName.trim()), qualityTag }
}
