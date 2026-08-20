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
//
// Phase 2C (2026-08-20): this module used to hard-reject any country code
// ninety-api didn't have EPG coverage for yet (a fixed
// SUPPORTED_VIEWER_MARKETS allowlist), which meant adding a backend market
// (e.g. Spain) required a ninety-tv release just to stop silently dropping
// it. Removed entirely: this module's only job now is recognizing a
// COUNTRY (via countryCodes.ts's name table, or a bare ISO2-shaped code
// defensively) and converting it to a canonical code -- it does not know
// or care which markets the backend currently has broadcast data for.
// ninety-api's country filter already narrows broadcasts rather than
// removing events (see routes/eventsQuery.ts) specifically so it's safe to
// pass a market with zero current coverage: the event still comes back,
// just with an empty/other-market broadcasts[] for that code. Genuinely
// unrecognized garbage (not a real country name, not a 2-letter code)
// still safely resolves to null rather than being passed through.
import { countryNameToCode } from '../countryCodes'

// A canonical uppercase ISO2-ish viewer-market code (e.g. 'NO', 'ES',
// 'GB') -- deliberately just `string`, not a fixed union, since this
// module no longer maintains its own list of which codes are "real".
export type ViewerMarket = string

// countryCodes.ts's COUNTRY_NAMES/NAME_TO_CODE resolves "United Kingdom" to
// the non-ISO "UK" (declared before "GB" for the same name, kept there for
// IPTV-category-prefix matching where playlists really do use both), but
// ninety-api's logical_channels.country_code (and every other real-world
// consumer of this code) uses "GB". Same alias fix already applies for its
// own reasons -- applied again here so a market code always matches what
// the backend actually stores.
const MARKET_CODE_ALIASES: Record<string, string> = { UK: 'GB' }

function canonicalizeMarketCode(code: string): string {
  const upper = code.toUpperCase()
  return MARKET_CODE_ALIASES[upper] ?? upper
}

// Normalizes one free-text value (almost always a favoriteCountries display
// name like "Norway", but a bare 2-letter code is accepted defensively too)
// to a canonical market code -- or null when it doesn't resolve to a
// recognized country at all. Does NOT check backend EPG coverage (see this
// module's header comment) -- a country Ninety has no broadcasts for yet
// (e.g. "Spain" before Phase 2C, or any future gap) still resolves to its
// real code here; ninety-api's country filter is what actually narrows
// broadcasts, and it degrades gracefully to an empty list rather than
// erroring on an uncovered market.
export function normalizeToViewerMarket(raw: string): ViewerMarket | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    return canonicalizeMarketCode(trimmed)
  }
  const resolved = countryNameToCode(trimmed)
  if (!resolved) return null
  return canonicalizeMarketCode(resolved)
}

// The user's ranked list of preferred viewer markets, derived fresh from
// favoriteCountries every time it's needed (never persisted as its own
// preference). Order is preserved -- the first favorite is the
// highest-ranked market, feeding rankStreamQuality/buildEventStreamOptions'
// existing preferred-market ranking tier -- and unrecognized entries are
// silently dropped rather than erroring, so garbage input never affects
// ranking or breaks preference loading. Duplicates (e.g. "United Kingdom"
// and "UK" both present) collapse to one entry.
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
