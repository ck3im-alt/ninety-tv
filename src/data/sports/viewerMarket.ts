// Canonical "viewer market" concept (Phase 2B): which country's
// broadcasters/EPG Ninety should prefer when resolving an event to
// channels for THIS user. This is deliberately distinct from three other
// country-shaped concepts already in the codebase, which must not be
// conflated with it:
//   - an event's own competition/venue country (e.g. La Liga is Spanish
//     regardless of who's watching)
//   - SportPreferences.favoriteCountries -- a broader, free-text,
//     playlist-derived multi-select UI preference (display names like
//     "Norway", not codes; see preferences.ts). A viewer market is DERIVED
//     from it, not a replacement for it.
//   - a user's nationality or interface language (neither exists as a
//     concept in this codebase, and this module doesn't introduce one)
//
// Normalization happens at this boundary only -- favoriteCountries itself
// is never migrated or rewritten to store codes (see the Phase 2B task
// spec's explicit "do not unnecessarily migrate user data if normalization
// at the boundary is enough").
import { countryNameToCode } from '../countryCodes'

// The EPG markets ninety-api currently has real broadcast data for.
// Ground truth verified live against production (DISTINCT country_code
// FROM logical_channels, 2026-08-20) rather than assumed from docs/memory
// -- keep this in sync if a market is added or removed backend-side.
export const SUPPORTED_VIEWER_MARKETS = ['NO', 'SE', 'DK', 'GB', 'FR', 'TR', 'DE', 'PT'] as const

export type ViewerMarket = (typeof SUPPORTED_VIEWER_MARKETS)[number]

const SUPPORTED_SET = new Set<string>(SUPPORTED_VIEWER_MARKETS)

export function isSupportedViewerMarket(code: string): code is ViewerMarket {
  return SUPPORTED_SET.has(code.toUpperCase())
}

// countryCodes.ts's COUNTRY_NAMES/NAME_TO_CODE resolves "United Kingdom" to
// the non-ISO "UK" (declared before "GB" for the same name, kept there for
// IPTV-category-prefix matching where playlists really do use both), but
// Ninety's own EPG market ground truth is "GB" (logical_channels.country_code
// in production). Same alias flagSrc already applies for its own reasons --
// applied again here so a market code always matches what the backend
// actually stores.
const MARKET_CODE_ALIASES: Record<string, string> = { UK: 'GB' }

function canonicalizeMarketCode(code: string): string {
  const upper = code.toUpperCase()
  return MARKET_CODE_ALIASES[upper] ?? upper
}

// Normalizes one free-text value (almost always a favoriteCountries display
// name like "Norway", but a bare 2-letter code is accepted defensively too)
// to a canonical market code -- or null when it doesn't resolve to one of
// Ninety's currently-EPG-covered markets. A favorite country with no EPG
// coverage (e.g. "Spain") is expected to hit this null path and must never
// throw or otherwise break the caller -- see deriveViewerMarkets.
export function normalizeToViewerMarket(raw: string): ViewerMarket | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const code = canonicalizeMarketCode(trimmed)
    if (isSupportedViewerMarket(code)) return code as ViewerMarket
  }
  const resolved = countryNameToCode(trimmed)
  if (!resolved) return null
  const code = canonicalizeMarketCode(resolved)
  return isSupportedViewerMarket(code) ? (code as ViewerMarket) : null
}

// The user's ranked list of preferred viewer markets, derived fresh from
// favoriteCountries every time it's needed (never persisted as its own
// preference). Order is preserved -- the first favorite is the
// highest-ranked market, feeding rankStreamQuality/buildEventStreamOptions'
// existing preferred-market ranking tier -- and unsupported entries are
// silently dropped rather than erroring, so an unrelated favorite (e.g.
// "Spain") never affects ranking or breaks preference loading. Duplicates
// (e.g. "United Kingdom" and "UK" both present) collapse to one entry.
export function deriveViewerMarkets(favoriteCountries: readonly string[]): ViewerMarket[] {
  const seen = new Set<ViewerMarket>()
  const result: ViewerMarket[] = []
  for (const name of favoriteCountries) {
    const market = normalizeToViewerMarket(name)
    if (market && !seen.has(market)) {
      seen.add(market)
      result.push(market)
    }
  }
  return result
}
