// Common IPTV/Xtream category-prefix country codes. Not exhaustive ISO
// 3166-1 — only codes actually seen prefixing IPTV category names, so an
// unrecognized prefix falls back to "no country detected" honestly instead
// of guessing.
export const COUNTRY_NAMES: Record<string, string> = {
  NO: 'Norway',
  SE: 'Sweden',
  DK: 'Denmark',
  FI: 'Finland',
  IS: 'Iceland',
  UK: 'United Kingdom',
  GB: 'United Kingdom',
  IE: 'Ireland',
  DE: 'Germany',
  AT: 'Austria',
  CH: 'Switzerland',
  FR: 'France',
  ES: 'Spain',
  PT: 'Portugal',
  IT: 'Italy',
  NL: 'Netherlands',
  BE: 'Belgium',
  PL: 'Poland',
  CZ: 'Czech Republic',
  SK: 'Slovakia',
  HU: 'Hungary',
  RO: 'Romania',
  BG: 'Bulgaria',
  GR: 'Greece',
  TR: 'Turkey',
  RU: 'Russia',
  UA: 'Ukraine',
  HR: 'Croatia',
  RS: 'Serbia',
  // "SR" isn't the ISO code for Serbia (that's RS) — it's what this
  // particular panel's category names actually use ("SR| SERBIA ...",
  // confirmed against real category data). Kept as a second key mapping to
  // the same name, same pattern as UK/GB below for United Kingdom.
  SR: 'Serbia',
  BA: 'Bosnia and Herzegovina',
  // Same story as SR/RS above: this panel's real category names use "BH"
  // ("BH| BOSNIA ..."), not the ISO code BA.
  BH: 'Bosnia and Herzegovina',
  // Not a sovereign state / no ISO 3166-1 code, but a real, distinct
  // grouping this panel's categories use ("KU| KURDISH ...") — recognizing
  // it beats dumping it in "other" alongside everything genuinely
  // unrecognized.
  KU: 'Kurdish',
  SI: 'Slovenia',
  AL: 'Albania',
  MK: 'North Macedonia',
  US: 'United States',
  CA: 'Canada',
  MX: 'Mexico',
  BR: 'Brazil',
  AR: 'Argentina',
  IN: 'India',
  PK: 'Pakistan',
  AU: 'Australia',
  NZ: 'New Zealand',
  ZA: 'South Africa',
  SA: 'Saudi Arabia',
  AE: 'United Arab Emirates',
}

import { foldForMatching, stripDecorativeEdges } from './fancyUnicode'

const SEPARATOR = '[\\s:|\\-_/]+'

// Sorted longest-first: multi-word names ("United Kingdom") must be tried
// before any single-word name that could otherwise shadow part of them.
const CODE_ENTRIES = Object.keys(COUNTRY_NAMES).sort((a, b) => b.length - a.length)
const NAME_TO_CODE = new Map<string, string>()
for (const [code, name] of Object.entries(COUNTRY_NAMES)) {
  const upper = name.toUpperCase()
  if (!NAME_TO_CODE.has(upper)) NAME_TO_CODE.set(upper, code) // first code wins (e.g. GB over UK for "United Kingdom")
}
const NAME_ENTRIES = [...NAME_TO_CODE.keys()].sort((a, b) => b.length - a.length)

// Precompiled once at module init — matchLeadingCountry used to construct a
// fresh RegExp per name/code on every single call (up to ~90 allocations in
// the worst case, for a playlist with tens of thousands of channel/category
// strings to match against). Same entries, same longest-match-first order,
// same pattern shape as before — purely a "when is the RegExp built" change.
const NAME_PATTERNS = NAME_ENTRIES.map((name) => ({ name, re: new RegExp(`^${name}\\b${SEPARATOR}?`) }))
const CODE_PATTERNS = CODE_ENTRIES.map((code) => ({ code, re: new RegExp(`^${code}\\b${SEPARATOR}`) }))

export interface LeadingCountryMatch {
  code: string
  countryName: string
  rest: string // original text (fancy-unicode intact) with the matched country prefix removed
}

// IPTV category/channel names prefix the country either as a short code
// ("NO| Sports", "UK TNT SPORTS 1") or the country's full name spelled out
// ("NORWAY VIP") — real playlists use both. Tries the (less ambiguous)
// full-name form first. Matches against a fancy-Unicode-folded, decorative-
// edge-stripped copy of the text but slices the ORIGINAL so quality tags
// elsewhere in `rest` keep whatever styling they had.
export function matchLeadingCountry(text: string): LeadingCountryMatch | null {
  const cleaned = stripDecorativeEdges(text)
  const folded = foldForMatching(cleaned)

  for (const { name, re } of NAME_PATTERNS) {
    const match = folded.match(re)
    if (!match) continue
    const code = NAME_TO_CODE.get(name)!
    return { code, countryName: COUNTRY_NAMES[code], rest: cleaned.slice(match[0].length).trim() }
  }

  for (const { code, re } of CODE_PATTERNS) {
    const match = folded.match(re)
    if (!match) continue
    return { code, countryName: COUNTRY_NAMES[code], rest: cleaned.slice(match[0].length).trim() }
  }

  return null
}

// SVG flags copied from the `country-flag-icons` package into public/flags
// at dev-time (see TIZEN-PLAN.md) — self-hosted, no CDN, works offline on a
// TV. "UK" is a common IPTV prefix but not a real ISO code; ISO uses GB.
// Same idea for SR/BH, this panel's own non-standard codes for Serbia/
// Bosnia — mapped to the real ISO codes whose flag files actually exist.
const FLAG_CODE_ALIASES: Record<string, string> = { UK: 'GB', SR: 'RS', BH: 'BA' }

// Exact (not fuzzy) case-insensitive lookup against the same display-name
// table matchLeadingCountry uses -- safe because every value ever written
// to SportPreferences.favoriteCountries came from parseCategory's
// countryName in the first place, which is always one of COUNTRY_NAMES'
// values. Used to normalize a favorite-country display name to an ISO2-ish
// code at the boundary (see data/sports/viewerMarket.ts) without migrating
// or re-shaping favoriteCountries itself.
export function countryNameToCode(name: string): string | null {
  return NAME_TO_CODE.get(name.trim().toUpperCase()) ?? null
}

export function flagSrc(code: string): string | null {
  if (!/^[A-Za-z]{2}$/.test(code)) return null
  const upper = code.toUpperCase()
  // Kurdish isn't a sovereign state, so there's no ISO flag to show for it
  // — showing nothing is honest, showing a fabricated flag wouldn't be.
  if (upper === 'KU') return null
  const aliased = FLAG_CODE_ALIASES[upper] ?? upper
  return `${import.meta.env.BASE_URL}flags/${aliased}.svg`
}
