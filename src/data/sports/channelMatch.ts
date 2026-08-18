// Finds which of the user's own connected playlist channels are actually
// airing a given sport event. There is no API that maps "this match" to
// "this channel in this specific user's personal Xtream/M3U playlist" —
// sports-data providers have no concept of the viewer's own IPTV
// subscription, and the playlist itself has no structured "shows league X"
// metadata, only free-text channel/category names.
//
// Two-stage match:
// 1. ninety-api's own EPG resolver (see ninetyApiClient.ts) has already
//    matched the event to real linear TV channels — carried directly on
//    the event as `broadcasts` (see types.ts), so this stage needs no
//    extra network round-trip, unlike the old Sportmonks flow which had
//    to re-fetch and re-find the fixture just to get its station list.
// 2. EPG programme-title text (Xtream `get_short_epg`) as a fallback for
//    anything ninety-api doesn't cover yet (a league/country its resolver
//    hasn't been extended to) — free, but much weaker: guessing from a
//    programme title is nowhere near as reliable as being told the actual
//    channel outright.
import { getShortEpg } from '../xtream/xtreamClient'
import { extractStreamId } from '../xtream/extractStreamId'
import { broadcastersFor } from './broadcasterMap'
import { foldForMatching } from '../fancyUnicode'
import { parseCategory, isPpvCategory } from '../../features/channels/parseCategory'
import { COUNTRY_NAMES } from '../countryCodes'
import type { Channel } from '../channel'
import type { XtreamCredentials } from '../xtream/types'
import type { SportEvent } from './types'

// How far a candidate fixture/EPG listing's time may drift from the
// event's real kickoff and still count as "this is that match" — schedules
// aren't always exact to the minute, but this also has to stay tight
// enough to not accidentally match an unrelated fixture/programme that
// happens to start around the same time.
const TIME_TOLERANCE_MS = 60 * 60 * 1000 // 1 hour

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
const GENERIC_TEAM_WORDS = new Set([
  'CITY', 'UNITED', 'TOWN', 'ATHLETIC', 'COUNTY', 'ROVERS', 'WANDERERS',
  'ALBION', 'FC', 'AFC', 'CF', 'SK', 'FK', 'SC', 'CD', 'RC', 'REAL',
])

function significantWords(teamName: string): string[] {
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

function textMatchesTeam(foldedText: string, teamName: string): boolean {
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
const GENERIC_CHANNEL_WORDS = new Set(['TV', 'HD', 'FHD', 'UHD', 'SD', 'LIVE'])

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
const BRAND_QUALIFIER_WORDS = new Set(['SPORT', 'SPORTS', 'PLUS', 'PREMIUM', 'CHANNEL', 'NETWORK'])

function qualifierWords(words: string[]): Set<string> {
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

function meaningfulWords(text: string): string[] {
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
}

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
function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const w of a) if (!b.has(w)) return false
  return true
}

function namesOverlap(stationName: string, channelName: string): boolean {
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
const QUALITY_TAGS = new Set(['HD', 'FHD', 'UHD', 'SD'])

function exactWords(text: string): string[] {
  return mergeTvBrandTokens(
    expandPlusMarker(foldForMatching(text))
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .split(' '),
  ).filter((w) => w.length > 0 && !QUALITY_TAGS.has(w))
}

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
function namesExactMatch(stationName: string, channelName: string): boolean {
  const stationWords = exactWords(stationName)
  const channelWords = exactWords(channelName)
  if (stationWords.length === 0 || stationWords.length !== channelWords.length) return false
  return stationWords.every((w, i) => w === channelWords[i])
}

export interface ChannelMatch {
  channel: Channel
  source: 'ninety' | 'broadcasterMap' | 'ppvName' | 'epg'
  // The real broadcaster/programme name that produced this match, shown
  // in the UI so the pick isn't a black box (e.g. "via TV 2 Sport").
  label: string
  // True only for a ninety-api match where the channel name's meaningful
  // words are exactly the reported broadcast channel's (e.g. "ARENA SPORT
  // PREMIUM 1" channel for a reported "Arena Sport Premium 1" station) —
  // as opposed to a looser word-overlap or EPG-programme-title guess. Lets
  // the UI tell the user which picks are a confirmed identity match versus
  // a best-effort one, rather than presenting every match with equal
  // confidence.
  isExactMatch: boolean
}

export interface BroadcastStationInfo {
  name: string
  country: string | null
}

export interface MatchResult {
  matches: ChannelMatch[]
  // Distinguishes "ninety-api has no idea what's airing this fixture" from
  // "ninety-api told us exactly what's airing it, we just don't have that
  // channel" — the UI needs to say something different for each rather
  // than one generic "not found" for both.
  apiHasData: boolean
  // The channels ninety-api's resolver itself reports for this fixture,
  // independent of whether any of them matched a playlist channel — shown
  // to the user either as the reason nothing matched (apiHasData true,
  // matches empty) or as a debug aid alongside a successful match.
  apiStations: BroadcastStationInfo[]
}

function matchViaNinetyApi(event: SportEvent, channels: Channel[]): { matches: ChannelMatch[]; apiHasData: boolean; apiStations: BroadcastStationInfo[] } {
  const broadcasts = event.broadcasts ?? []
  if (broadcasts.length === 0) return { matches: [], apiHasData: false, apiStations: [] }

  // Grouped by country so a channel tagged e.g. "Norway" in the playlist
  // is only checked against broadcasts ninety-api reports for Norway, not
  // every channel worldwide airing this fixture — a Kazakh or Bosnian
  // station sharing a generic word with an unrelated Norwegian channel was
  // a real source of false positives with the old Sportmonks integration.
  // A channel whose country couldn't be parsed from its category (no
  // leading country prefix) still falls back to checking against every
  // broadcast, since there's nothing to scope it by.
  const broadcastsByCountry = new Map<string, string[]>()
  const allBroadcastNames = new Set<string>()
  for (const b of broadcasts) {
    allBroadcastNames.add(b.name)
    if (b.country) {
      // ninety-api reports a short country code ("GB"), while
      // `channelCountry` below comes from parseCategory/matchLeadingCountry,
      // which normalizes playlist group-title prefixes to the full country
      // NAME ("United Kingdom") — bucketing by the raw code here meant a
      // real "TNT Sports 1" channel under a "UK|"/"GB -" group title could
      // never be found, since "GB" was never a key the channel-side lookup
      // (which looks up by name) would ever produce. Normalize through the
      // same COUNTRY_NAMES map so both sides key off the same string.
      const key = (COUNTRY_NAMES[b.country.toUpperCase()] ?? b.country).toUpperCase()
      const list = broadcastsByCountry.get(key) ?? []
      list.push(b.name)
      broadcastsByCountry.set(key, list)
    }
  }

  const matches: ChannelMatch[] = []
  for (const channel of channels) {
    const channelCountry = parseCategory(channel.groupTitle ?? '').countryName
    const candidates = channelCountry ? (broadcastsByCountry.get(channelCountry.toUpperCase()) ?? []) : [...allBroadcastNames]
    const hit = candidates.find((name) => namesOverlap(name, channel.name))
    if (hit) matches.push({ channel, source: 'ninety', label: hit, isExactMatch: namesExactMatch(hit, channel.name) })
  }

  const apiStations = broadcasts.map((b) => ({ name: b.name, country: b.country }))
  return { matches, apiHasData: true, apiStations }
}

// Curated fallback for sports/leagues with no per-fixture broadcast-rights
// API (i.e. everything Sportmonks doesn't cover — see broadcasterMap.ts).
// Unlike matchViaSportmonks, this needs no team names or kickoff time —
// it's a season-long "this league always airs on this channel in this
// country" fact, so it applies just as well to single-entrant events (F1
// sessions) as it does to team fixtures.
function matchViaBroadcasterMap(event: SportEvent, channels: Channel[]): ChannelMatch[] {
  const matches: ChannelMatch[] = []
  for (const channel of channels) {
    const channelCountry = parseCategory(channel.groupTitle ?? '').countryName
    if (!channelCountry) continue
    const stationNames = broadcastersFor(event.sportKey, event.leagueId, channelCountry)
    const hit = stationNames.find((name) => namesOverlap(name, channel.name))
    if (hit) matches.push({ channel, source: 'broadcasterMap', label: hit, isExactMatch: namesExactMatch(hit, channel.name) })
  }
  return matches
}

// One-off PPV streams are commonly published as a single playlist entry
// whose NAME *is* the event ("LIVE | DEPORTIVO – ELCHE | Mon 17 Aug 20:55
// CEST (NO) | 8K EXCLUSIVE | NO: TV2 PLAY PPV 9") rather than a channel
// brand — there's no separate "channel" identity or EPG programme to match
// against at all, and ninety-api/broadcasterMap have nothing to say about a
// single rotating pay-per-view slot number like this. The channel's own
// name is the only signal, but for a PPV-categorized entry it's a strong
// one: both team names co-occurring in a one-off PPV stream's title is
// specific enough to trust without needing EPG/Xtream access, so this runs
// before the EPG-based fallbacks (no network round-trip, no Xtream
// credentials required — works for plain M3U playlists too).
// A provider's own PPV listing telling us outright that the broadcast is
// over ("ENDED | ...", "End | Deportivo vs. Elche | 17-08-2026 20:37 (GMT)")
// is explicit negative evidence, not something to rank lower — showing it
// as a way to watch a match that's already finished is actively wrong, not
// just noisy (blueprint section 75: repeats/status metadata must be able to
// reject a candidate outright). Matched as a whole leading word so it can't
// misfire on an unrelated word merely containing these letters.
const STALE_STATUS_WORDS = /^(ENDED?|FT|POSTPONED|CANCELLED|CANCELED|ABANDONED)\b/

const MONTH_NAMES: Record<string, number> = {
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
function extractCandidateDates(text: string): Array<{ month: number; day: number; year?: number }> {
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
const DATE_TOLERANCE_DAYS = 2

function isPlausibleEventDate(candidate: { month: number; day: number; year?: number }, kickoff: Date): boolean {
  const year = candidate.year ?? kickoff.getUTCFullYear()
  const candidateMs = Date.UTC(year, candidate.month - 1, candidate.day)
  const kickoffMs = Date.UTC(kickoff.getUTCFullYear(), kickoff.getUTCMonth(), kickoff.getUTCDate())
  const diffDays = Math.abs(candidateMs - kickoffMs) / (24 * 60 * 60 * 1000)
  return diffDays <= DATE_TOLERANCE_DAYS
}

function matchViaPpvChannelName(event: SportEvent, channels: Channel[]): ChannelMatch[] {
  if (!event.homeTeam || !event.awayTeam) return []
  const kickoff = event.dateTimeUtc ? new Date(event.dateTimeUtc) : null
  const matches: ChannelMatch[] = []
  for (const channel of channels) {
    // A one-off event entry can be identified two ways, since not every
    // provider spells it "PPV":
    // 1. Text: the category or the channel's own name literally says PPV
    //    (see the Deportivo/Elche example above).
    // 2. Structure: the entry carries no source EPG-channel id at all
    //    (M3U tvg-id / Xtream epg_channel_id — see RawChannel/Channel).
    //    Real 24/7 linear channels are almost always EPG-mapped by the
    //    provider; a synthetically-generated per-match stream usually
    //    isn't, since there's no recurring programme to map it to. This
    //    catches providers that never write "PPV" anywhere at all.
    // Either way, the actual match still requires BOTH team names to
    // literally appear in the channel's name — that's what keeps this from
    // false-matching ordinary channels once the gate is broadened this far.
    const isTaggedPpv = isPpvCategory(parseCategory(channel.groupTitle ?? '')) || /\bPPV\b/.test(foldForMatching(channel.name))
    const isUnmappedEntry = !channel.hasEpgChannelId
    if (!isTaggedPpv && !isUnmappedEntry) continue
    const foldedName = foldForMatching(channel.name)
    if (STALE_STATUS_WORDS.test(foldedName.trim())) continue
    if (!textMatchesTeam(foldedName, event.homeTeam) || !textMatchesTeam(foldedName, event.awayTeam)) continue

    if (kickoff) {
      const candidateDates = extractCandidateDates(foldedName)
      if (candidateDates.length > 0 && !candidateDates.some((d) => isPlausibleEventDate(d, kickoff))) continue
    }

    matches.push({ channel, source: 'ppvName', label: channel.name, isExactMatch: false })
  }
  return matches
}

function isLikelySportChannel(channel: Channel): boolean {
  const text = foldForMatching(`${channel.groupTitle ?? ''} ${channel.name}`)
  // A one-off event like an obscure qualifier is exactly the kind of thing
  // that ends up on a standalone PPV stream rather than a channel with
  // "Sport" in its name (see the PPV explanation logged earlier in this
  // project) — excluding those was silently dropping a real category of
  // candidates.
  return text.includes('SPORT') || isPpvCategory(parseCategory(channel.groupTitle ?? ''))
}

// Bounds worst-case EPG request volume against the user's own Xtream
// panel — playlists can have thousands of channels; only ones that at
// least look sport-related are worth checking at all.
const MAX_EPG_CANDIDATE_CHANNELS = 40

async function matchViaEpg(event: SportEvent, channels: Channel[], xtreamCreds: XtreamCredentials | null): Promise<ChannelMatch[]> {
  if (!xtreamCreds) {
    console.log('[channelMatch] EPG fallback skipped: no Xtream credentials (plain M3U playlist)')
    return []
  }
  if (!event.homeTeam || !event.awayTeam || !event.dateTimeUtc) return []

  const kickoff = new Date(event.dateTimeUtc).getTime()
  const candidates = channels.filter(isLikelySportChannel).slice(0, MAX_EPG_CANDIDATE_CHANNELS)
  console.log(
    `[channelMatch] EPG fallback: ${candidates.length} sport/PPV candidate channels out of ${channels.length} total. ` +
      `Sample: ${candidates.slice(0, 8).map((c) => c.name).join(', ')}`,
  )

  const results = await Promise.allSettled(
    candidates.map(async (channel) => {
      const source = channel.sources[0]
      const streamId = source ? extractStreamId(source.url) : null
      if (streamId === null) return null

      const listings = await getShortEpg(xtreamCreds, streamId, 4)
      const hit = listings.find((listing) => {
        const withinWindow = Math.abs(listing.start_timestamp * 1000 - kickoff) <= TIME_TOLERANCE_MS
        if (!withinWindow) return false
        const foldedTitle = foldForMatching(listing.title)
        return textMatchesTeam(foldedTitle, event.homeTeam!) && textMatchesTeam(foldedTitle, event.awayTeam!)
      })
      return hit ? ({ channel, source: 'epg', label: hit.title, isExactMatch: false } as ChannelMatch) : null
    }),
  )

  const failed = results.filter((r) => r.status === 'rejected').length
  const matches = results
    .filter((r): r is PromiseFulfilledResult<ChannelMatch | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((m): m is ChannelMatch => m != null)
  console.log(`[channelMatch] EPG fallback: ${matches.length} matched, ${failed} requests failed.`)
  return matches
}

// Bounds worst-case EPG request volume for the widened PPV search below —
// separate cap from MAX_EPG_CANDIDATE_CHANNELS since this pool is already
// scoped to PPV categories specifically, not the whole playlist.
const MAX_PPV_EPG_CANDIDATES = 60

function significantWordSet(text: string): Set<string> {
  return new Set(
    foldForMatching(text)
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .split(' ')
      .filter((w) => w.length >= 2),
  )
}

// Last-resort fallback, only tried once both the Sportmonks and the normal
// (sport-named-channel) EPG stages have come up empty. Widens the search
// to every PPV-categorized channel in the playlist regardless of whether
// its name looks sport-related (a one-off match can land on a PPV stream
// with a generic/unrelated-looking name), and loosens the match itself:
// at least two words shared with the home+away team names, rather than
// requiring one recognizable word from each team specifically. This is a
// deliberately weaker signal than the other two stages — it exists to
// surface a plausible guess when nothing better is available, not to be
// as trustworthy as a real broadcaster mapping.
async function matchViaEpgAllPpv(event: SportEvent, channels: Channel[], xtreamCreds: XtreamCredentials | null): Promise<ChannelMatch[]> {
  if (!xtreamCreds) return []
  if (!event.homeTeam || !event.awayTeam || !event.dateTimeUtc) return []

  const kickoff = new Date(event.dateTimeUtc).getTime()
  const eventWords = significantWordSet(`${event.homeTeam} ${event.awayTeam}`)
  const candidates = channels
    .filter((c) => isPpvCategory(parseCategory(c.groupTitle ?? '')))
    .slice(0, MAX_PPV_EPG_CANDIDATES)
  console.log(`[channelMatch] Widened PPV EPG search: ${candidates.length} PPV candidate channels (of ${channels.length} total).`)

  const results = await Promise.allSettled(
    candidates.map(async (channel) => {
      const source = channel.sources[0]
      const streamId = source ? extractStreamId(source.url) : null
      if (streamId === null) return null

      const listings = await getShortEpg(xtreamCreds, streamId, 4)
      const hit = listings.find((listing) => {
        const withinWindow = Math.abs(listing.start_timestamp * 1000 - kickoff) <= TIME_TOLERANCE_MS
        if (!withinWindow) return false
        const titleWords = significantWordSet(listing.title)
        const overlap = [...titleWords].filter((w) => eventWords.has(w)).length
        return overlap >= 2
      })
      return hit ? ({ channel, source: 'epg', label: hit.title, isExactMatch: false } as ChannelMatch) : null
    }),
  )

  const matches = results
    .filter((r): r is PromiseFulfilledResult<ChannelMatch | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((m): m is ChannelMatch => m != null)
  console.log(`[channelMatch] Widened PPV EPG search: ${matches.length} matched.`)
  return matches
}

// An event can legitimately air on several unrelated channels at once — a
// normal linear simulcast AND a separate one-off PPV stream, a domestic
// broadcaster AND an international one, etc (see blueprint section 28,
// "multiple valid broadcasters"). Stopping at the first stage that found
// *anything* threw away every other genuinely valid channel a later stage
// would have found — e.g. ninety-api confirming a GB broadcaster hid a
// user's own NO PPV stream of the same match entirely, even though both are
// real, independent ways to watch it. So the three free/local stages (no
// network round-trip, no Xtream credentials needed) always all run and their
// results are combined, deduped by channel — keeping the highest-trust
// match per channel when more than one stage happens to hit the same one.
// The two EPG stages stay a true last resort: they cost real probe requests
// against the user's Xtream panel, so they're only worth running when the
// free stages found nothing at all to show.
const SOURCE_PRIORITY: Record<ChannelMatch['source'], number> = {
  ninety: 0,
  broadcasterMap: 1,
  ppvName: 2,
  epg: 3,
}

function dedupeByChannel(matches: ChannelMatch[]): ChannelMatch[] {
  const byChannel = new Map<string, ChannelMatch>()
  for (const match of matches) {
    const existing = byChannel.get(match.channel.id)
    if (!existing) {
      byChannel.set(match.channel.id, match)
      continue
    }
    const existingRank = existing.isExactMatch ? -1 : SOURCE_PRIORITY[existing.source]
    const candidateRank = match.isExactMatch ? -1 : SOURCE_PRIORITY[match.source]
    if (candidateRank < existingRank) byChannel.set(match.channel.id, match)
  }
  return [...byChannel.values()]
}

// Only meaningful for team-vs-team fixtures with a real kickoff time —
// single-entrant events (F1 sessions, golf rounds) have no "home vs away"
// text to match against and aren't attempted by any stage.
export async function matchChannelsForEvent(
  event: SportEvent,
  channels: Channel[],
  xtreamCreds: XtreamCredentials | null,
): Promise<MatchResult> {
  const { matches: ninetyMatches, apiHasData, apiStations } = matchViaNinetyApi(event, channels)
  const broadcasterMapMatches = matchViaBroadcasterMap(event, channels)
  const ppvNameMatches = matchViaPpvChannelName(event, channels)

  const freeMatches = dedupeByChannel([...ninetyMatches, ...broadcasterMapMatches, ...ppvNameMatches])
  if (freeMatches.length > 0) return { matches: freeMatches, apiHasData, apiStations }

  const epgMatches = await matchViaEpg(event, channels, xtreamCreds)
  if (epgMatches.length > 0) return { matches: epgMatches, apiHasData, apiStations }

  const widenedMatches = await matchViaEpgAllPpv(event, channels, xtreamCreds)
  return { matches: widenedMatches, apiHasData, apiStations }
}
