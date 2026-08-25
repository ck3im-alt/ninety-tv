// Which preferred countries onboarding's step 3 offers BEFORE the user asks
// to see the full list. Pure; the caller supplies whatever countries the
// connected playlist actually contains (via data/viewerCountry.ts's
// playlistCountries, which itself reuses parseCategory — no second
// country-detection heuristic anywhere).
//
// The recommendation is: the detected home country, up to two neighbouring
// markets, the United Kingdom, and the United States — de-duplicated, and
// capped at MAX_PREFERRED_COUNTRIES so the default view lines up exactly
// with the existing five-country selection limit.
import { COUNTRY_NAMES } from '../../data/countryCodes'
import { MAX_PREFERRED_COUNTRIES } from '../../data/preferences'
import type { PlaylistCountry } from '../../data/viewerCountry'

// Neighbouring TV markets, hand-curated for the countries Ninety actually
// recognizes (countryCodes.ts's COUNTRY_NAMES) rather than fetched from a
// geocoding service — this needs to be deterministic, offline, and tiny.
//
// "Neighbour" here means a genuinely adjacent or same-region market whose
// channels a viewer plausibly wants ranked alongside their own, capped at
// two so the recommendation stays five entries after UK/US are appended.
// Countries with only one honest neighbour in this vocabulary get one;
// countries with none (South Africa, Kurdish) get an empty list and fall
// through to the playlist backfill below rather than being paired with
// something geographically unrelated to pad the row out.
const NEIGHBOR_CODES: Record<string, readonly string[]> = {
  // Nordics
  NO: ['SE', 'DK'],
  SE: ['NO', 'DK'],
  DK: ['SE', 'DE'],
  FI: ['SE', 'NO'],
  // Iceland has no land border at all; its two closest Nordic markets are
  // the honest answer rather than pretending to adjacency.
  IS: ['NO', 'DK'],
  // British Isles
  UK: ['IE', 'FR'],
  GB: ['IE', 'FR'],
  IE: ['GB', 'FR'],
  // Western/Central Europe
  DE: ['AT', 'NL'],
  AT: ['DE', 'CH'],
  CH: ['DE', 'FR'],
  FR: ['BE', 'ES'],
  ES: ['PT', 'FR'],
  PT: ['ES', 'FR'],
  IT: ['CH', 'FR'],
  NL: ['BE', 'DE'],
  BE: ['NL', 'FR'],
  // Central/Eastern Europe
  PL: ['DE', 'CZ'],
  CZ: ['SK', 'DE'],
  SK: ['CZ', 'HU'],
  HU: ['AT', 'RO'],
  RO: ['HU', 'BG'],
  BG: ['RO', 'GR'],
  GR: ['BG', 'TR'],
  TR: ['GR', 'BG'],
  RU: ['UA', 'FI'],
  UA: ['PL', 'RO'],
  // Balkans
  HR: ['SI', 'RS'],
  RS: ['HR', 'BA'],
  BA: ['HR', 'RS'],
  SI: ['HR', 'AT'],
  AL: ['MK', 'GR'],
  MK: ['AL', 'RS'],
  // Americas
  US: ['CA', 'MX'],
  // Canada borders only the United States — listing Mexico too would be
  // calling a non-neighbour a neighbour.
  CA: ['US'],
  MX: ['US'],
  BR: ['AR'],
  AR: ['BR'],
  // Rest of world
  IN: ['PK'],
  PK: ['IN'],
  AU: ['NZ'],
  NZ: ['AU'],
  SA: ['AE'],
  AE: ['SA'],
}

export function getNeighborCountryCodes(code: string | null | undefined): string[] {
  if (!code) return []
  return [...(NEIGHBOR_CODES[code.toUpperCase()] ?? [])]
}

// Always-appended global markets: the two English-language markets whose
// sports coverage is relevant essentially everywhere Ninety is used.
const GLOBAL_FALLBACK_CODES = ['GB', 'US'] as const

export interface RecommendedCountry {
  name: string
  code: string | null
  // Channels in the connected playlist, or 0 when this country is being
  // offered without a playlist to count against (step 1 skipped).
  count: number
}

interface BuildOptions {
  // Canonical ISO2-ish code from data/viewerCountry.ts, or null when
  // nothing could be detected.
  homeCountryCode: string | null
  // Countries present in the connected playlist, biggest first. Empty when
  // step 1 was skipped.
  available: readonly PlaylistCountry[]
  limit?: number
}

// Home + up to two neighbours + UK + US, then (when a playlist is
// connected) filtered to what that playlist actually carries and topped up
// from its biggest remaining countries.
//
// De-duplication is by DISPLAY NAME, not code, which is what makes the
// UK/GB alias pair collapse into a single "United Kingdom" card: both codes
// map to the same name in countryCodes.ts, and playlists really do use both
// prefixes.
export function buildRecommendedCountries({
  homeCountryCode,
  available,
  limit = MAX_PREFERRED_COUNTRIES,
}: BuildOptions): RecommendedCountry[] {
  const wishCodes = [...(homeCountryCode ? [homeCountryCode] : []), ...getNeighborCountryCodes(homeCountryCode), ...GLOBAL_FALLBACK_CODES]

  // Playlist entries keyed by display name so a wished-for code resolves to
  // the user's REAL card (with its real channel count and the code
  // parseCategory actually saw) rather than a synthetic one.
  const availableByName = new Map<string, PlaylistCountry>()
  for (const entry of available) {
    if (!availableByName.has(entry.name)) availableByName.set(entry.name, entry)
  }

  const takenNames = new Set<string>()
  const result: RecommendedCountry[] = []
  const add = (candidate: RecommendedCountry | undefined) => {
    if (!candidate || takenNames.has(candidate.name) || result.length >= limit) return
    takenNames.add(candidate.name)
    result.push(candidate)
  }

  for (const code of wishCodes) {
    const name = COUNTRY_NAMES[code.toUpperCase()]
    // A code Ninety has no display name for can't be rendered as a card
    // (no name, no flag) — skipped rather than shown as a blank.
    if (!name) continue
    const inPlaylist = availableByName.get(name)
    if (available.length > 0 && !inPlaylist) continue // wished for, but this playlist doesn't carry it
    add(inPlaylist ?? { name, code: code.toUpperCase(), count: 0 })
  }

  // Backfill: whichever of the desired five the playlist couldn't supply is
  // replaced by its biggest remaining countries, so the default view is
  // always a usable five rather than a short row.
  for (const entry of available) {
    if (result.length >= limit) break
    add(entry)
  }

  return result
}

// The single country to pre-select as PRIMARY (favoriteCountries[0]) when
// the Countries step first opens.
//
// Only ONE country is ever asserted on the user's behalf: neighbours, the
// UK and the US are suggestions to consider, not preferences they expressed
// — pre-ticking all five would silently invent a ranked market list nobody
// chose. Prefers the detected home country when the playlist can actually
// serve it, and otherwise falls back to the playlist's dominant country
// (the pre-existing behaviour, narrowed from three pre-selections to one).
export function pickInitialPrimaryCountry(
  homeCountryCode: string | null,
  available: readonly PlaylistCountry[],
): string | null {
  const homeName = homeCountryCode ? COUNTRY_NAMES[homeCountryCode.toUpperCase()] : undefined
  if (homeName && (available.length === 0 || available.some((c) => c.name === homeName))) return homeName
  return available[0]?.name ?? null
}
