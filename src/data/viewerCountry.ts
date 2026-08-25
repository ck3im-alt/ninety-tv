// COUNTRY-level personalization signal for the TV in front of the user —
// deliberately not a location signal. Onboarding uses it to pick which
// domestic league and which preferred countries to recommend first; nothing
// downstream needs (or gets) anything finer-grained than a two-letter
// country code.
//
// Explicitly NOT used/requested: GPS, the Geolocation API, or any
// permission prompt. config.xml declares no location privilege and this
// module never asks for one — the whole point is that country-level
// personalization is achievable from signals the device already exposes to
// an ordinary web app.
//
// Also deliberately distinct from the three other country-shaped concepts
// already in the codebase (see viewerMarket.ts's header for the full list):
// this is "which country is this TV physically set up in", not "which
// broadcast markets does the user prefer" (SportPreferences
// .favoriteCountries) and not "which country does this competition belong
// to" (LeagueDef.countryCode).
//
// Everything here is pure and signal-injected. The platform probing that
// actually reads Tizen/browser values lives in core/platform/deviceRegion.ts
// and data/useViewerCountry.ts, so this file stays testable without any
// device, and without a physical Samsung TV.
import { parseCategory } from '../features/channels/parseCategory'
import { normalizeToViewerMarket } from './sports/viewerMarket'
import type { Channel } from './channel'

export type ViewerCountrySource = 'tizen-region' | 'locale' | 'playlist' | 'unknown'

export interface ViewerCountry {
  // Canonical uppercase ISO-3166-1 alpha-2-ish code ('NO', 'GB', 'US'), or
  // null when no signal resolved to one. Canonicalized through
  // viewerMarket.ts's own alias table, so a locale that says "UK" arrives
  // here as "GB" — the same form ninety-api's competition registry uses for
  // LeagueConfig.countryCode.
  code: string | null
  source: ViewerCountrySource
}

export const UNKNOWN_VIEWER_COUNTRY: ViewerCountry = { code: null, source: 'unknown' }

export interface ViewerCountrySignals {
  // Raw, unparsed value from Tizen's SystemInfoLocale (e.g. 'eng_US') —
  // parsing lives here rather than in the platform adapter so the adapter
  // stays a thin, guarded read and every parsing rule is covered by this
  // module's own tests. See regionFromTizenLocale.
  tizenLocale?: string | null
  // BCP-47 tags, most-preferred first (navigator.languages, falling back to
  // [navigator.language]).
  localeTags?: readonly string[]
  // Dominant country in the connected playlist, if one is connected — see
  // dominantPlaylistCountry below.
  playlistCountryCode?: string | null
}

// Region subtags are always exactly two ASCII letters for a country (the
// three-digit UN M.49 form — 'es-419' — is a macro-region, not a country,
// and is correctly rejected here rather than mangled into something that
// looks like a code).
function asCountryCode(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!/^[A-Za-z]{2}$/.test(trimmed)) return null
  // Reuses viewerMarket.ts's canonicalization (currently UK -> GB) rather
  // than maintaining a second alias table that could drift from it.
  return normalizeToViewerMarket(trimmed)
}

// A BCP-47 tag's region subtag, or null when the tag carries no usable one.
//
// A bare language ('en') deliberately resolves to null: English is not
// evidence of Great Britain any more than of the United States, and
// guessing here would send a US viewer Premier League + "United Kingdom"
// recommendations on no evidence at all. Only an explicit region subtag
// counts.
export function regionFromLocaleTag(tag: string): string | null {
  if (!tag) return null
  // Underscores appear in POSIX-style locale strings ('nb_NO'); the '.'
  // suffix ('en_US.UTF-8') is a charset, never part of the tag itself.
  const parts = tag.split('.')[0].split(/[-_]/).filter(Boolean)
  if (parts.length < 2) return null
  // Scan from the end so a script subtag in the middle ('zh-Hans-CN')
  // doesn't hide the region behind it. Skips parts[0] — that's the
  // language, and a two-letter language must never be read as a region.
  for (let i = parts.length - 1; i >= 1; i--) {
    const code = asCountryCode(parts[i])
    if (code) return code
  }
  return null
}

// Tizen's SystemInfoLocale exposes `country`/`language` in a
// '(LANGUAGE)_(REGION)' shape ('eng_US'), not as a bare country code — so
// the same "a separator must be present" rule as regionFromLocaleTag
// applies: a value with no separator is a language, not a country.
export function regionFromTizenLocale(raw: string | null | undefined): string | null {
  if (!raw) return null
  return regionFromLocaleTag(raw)
}

export interface PlaylistCountry {
  code: string
  name: string
  count: number
}

// Every country present in the connected playlist's category names, biggest
// first. Uses the same parseCategory the Channels browser and the Countries
// onboarding step already use — no second country-detection heuristic.
export function playlistCountries(channels: readonly Channel[]): PlaylistCountry[] {
  const counts = new Map<string, { code: string | null; count: number }>()
  for (const channel of channels) {
    const { countryName, countryCode } = parseCategory(channel.groupTitle || '')
    if (!countryName) continue
    const existing = counts.get(countryName)
    counts.set(countryName, { code: countryCode ?? existing?.code ?? null, count: (existing?.count ?? 0) + 1 })
  }
  return [...counts.entries()]
    .filter((entry): entry is [string, { code: string; count: number }] => entry[1].code != null)
    .map(([name, { code, count }]) => ({ name, code, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export function dominantPlaylistCountry(channels: readonly Channel[]): PlaylistCountry | null {
  return playlistCountries(channels)[0] ?? null
}

// The graceful hierarchy, in the order the onboarding spec calls for:
//   1. the TV's own system region (most authoritative — it's what the
//      device was actually set up as)
//   2. an explicit region subtag in the TV/browser locale (lower
//      confidence: a Norwegian household can run an English-language TV,
//      but 'nb-NO'/'en-GB' still carries a real region)
//   3. the dominant country in the connected playlist (only meaningful
//      once step 1 has actually loaded channels)
//   4. nothing — onboarding shows its generic recommendations and carries
//      on. Detection failing is never allowed to block or error.
export function resolveViewerCountry(signals: ViewerCountrySignals): ViewerCountry {
  const tizen = regionFromTizenLocale(signals.tizenLocale)
  if (tizen) return { code: tizen, source: 'tizen-region' }

  for (const tag of signals.localeTags ?? []) {
    const region = regionFromLocaleTag(tag)
    if (region) return { code: region, source: 'locale' }
  }

  const playlist = asCountryCode(signals.playlistCountryCode)
  if (playlist) return { code: playlist, source: 'playlist' }

  return UNKNOWN_VIEWER_COUNTRY
}
