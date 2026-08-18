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
import { getShortEpgLimited } from '../xtream/epgGate'
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
} from './channelMatchCore'
import type { ChannelIdentityIndex } from './channelIdentityIndex'
import type { IdentityClassification } from './channelIdentityResolver'
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
  // in the UI so the pick isn't a black box (e.g. "via TV 2 Sport"). For a
  // 'ninety' match this is always ninety-api's own canonical broadcast
  // name (event.broadcasts[].name), never the matched playlist channel's
  // own (possibly differently-spelled) name.
  label: string
  // True only when the match is a genuinely exact identity/name match —
  // a 'ninety' match with identityClassification 'CONFIRMED' (an
  // exact-grade resolver signal: unique external id, or an exact
  // canonical/alias/source-name match), or the pre-existing
  // namesExactMatch-based check for broadcasterMap matches. A 'ninety'
  // match classified STRONG is a real, automatically-watchable match but
  // NOT exact (structured/fuzzy overlap got it there) — never mark it
  // true just because it was accepted; see the resolver-integration task's
  // explicit warning against that.
  isExactMatch: boolean
  // Only present for source: 'ninety' — which Channel Identity Resolver v2
  // tier produced this match. AMBIGUOUS/NONE never reach here at all (see
  // channelIdentityIndex.ts's getPlaylistChannels), so this field is only
  // ever 'CONFIRMED' or 'STRONG' when present.
  identityClassification?: Extract<IdentityClassification, 'CONFIRMED' | 'STRONG'>
}

export interface BroadcastStationInfo {
  name: string
  country: string | null
  // Present only when a ChannelIdentityIndex was available to evaluate
  // this broadcast's logical channel against the user's playlist.
  // AMBIGUOUS/NONE never produce a ChannelMatch (see Part 9/10 of the
  // resolver-integration task — no silent namesOverlap fallback, and
  // AMBIGUOUS is never auto-watchable), but this keeps the diagnostic
  // classification around rather than throwing it away, so a future Event
  // Details phase can say e.g. "Ninety knows this is on TNT Sports 1, but
  // your playlist channel couldn't be confirmed" instead of nothing at all.
  identityClassification?: IdentityClassification
  // Playlist channel names behind an AMBIGUOUS classification specifically
  // — diagnostic only, never used to auto-select a stream.
  ambiguousPlaylistChannelNames?: string[]
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

// event.broadcast.logicalChannelId -> precomputed ChannelIdentityIndex ->
// user's playlist Channel[] — replaces the old event.broadcast.name ->
// namesOverlap() scan across every playlist channel. The index is built
// ONCE per (catalog version, playlist) pair (see useChannelIdentityIndex.ts)
// and reused across every event; this function does no scoring of its own,
// only looks up already-computed resolutions.
//
// Only CONFIRMED/STRONG resolutions become a ChannelMatch (via
// ChannelIdentityIndex.getPlaylistChannels — see its own doc comment).
// AMBIGUOUS is deliberately never auto-watchable, and NONE means "Ninety
// knows this logical channel but couldn't confirm it in this playlist" —
// neither falls back to the old namesOverlap(broadcast.name, channel.name)
// scan, which would reintroduce the false-positive class this resolver
// exists to eliminate. `identityIndex` is null when no catalog was
// available at all this session (see useChannelIdentityIndex.ts) — in that
// case the Ninety stage simply contributes nothing, but apiHasData/
// apiStations are still reported from the event's own broadcasts, and
// broadcasterMap/PPV/EPG stages are entirely unaffected.
function matchViaNinetyApi(event: SportEvent, identityIndex: ChannelIdentityIndex | null): { matches: ChannelMatch[]; apiHasData: boolean; apiStations: BroadcastStationInfo[] } {
  const broadcasts = event.broadcasts ?? []
  if (broadcasts.length === 0) return { matches: [], apiHasData: false, apiStations: [] }

  const matches: ChannelMatch[] = []
  const apiStations: BroadcastStationInfo[] = broadcasts.map((b) => {
    if (!identityIndex) return { name: b.name, country: b.country }

    const resolution = identityIndex.getResolution(b.logicalChannelId)
    const classification = resolution?.classification
    const ambiguousPlaylistChannelNames =
      classification === 'AMBIGUOUS' ? resolution!.matches.map((m) => m.channel.name) : undefined

    if (classification === 'CONFIRMED' || classification === 'STRONG') {
      for (const channel of identityIndex.getPlaylistChannels(b.logicalChannelId)) {
        matches.push({
          channel,
          source: 'ninety',
          // Canonical broadcast name as the UI label — never the matched
          // playlist channel's own (possibly differently-spelled) name.
          label: b.name,
          // A STRONG result cleared the auto-match bar via structured/fuzzy
          // signals, not an exact identity match — only CONFIRMED (an
          // exact-grade signal: unique external id, or exact
          // canonical/alias/source-name) may claim isExactMatch.
          isExactMatch: classification === 'CONFIRMED',
          identityClassification: classification,
        })
      }
    }

    return { name: b.name, country: b.country, identityClassification: classification, ambiguousPlaylistChannelNames }
  })

  return { matches, apiHasData: true, apiStations }
}

// Curated fallback for sports/leagues with no per-fixture broadcast-rights
// API (i.e. everything ninety-api's EPG resolver doesn't cover — see
// broadcasterMap.ts). Unlike matchViaNinetyApi, this needs no team names or kickoff time —
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

async function matchViaEpg(event: SportEvent, channels: Channel[], xtreamCreds: XtreamCredentials | null, signal?: AbortSignal): Promise<ChannelMatch[]> {
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
      if (signal?.aborted) return null
      const source = channel.sources[0]
      const streamId = source ? extractStreamId(source.url) : null
      if (streamId === null) return null

      const listings = await getShortEpgLimited(xtreamCreds, streamId, 4, signal)
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

// Last-resort fallback, only tried once both the ninety-api and the normal
// (sport-named-channel) EPG stages have come up empty. Widens the search
// to every PPV-categorized channel in the playlist regardless of whether
// its name looks sport-related (a one-off match can land on a PPV stream
// with a generic/unrelated-looking name), and loosens the match itself:
// at least two words shared with the home+away team names, rather than
// requiring one recognizable word from each team specifically. This is a
// deliberately weaker signal than the other two stages — it exists to
// surface a plausible guess when nothing better is available, not to be
// as trustworthy as a real broadcaster mapping.
async function matchViaEpgAllPpv(event: SportEvent, channels: Channel[], xtreamCreds: XtreamCredentials | null, signal?: AbortSignal): Promise<ChannelMatch[]> {
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
      if (signal?.aborted) return null
      const source = channel.sources[0]
      const streamId = source ? extractStreamId(source.url) : null
      if (streamId === null) return null

      const listings = await getShortEpgLimited(xtreamCreds, streamId, 4, signal)
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

export interface MatchChannelsOptions {
  // The two EPG stages are the only ones that cost a real network round
  // trip against the user's own Xtream panel. Home/hero/live-row matching
  // (see useHomeFeed.ts) can run for several simultaneously-live matches at
  // once via Promise.all, so it opts out of the network stages entirely and
  // relies only on the three free/local ones (ninety-api broadcasts,
  // broadcasterMap, PPV-name matching) — a live card just won't show up in
  // that row until one of those free signals covers it. Event Details,
  // which matches exactly one event at a time, is the only caller that
  // should ever set this true.
  allowNetworkFallback?: boolean
  // Lets a caller (Event Details) cancel in-flight EPG probes once the
  // screen showing them is closed, rather than letting an already-launched
  // batch run to completion against the user's panel for no one to see.
  signal?: AbortSignal
}

// Only meaningful for team-vs-team fixtures with a real kickoff time —
// single-entrant events (F1 sessions, golf rounds) have no "home vs away"
// text to match against and aren't attempted by any stage.
export async function matchChannelsForEvent(
  event: SportEvent,
  channels: Channel[],
  xtreamCreds: XtreamCredentials | null,
  // Precomputed once per (catalog version, playlist) pair by
  // useChannelIdentityIndex.ts and reused across every event — never build
  // one of these per call. null means no channel catalog was available
  // this session (first run, offline, ninety-api down with no cache); the
  // Ninety stage then contributes nothing, but every other stage
  // (broadcasterMap/PPV/EPG) is unaffected.
  identityIndex: ChannelIdentityIndex | null,
  options: MatchChannelsOptions = {},
): Promise<MatchResult> {
  const { allowNetworkFallback = false, signal } = options
  const { matches: ninetyMatches, apiHasData, apiStations } = matchViaNinetyApi(event, identityIndex)
  const broadcasterMapMatches = matchViaBroadcasterMap(event, channels)
  const ppvNameMatches = matchViaPpvChannelName(event, channels)

  const freeMatches = dedupeByChannel([...ninetyMatches, ...broadcasterMapMatches, ...ppvNameMatches])
  if (freeMatches.length > 0 || !allowNetworkFallback) return { matches: freeMatches, apiHasData, apiStations }

  const epgMatches = await matchViaEpg(event, channels, xtreamCreds, signal)
  if (epgMatches.length > 0) return { matches: epgMatches, apiHasData, apiStations }

  const widenedMatches = await matchViaEpgAllPpv(event, channels, xtreamCreds, signal)
  return { matches: widenedMatches, apiHasData, apiStations }
}
