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
import {
  namesOverlap,
  namesExactMatch,
  textMatchesTeam,
  STALE_STATUS_WORDS,
  extractCandidateDates,
  isPlausibleEventDate,
  normalizeCountryKey,
} from './channelMatchCore'
import type { Channel } from '../channel'
import type { XtreamCredentials } from '../xtream/types'
import type { SportEvent } from './types'

// How far a candidate fixture/EPG listing's time may drift from the
// event's real kickoff and still count as "this is that match" — schedules
// aren't always exact to the minute, but this also has to stay tight
// enough to not accidentally match an unrelated fixture/programme that
// happens to start around the same time.
const TIME_TOLERANCE_MS = 60 * 60 * 1000 // 1 hour

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
      const key = normalizeCountryKey(b.country)
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
