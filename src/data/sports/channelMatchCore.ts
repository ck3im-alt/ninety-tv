// Pure, side-effect-free matching helpers extracted from channelMatch.ts so
// they can be unit tested directly without needing Xtream credentials, a
// SportEvent, or a Channel list — see channelMatch.test.ts. No behavior
// change from the original inline versions; this is purely a file split for
// testability.
import { foldForMatching } from '../fancyUnicode'
import { COUNTRY_NAMES } from '../countryCodes'

// Blueprint §14 is explicit: "Do not infer: 'City' -> Manchester City". A
// generic club-name suffix shared by dozens of unrelated teams (Coventry
// City, Manchester City, Leicester City, Stoke City...) must never be the
// word that satisfies a team match on its own — real-world false positive
// found live: an "Arsenal vs Manchester City" PPV listing matched a
// Coventry City fixture purely because both team names contain "City",
// even though the two matches have nothing to do with each other. Only
// used to EXCLUDE a word from being picked as the distinctive one below —
// never strips it from the folded channel/programme TEXT being searched,
// so a genuine "Coventry City" mention still matches.
export const GENERIC_TEAM_WORDS = new Set([
  'CITY', 'UNITED', 'TOWN', 'ATHLETIC', 'COUNTY', 'ROVERS', 'WANDERERS',
  'ALBION', 'FC', 'AFC', 'CF', 'SK', 'FK', 'SC', 'CD', 'RC', 'REAL',
])

export function significantWords(teamName: string): string[] {
  const words = foldForMatching(teamName)
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 0)
    .sort((a, b) => b.length - a.length)
  // Prefer distinctive words; a team name that's ENTIRELY generic words
  // (essentially never happens for a real club) falls back to the
  // unfiltered list rather than matching against nothing at all.
  const distinctive = words.filter((w) => !GENERIC_TEAM_WORDS.has(w))
  return (distinctive.length > 0 ? distinctive : words).slice(0, 2)
}

export function textMatchesTeam(foldedText: string, teamName: string): boolean {
  return significantWords(teamName).some((w) => foldedText.includes(w))
}

// Generic broadcast/channel filler that appears across many unrelated
// channels — excluded from word-overlap matching so e.g. two completely
// different channels both containing "SPORT" or "HD" don't false-match.
// PREMIUM added after real-world testing (Tobol vs Partizan match) showed
// it collapsing entirely unrelated networks together — "V Sport Premium",
// "V Film Premium", "TV2 Sport Premium", and "Viaplay Sport Premium" all
// word-overlap-matched the same "Arena Sport Premium 1" broadcaster purely
// because they all carry the word "PREMIUM", a marketing suffix many
// unrelated channel families use, not a brand identifier.
// Deliberately does NOT include digits — a channel number is often the
// only thing distinguishing sibling channels from the same broadcast
// family (e.g. "Arena Sport 1" through "Arena Sport 7"), so stripping
// numbers out as "noise" was actively wrong: it made a station called
// "Arena Sport Premium 1" word-overlap-match all seven differently
// numbered "Arena Sport N" channels in the playlist at once, since the
// only remaining shared word after stripping was the generic brand root
// "ARENA". See the numeric-token gate in namesOverlap below.
export const GENERIC_CHANNEL_WORDS = new Set(['TV', 'HD', 'FHD', 'UHD', 'SD', 'LIVE'])

// Same words as GENERIC_CHANNEL_WORDS, but NOT dropped from comparison the
// same way — they're excluded from contributing to overlapCount (so they
// can never be the word that makes two DIFFERENT brand families match, e.g.
// "V Sport Premium" vs "Arena Sport Premium" sharing only "PREMIUM"), but
// unlike true filler (TV/HD/LIVE/...) their presence is otherwise
// meaningful: "TV3", "TV3 Sport", and "TV3+" are three different real
// channels, as are "Viaplay", "Viaplay Sport", "Viaplay Sport 1", and
// "Viaplay Sport Premium" — stripping SPORT/PLUS/PREMIUM to nothing made
// all of those siblings collapse to the same single word ("TV3"/"VIAPLAY")
// and match each other. Real-world false positive: ninety-api reporting
// station "TV3+" for a UEFA Champions League fixture matched the user's
// "TV3", "TV3 Sport", and "TV3 Plus" playlist channels indiscriminately.
// So these words are treated like the channel-number guard above: if
// either name carries one, both names must carry the exact same set, same
// as the mandatory-number check — a qualifier word is either a genuine part
// of the channel's identity (present in both) or it means the two names
// denote different sibling channels (present in only one).
export const BRAND_QUALIFIER_WORDS = new Set(['SPORT', 'SPORTS', 'PLUS', 'PREMIUM', 'CHANNEL', 'NETWORK'])

// Exported for channelIdentityResolver.ts, which needs the same
// qualifier-word extraction to build its own structured-conflict signals
// rather than re-deriving this logic independently.
export function qualifierWords(words: string[]): Set<string> {
  return new Set(words.filter((w) => BRAND_QUALIFIER_WORDS.has(w)))
}

// "TV" alone is filler ("XYZ TV", "Sports TV"), but "TV" immediately
// followed by a lone digit is a real, extremely common broadcaster brand in
// its own right (TV2, TV3, TV4, TV6 across Nordic/European markets) — e.g.
// ninety-api reporting the station as "TV 2 Sport 1" (space-separated) needs
// to recognize "TV 2" as one brand token the same way a playlist channel
// named "TV2 Sport 1" already does, or the entire station name reduces to
// zero non-generic words (TV stripped as filler, SPORT stripped as filler)
// and namesOverlap rejects a real match purely because this one broadcaster
// happens to be spelled with a space. Joining the pair into a single "TV2"
// token before generic-word filtering runs fixes that without touching how
// any other "TV ..." name is treated.
function mergeTvBrandTokens(words: string[]): string[] {
  const merged: string[] = []
  for (let i = 0; i < words.length; i++) {
    if (words[i] === 'TV' && /^\d+$/.test(words[i + 1] ?? '')) {
      merged.push('TV' + words[i + 1])
      i++
    } else {
      merged.push(words[i])
    }
  }
  return merged
}

// A trailing "+" ("TV3+", "Viaplay+") is a real, meaningful tier marker —
// equivalent in spirit to "Plus"/"Premium" (e.g. "TV3 Plus" is the actual
// spelled-out name of the "TV3+" channel in some listings) — not punctuation
// to discard. Converted to the PLUS qualifier word before the generic
// alnum-only strip below would otherwise erase it silently, which was
// letting "TV3+" and "TV3" (a different channel) compare as identical.
function expandPlusMarker(text: string): string {
  return text.replace(/\+/g, ' PLUS ')
}

// Channel Identity Resolver v2's real-playlist validation (30,925 playlist
// channels x ~115 catalog logical channels) surfaced that this function is
// the hot path: namesOverlap/namesExactMatch both retokenize their inputs
// from scratch on every call, and the same catalog name / playlist channel
// name gets compared against thousands of counterparts, so the identical
// string is re-tokenized over and over. meaningfulWords/exactWords are pure
// (same input always produces the same output), so memoizing them is a
// behavior-preserving speedup, not a semantic change — verified via the
// gold dataset (npm run evaluate:channel-identity) staying byte-identical
// before/after. Capped defensively so a pathological caller (or a very
// long-lived session) can't grow this unboundedly on a memory-constrained
// Tizen device; a real playlist's distinct name strings number in the tens
// of thousands, well under the cap in normal use.
const TOKENIZE_CACHE_LIMIT = 100_000

function memoize(fn: (text: string) => string[]): (text: string) => string[] {
  const cache = new Map<string, string[]>()
  return (text: string) => {
    const cached = cache.get(text)
    if (cached) return cached
    if (cache.size >= TOKENIZE_CACHE_LIMIT) cache.clear()
    const result = fn(text)
    cache.set(text, result)
    return result
  }
}

// Exported for channelIdentityResolver.ts — same tokenization (generic-word
// stripping, TV+digit brand merging, "+" -> PLUS expansion) that encodes
// this file's real-world regression knowledge, reused rather than
// reimplemented so the resolver doesn't drift from namesOverlap's behavior.
export const meaningfulWords = memoize((text: string): string[] => {
  const words = mergeTvBrandTokens(
    expandPlusMarker(foldForMatching(text))
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .split(' '),
  )
  // Single-character tokens are dropped as stray noise (stripped
  // punctuation remnants etc.) — EXCEPT a lone digit, which is very
  // often a real, meaningful channel number ("Arena Sport 1") and must
  // survive for the numeric gate above to have anything to check.
  return words.filter((w) => (w.length >= 2 || /^\d$/.test(w)) && !GENERIC_CHANNEL_WORDS.has(w))
})

// Broadcaster and channel names are rarely identical strings — a station
// like "TV3 Sport HD" might appear in a playlist as "SE: TV3 Sport 1", so
// a straight substring check (does the channel name contain the exact
// station name) missed real matches over a suffix/prefix difference. This
// checks for shared *meaningful* words instead (ignoring generic filler
// like "HD"/"SPORT"), which is far more tolerant of exactly the kind of
// naming drift real playlists have — but with two extra guards:
//
// 1. If the STATION carries an explicit channel number (a standalone digit
//    token, e.g. the "1" in "Arena Sport Premium 1"), that number is now
//    mandatory, full stop — the channel must carry the same number too,
//    even if they'd otherwise share a brand word. Real-world testing
//    (Tobol vs Partizan) showed this has to hold even when the shared
//    brand word is the station's *only* real word: "Arena Sport Premium
//    1" was matching "Arena Fight", "Arena eSport", "Arena 1X2", and
//    "NTV Arena" purely off the word "ARENA", because an earlier version
//    of this guard let a single-brand-word station skip the number check
//    entirely. A brand family sharing one root word ("Arena") but spanning
//    entirely different channels (sport/fight/esport/betting-odds/a
//    third-party "NTV Arena") is exactly the case a numbered station needs
//    protecting against, not exempting.
// 2. When the station has NO number at all, a single shared brand word is
//    only trusted on its own when the STATION's entire brand identity
//    (after stripping generic filler) IS that one word — e.g. "beIN
//    Sports" reduces to just "BEIN", so a channel containing "BEIN" is a
//    real match. But "Arena Cloud" reduces to two words, "ARENA" and
//    "CLOUD" — a channel called "Arena Premium 4" only shares "ARENA",
//    and that single word doesn't account for "CLOUD" at all. A
//    number-less station with more than one real brand word needs at
//    least two of them to show up in the channel name before it counts as
//    the same broadcaster, not just a shared root.
//
//    A station also needs a THIRD guard beyond "trust a shared word":
//    public/umbrella broadcasters (TVP, BBC, ARD...) publish dozens of
//    unrelated sibling channels — news, kids, history, entertainment —
//    all sharing that one root word (and, just as often, sharing a channel
//    NUMBER too, purely by coincidence — "TVP 2" the station and "TVP
//    Historia 2"/"TVP ABC 2" the unrelated channels all happen to carry a
//    "2"). Real-world testing found both shapes of this false-positive —
//    a "TVP Sport" broadcast matching every "TVP …" channel via the single-
//    brand-word path, and a "TVP 2" broadcast matching "TVP Historia 2"/
//    "TVP ABC 2" via the numbered path — so both paths apply the same
//    check: once the required number (if any) and shared brand word are
//    accounted for, nothing else may be left over. A real extra word
//    (HISTORIA, ABC, INFO, KULTURA...) always means it's a genuinely
//    different sibling channel, never the same station.
// Exported for channelIdentityResolver.ts's own qualifier-conflict check.
export function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const w of a) if (!b.has(w)) return false
  return true
}

export function namesOverlap(stationName: string, channelName: string): boolean {
  const stationWordsAll = meaningfulWords(stationName)
  const channelWordsAll = new Set(meaningfulWords(channelName))

  // Qualifier words (SPORT/PLUS/PREMIUM/...) must match exactly between the
  // two names before anything else is even considered — same treatment as
  // the mandatory channel-number gate below. This is what stops "TV3",
  // "TV3 Sport", and "TV3+" (or "Viaplay", "Viaplay Sport", "Viaplay Sport
  // Premium") from being treated as the same channel: whichever of these
  // words a name carries, the other name must carry exactly the same set.
  if (!sameSet(qualifierWords(stationWordsAll), qualifierWords([...channelWordsAll]))) return false

  const stationWords = stationWordsAll.filter((w) => !BRAND_QUALIFIER_WORDS.has(w))
  const channelWords = new Set([...channelWordsAll].filter((w) => !BRAND_QUALIFIER_WORDS.has(w)))

  const isNumber = (w: string) => /^\d+$/.test(w)
  const stationNumbers = stationWords.filter(isNumber)
  const channelNumbers = [...channelWords].filter(isNumber)
  const stationBrandWords = stationWords.filter((w) => !isNumber(w))
  const overlapCount = stationBrandWords.filter((w) => channelWords.has(w)).length
  const extraChannelWords = [...channelWords].filter((w) => !stationBrandWords.includes(w) && !stationNumbers.includes(w))

  if (stationNumbers.length > 0) {
    if (channelNumbers.length === 0 || !stationNumbers.some((n) => channelWords.has(n))) return false
    return overlapCount >= 1 && extraChannelWords.length === 0
  }

  if (stationBrandWords.length <= 1) {
    if (overlapCount === 0) return false
    return extraChannelWords.every(isNumber)
  }
  return overlapCount >= 2
}

// Trailing quality/format tags — unlike GENERIC_CHANNEL_WORDS above, these
// aren't stripped from namesOverlap's word-overlap check (removing "SPORT"/
// "PREMIUM" there was deliberately about brand words, not format tags), but
// they *are* irrelevant to whether two names denote the exact same
// broadcaster, so a channel called "ARENA SPORT PREMIUM 1 HD" still counts
// as the same station as "Arena Sport Premium 1".
export const QUALITY_TAGS = new Set(['HD', 'FHD', 'UHD', 'SD'])

const exactWords = memoize((text: string): string[] => {
  return mergeTvBrandTokens(
    expandPlusMarker(foldForMatching(text))
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .split(' '),
  ).filter((w) => w.length > 0 && !QUALITY_TAGS.has(w))
})

// A much stricter check than namesOverlap, used only to flag a match as
// "exact" in the UI (see ChannelMatch.isExactMatch). namesOverlap ignores
// brand-filler words like "SPORT"/"PREMIUM" (see GENERIC_CHANNEL_WORDS)
// specifically so differently-numbered siblings and near-miss names can
// still surface as *candidates* — but that same leniency means "Arena Sport
// Premium 1", "Arena Sport 1", and "Arena Sport 1 Premium" all reduce to
// the same bag of non-generic words ("ARENA", "1") and become
// indistinguishable, even though they're different channels (real-world
// testing: Tobol vs Partizan only actually airs on "Arena Sport Premium
// 1" — the other four are namesOverlap candidates, not the same station).
// Exact-match instead compares the full word *sequence*, generic words
// included, order-sensitive — "Arena Sport Premium 1" is not the same
// sequence as "Arena Sport 1 Premium", so only a true identical name (up to
// case/punctuation/quality-tag noise) counts.
export function namesExactMatch(stationName: string, channelName: string): boolean {
  const stationWords = exactWords(stationName)
  const channelWords = exactWords(channelName)
  if (stationWords.length === 0 || stationWords.length !== channelWords.length) return false
  return stationWords.every((w, i) => w === channelWords[i])
}

// A provider's own PPV listing telling us outright that the broadcast is
// over ("ENDED | ...", "End | Deportivo vs. Elche | 17-08-2026 20:37 (GMT)")
// is explicit negative evidence, not something to rank lower — showing it
// as a way to watch a match that's already finished is actively wrong, not
// just noisy (blueprint section 75: repeats/status metadata must be able to
// reject a candidate outright). Matched as a whole leading word so it can't
// misfire on an unrelated word merely containing these letters.
export const STALE_STATUS_WORDS = /^(ENDED?|FT|POSTPONED|CANCELLED|CANCELED|ABANDONED)\b/

export const MONTH_NAMES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
}
const MONTH_PATTERN = Object.keys(MONTH_NAMES).join('|')

// Mirrors the API resolver's time-delta rejection (blueprint §22/§25) for
// the one signal available client-side without a real EPG behind the
// stream: a calendar date the provider itself printed into the title
// ("Mon 17 Aug 20:55", "17-08-2026 20:37 (GMT)", "(STAN 14) | ... (2026-08-22
// 04:00:29)"). Deliberately date-only, not time-of-day — the title's
// timezone is unknown (could be the provider's local time, GMT, or an
// overseas rights-holder's own zone, as seen with Stan Sport's Australian
// timestamps landing a day later than the UK kickoff date), so comparing
// clock times would false-reject genuinely correct listings. Comparing
// just the calendar date, with slack for that same timezone drift, still
// catches the real false positives this was written for — an "Arsenal vs
// Manchester City" PPV listing dated months away from the actual fixture.
export function extractCandidateDates(text: string): Array<{ month: number; day: number; year?: number }> {
  const dates: Array<{ month: number; day: number; year?: number }> = []
  const isoRe = /\b(\d{4})-(\d{2})-(\d{2})\b/g
  for (const m of text.matchAll(isoRe)) {
    dates.push({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) })
  }
  const dayMonthRe = new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_PATTERN})\\b`, 'g')
  for (const m of text.matchAll(dayMonthRe)) {
    dates.push({ day: Number(m[1]), month: MONTH_NAMES[m[2]] })
  }
  const monthDayRe = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})\\b`, 'g')
  for (const m of text.matchAll(monthDayRe)) {
    dates.push({ day: Number(m[2]), month: MONTH_NAMES[m[1]] })
  }
  return dates
}

// Generous ±2 calendar days — enough slack to absorb timezone drift across
// a date-only comparison without letting through a listing for a genuinely
// different day.
export const DATE_TOLERANCE_DAYS = 2

export function isPlausibleEventDate(candidate: { month: number; day: number; year?: number }, kickoff: Date): boolean {
  const year = candidate.year ?? kickoff.getUTCFullYear()
  const candidateMs = Date.UTC(year, candidate.month - 1, candidate.day)
  const kickoffMs = Date.UTC(kickoff.getUTCFullYear(), kickoff.getUTCMonth(), kickoff.getUTCDate())
  const diffDays = Math.abs(candidateMs - kickoffMs) / (24 * 60 * 60 * 1000)
  return diffDays <= DATE_TOLERANCE_DAYS
}

// ninety-api reports a short country code ("GB"), while `channelCountry` in
// channelMatch.ts comes from parseCategory/matchLeadingCountry, which
// normalizes playlist group-title prefixes to the full country NAME
// ("United Kingdom") — bucketing broadcasts by the raw code meant a real
// "TNT Sports 1" channel under a "UK|"/"GB -" group title could never be
// found, since "GB" was never a key the channel-side lookup (which looks up
// by name) would ever produce. Normalizes through the same COUNTRY_NAMES
// map so both sides key off the same string.
export function normalizeCountryKey(country: string): string {
  return (COUNTRY_NAMES[country.toUpperCase()] ?? country).toUpperCase()
}
