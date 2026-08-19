import { matchLeadingCountry } from '../../data/countryCodes'
import { normalizeCategoryLabel } from '../../data/normalize'
import { foldForMatching } from '../../data/fancyUnicode'

export interface ParsedCategory {
  countryCode: string | null
  countryName: string | null
  label: string // category name with the country prefix stripped, if any
  // `label` with quality/tier tags (VIP/RAW/HD/GOLD/...) stripped — the
  // actual grouping key. Can be "" when the label was nothing but tags
  // (e.g. "NORWAY VIP" → country "Norway", label "VIP", mergedLabel "") —
  // that's the category folding into the country's general bucket, not a
  // bug. PPV is never stripped, so a "... PPV" category always keeps its
  // own non-empty mergedLabel and stays separate.
  mergedLabel: string
  raw: string
}

// Real playlists reuse the same raw groupTitle across hundreds/thousands of
// channels (one category, many channels in it) — memoized by the raw string
// so a ~30k-channel playlist only ever pays for the (regex-heavy)
// matchLeadingCountry/normalizeCategoryLabel work once per DISTINCT category
// string, not once per channel. Pure function, so this is 100%
// behavior-preserving. Capped and cleared wholesale on overflow rather than
// evicted piecemeal — same discipline as channelMatchCore.ts's memoize()
// helper (not reused directly here to avoid a features/channels ->
// data/sports dependency in the wrong direction).
const CACHE_LIMIT = 200_000
const cache = new Map<string, ParsedCategory>()

function computeParseCategory(raw: string): ParsedCategory {
  const match = matchLeadingCountry(raw)
  if (match) {
    return {
      countryCode: match.code,
      countryName: match.countryName,
      label: match.rest,
      mergedLabel: normalizeCategoryLabel(match.rest),
      raw,
    }
  }
  return { countryCode: null, countryName: null, label: raw, mergedLabel: normalizeCategoryLabel(raw), raw }
}

export function parseCategory(raw: string): ParsedCategory {
  const cached = cache.get(raw)
  if (cached) return cached
  if (cache.size >= CACHE_LIMIT) cache.clear()
  const result = computeParseCategory(raw)
  cache.set(raw, result)
  return result
}

// PPV (pay-per-view) is never stripped by normalizeCategoryLabel, so it's
// always still present in mergedLabel when the category is a PPV one —
// this just checks for that word (fancy-Unicode-safe).
export function isPpvCategory(parsed: ParsedCategory): boolean {
  return /\bPPV\b/.test(foldForMatching(parsed.mergedLabel))
}
