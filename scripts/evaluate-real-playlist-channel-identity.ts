// Shadow diagnostic (NOT wired into runtime): validates the Channel
// Identity Resolver v2 (src/data/sports/channelIdentityResolver.ts) against
// a REAL, currently-configured playlist and compares it against the
// CURRENT live matcher (channelMatch.ts's matchViaNinetyApi, reproduced
// read-only below since it isn't exported) — without changing any runtime
// behavior.
//
// WHY THIS DOESN'T FETCH THE PLAYLIST ITSELF: this provider sits behind
// bot-fingerprinting (a plain Node/curl request gets a non-standard HTTP
// status with an empty body — same result with a browser-like User-Agent),
// so a script-side fetch isn't reliable here. Separately, this playlist is
// large enough that it fails to persist to localStorage at all (quota
// exceeded — see session.ts's header comment), so there's no on-disk cache
// to read either. Instead this script reads a JSON file the user exports
// themselves from the browser tab that already has the playlist connected
// (channels live in that tab's React state regardless of the localStorage
// write failure) via the DEV-only `window.__ninetyExportChannels` hook in
// App.tsx — see its own comment for exactly which fields it exposes.
//
// SAFETY: this file contains no credentials and is safe to commit. It
// never reads a playlist URL, Xtream credential, or stream URL — its only
// external input is a local JSON file path (NINETY_PLAYLIST_EXPORT_FILE)
// containing the SAFE, pre-filtered projection described above (id, name,
// groupTitle, epgChannelIds, rawNames, hasEpgChannelId — no ChannelSource,
// no URL). Every printed/report field is further restricted to: logical
// channel id/name, classification, score, signal types, negative-signal
// types, matched playlist DISPLAY NAME, and playlist country/group label —
// raw epgChannelIds are read in (to count tvg-id coverage and drive
// matching) but never printed anywhere in this script's output.
//
// Usage:
//   NINETY_PLAYLIST_EXPORT_FILE=/path/to/exported-channels.json \
//     npm run evaluate:real-playlist-channel-identity
//
// Optional: NINETY_API_URL (defaults to the deployed Railway URL).
import { readFileSync } from 'node:fs'
import { parseCategory, isPpvCategory } from '../src/features/channels/parseCategory.ts'
import { resolveChannelIdentities, type IdentityClassification, type LogicalChannelResolution, type MatchSignal } from '../src/data/sports/channelIdentityResolver.ts'
import { namesOverlap, normalizeCountryKey } from '../src/data/sports/channelMatchCore.ts'
import type { Channel } from '../src/data/channel.ts'
import type { NinetyLogicalChannel, NinetyEvent } from '../src/data/sports/ninetyApiClient.ts'

const EXPORT_FILE = process.env.NINETY_PLAYLIST_EXPORT_FILE
const API_URL = process.env.NINETY_API_URL || 'https://ninety-api-production.up.railway.app'

if (!EXPORT_FILE) {
  console.error('NINETY_PLAYLIST_EXPORT_FILE is not set.')
  console.error('Export a safe (credential-free) channel projection from a browser tab with a real playlist connected:')
  console.error("  copy(JSON.stringify(window.__ninetyExportChannels))   // devtools console, then paste to a file")
  console.error('Then run:')
  console.error('  NINETY_PLAYLIST_EXPORT_FILE="/path/to/exported-channels.json" npm run evaluate:real-playlist-channel-identity')
  process.exit(1)
}

// ---------------------------------------------------------------------
// Loading the exported, already-safe playlist projection. This is the
// browser's actual merged Channel[] (mergeChannelSources output) with
// `sources` (real stream URLs) already stripped out client-side before
// export — see the App.tsx hook. A placeholder source is reattached here
// only to satisfy the Channel type; the resolver never reads it.
// ---------------------------------------------------------------------

interface ExportedChannel {
  id: string
  name: string
  groupTitle?: string
  epgChannelIds?: string[]
  rawNames?: string[]
  hasEpgChannelId?: boolean
}

function loadExportedPlaylist(filePath: string): Channel[] {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as ExportedChannel[]
  return parsed.map((c) => ({
    id: c.id,
    name: c.name,
    groupTitle: c.groupTitle,
    sources: [{ label: 'Default', url: 'http://example.invalid/stream' }],
    epgChannelIds: c.epgChannelIds,
    rawNames: c.rawNames,
    hasEpgChannelId: c.hasEpgChannelId,
  }))
}

async function fetchCatalog(): Promise<{ version: string; channels: NinetyLogicalChannel[] }> {
  const res = await fetch(`${API_URL}/v1/channels/catalog`)
  if (!res.ok) throw new Error(`catalog fetch failed: HTTP ${res.status}`)
  return res.json()
}

async function fetchAllEvents(): Promise<NinetyEvent[]> {
  const events: NinetyEvent[] = []
  let cursor: string | undefined
  for (;;) {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    const res = await fetch(`${API_URL}/v1/events${qs}`)
    if (!res.ok) throw new Error(`events fetch failed: HTTP ${res.status}`)
    const page = (await res.json()) as { events: NinetyEvent[]; pagination: { has_more: boolean; next_cursor: string | null } }
    events.push(...page.events)
    if (!page.pagination.has_more || !page.pagination.next_cursor) break
    cursor = page.pagination.next_cursor
  }
  return events
}

// ---------------------------------------------------------------------
// Section: real playlist summary
// ---------------------------------------------------------------------

function reportPlaylistSummary(playlist: Channel[]): Set<string> {
  const withEpgId = playlist.filter((c) => (c.epgChannelIds?.length ?? 0) > 0).length
  const countryCounts = new Map<string, number>()
  const groupCounts = new Map<string, number>()
  const playlistCountries = new Set<string>()

  for (const c of playlist) {
    const parsed = parseCategory(c.groupTitle ?? '')
    const country = parsed.countryName ?? '(no country prefix)'
    countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1)
    if (parsed.countryName) playlistCountries.add(parsed.countryName.toUpperCase())
    const label = parsed.mergedLabel || '(uncategorized)'
    groupCounts.set(label, (groupCounts.get(label) ?? 0) + 1)
  }

  console.log('\n=== 1. REAL PLAYLIST ===')
  console.log(`Total merged playlist channels: ${playlist.length}`)
  console.log(`Carrying at least one tvg-id/epg_channel_id: ${withEpgId} (${((withEpgId / Math.max(playlist.length, 1)) * 100).toFixed(1)}%)`)
  console.log('\nCountries represented (by parsed group-title prefix):')
  console.table(Object.fromEntries([...countryCounts.entries()].sort((a, b) => b[1] - a[1])))
  console.log('\nTop group/category labels:')
  console.table(Object.fromEntries([...groupCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)))

  return playlistCountries
}

// ---------------------------------------------------------------------
// Section: resolver coverage against the catalog, scoped to countries
// actually represented in the playlist
// ---------------------------------------------------------------------

function catalogCountryKey(logical: NinetyLogicalChannel): string | null {
  return logical.country ? normalizeCountryKey(logical.country) : null
}

function strongestSignal(match: { signals: MatchSignal[] }): MatchSignal | null {
  let best: MatchSignal | null = null
  for (const s of match.signals) if (!best || s.weight > best.weight) best = s
  return best
}

function reportResolverCoverage(
  catalog: NinetyLogicalChannel[],
  resolutions: Map<string, LogicalChannelResolution>,
  playlistCountries: Set<string>,
): NinetyLogicalChannel[] {
  const relevant = catalog.filter((c) => {
    const key = catalogCountryKey(c)
    return key !== null && playlistCountries.has(key)
  })

  const counts: Record<IdentityClassification, number> = { CONFIRMED: 0, STRONG: 0, AMBIGUOUS: 0, NONE: 0 }
  const signalBreakdown = new Map<string, number>()

  for (const logical of relevant) {
    const res = resolutions.get(logical.id)
    const classification = res?.classification ?? 'NONE'
    counts[classification]++
    if ((classification === 'CONFIRMED' || classification === 'STRONG') && res) {
      for (const m of res.matches) {
        const s = strongestSignal(m)
        if (s) signalBreakdown.set(s.type, (signalBreakdown.get(s.type) ?? 0) + 1)
      }
    }
  }

  const total = relevant.length
  const auto = counts.CONFIRMED + counts.STRONG

  console.log('\n=== 2. NEW RESOLVER — coverage against catalog channels relevant to this playlist ===')
  console.log(`Ninety logical channels relevant to playlist countries [${[...playlistCountries].join(', ')}]: ${total}`)
  console.table(counts)
  console.log(`Automatic coverage (CONFIRMED+STRONG / relevant): ${total === 0 ? 'n/a' : ((auto / total) * 100).toFixed(1)}%`)
  console.log(`Ambiguous rate: ${total === 0 ? 'n/a' : ((counts.AMBIGUOUS / total) * 100).toFixed(1)}%`)
  console.log(`Unresolved (NONE) rate: ${total === 0 ? 'n/a' : ((counts.NONE / total) * 100).toFixed(1)}%`)
  console.log('\nStrongest-signal breakdown behind auto-resolved (CONFIRMED+STRONG) matches:')
  console.table(Object.fromEntries(signalBreakdown))

  return relevant
}

// ---------------------------------------------------------------------
// Section: sports-family review
// ---------------------------------------------------------------------

const SPORTS_KEYWORDS = [
  'tv 2 sport', 'tv2 sport', 'v sport', 'eurosport', 'tv4 sport', 'tv3 sport', 'tv3+', 'tv3 plus',
  'tnt sports', 'sky sports', 'premier sports', 'canal+', 'canal plus', 'bein sports', 'rmc sport',
]

function isSportLogical(logical: NinetyLogicalChannel): boolean {
  const text = `${logical.name} ${logical.network_name ?? ''} ${logical.aliases.join(' ')}`.toLowerCase()
  return text.includes('sport') || SPORTS_KEYWORDS.some((k) => text.includes(k))
}

function reportSportsReview(relevant: NinetyLogicalChannel[], resolutions: Map<string, LogicalChannelResolution>): void {
  const sportsChannels = relevant.filter(isSportLogical)
  let resolved = 0
  let ambiguous = 0
  let missing = 0

  console.log('\n=== 5. SPORTS-CHANNEL REVIEW ===')
  console.log(`Ninety sports logical channels evaluated (of ${relevant.length} relevant): ${sportsChannels.length}\n`)

  for (const logical of sportsChannels.sort((a, b) => (a.country ?? '').localeCompare(b.country ?? '') || a.name.localeCompare(b.name))) {
    const res = resolutions.get(logical.id)
    const classification = res?.classification ?? 'NONE'
    if (classification === 'CONFIRMED' || classification === 'STRONG') resolved++
    else if (classification === 'AMBIGUOUS') ambiguous++
    else missing++

    const matchDesc =
      res && res.matches.length > 0
        ? res.matches
            .map((m) => {
              const strongest = strongestSignal(m)
              return `"${m.channel.name}" [score ${m.score}${strongest ? `, via ${strongest.type}` : ''}${m.negativeSignals.length ? `, ⚠ ${m.negativeSignals.map((n) => n.type).join(',')}` : ''}]`
            })
            .join('; ')
        : '(none)'

    console.log(`[${logical.country ?? '??'}] ${logical.name} (${logical.id})`)
    console.log(`  → ${classification} → ${matchDesc}`)
  }

  console.log(`\nSports summary: resolved ${resolved}, ambiguous ${ambiguous}, missing ${missing} (of ${sportsChannels.length})`)
}

// ---------------------------------------------------------------------
// Section: false-positive / suspicious-case scan over every CONFIRMED or
// STRONG resolution (not just sports) — "would I actually want Ninety to
// open this stream if a user clicked Watch?"
// ---------------------------------------------------------------------

function reportSuspiciousCases(relevant: NinetyLogicalChannel[], resolutions: Map<string, LogicalChannelResolution>): void {
  console.log('\n=== 6. SUSPICIOUS / FALSE-POSITIVE REVIEW (all CONFIRMED+STRONG matches) ===')
  const flags: string[] = []
  const claimedBy = new Map<string, Set<string>>() // playlist channel id -> logical channel ids that accepted it

  for (const logical of relevant) {
    const res = resolutions.get(logical.id)
    if (!res || (res.classification !== 'CONFIRMED' && res.classification !== 'STRONG')) continue

    for (const m of res.matches) {
      const set = claimedBy.get(m.channel.id) ?? new Set<string>()
      set.add(logical.id)
      claimedBy.set(m.channel.id, set)

      const strongest = strongestSignal(m)
      const isExactBasis = strongest?.type === 'exact_unique_external_id' || strongest?.type === 'exact_canonical_name' || strongest?.type === 'exact_alias' || strongest?.type === 'exact_source_name'
      const isPpv = isPpvCategory(parseCategory(m.channel.groupTitle ?? ''))

      if (!isExactBasis) {
        flags.push(`FUZZY BASIS: ${logical.name} (${logical.id}) ${res.classification} via "${m.channel.name}" — strongest signal ${strongest?.type ?? 'none'}, score ${m.score}`)
      }
      if (isPpv) {
        flags.push(`PPV-CATEGORY MATCH: ${logical.name} (${logical.id}) matched playlist channel "${m.channel.name}" whose group is PPV-categorized`)
      }
      if (m.negativeSignals.length > 0) {
        flags.push(`ACCEPTED DESPITE NEGATIVE SIGNAL: ${logical.name} (${logical.id}) ${res.classification} via "${m.channel.name}" — ${m.negativeSignals.map((n) => `${n.type}: ${n.detail}`).join(' | ')}`)
      }
    }
  }

  for (const [channelId, logicalIds] of claimedBy) {
    if (logicalIds.size > 1) {
      flags.push(`DOUBLE-CLAIM (should be impossible — Part 6 guard bypassed?): playlist channel id ${channelId} accepted by multiple logical channels: ${[...logicalIds].join(', ')}`)
    }
  }

  if (flags.length === 0) {
    console.log('No suspicious CONFIRMED/STRONG cases found by the heuristic scan.')
  } else {
    for (const f of flags) console.log(`  ⚠ ${f}`)
  }
}

// ---------------------------------------------------------------------
// Section: OLD vs NEW shadow comparison. OLD is a read-only reproduction
// of channelMatch.ts's matchViaNinetyApi (that function is module-private,
// not exported — reproduced here rather than modifying channelMatch.ts,
// which this task must not touch). Logic copied verbatim in spirit; any
// drift would only make this comparison less accurate, so keep it in sync
// by eye if matchViaNinetyApi ever changes.
// ---------------------------------------------------------------------

function oldMatchViaNinetyApi(event: NinetyEvent, channels: Channel[]): Map<string, string> {
  // channel.id -> broadcast name that matched (OLD's evidence label)
  const result = new Map<string, string>()
  const broadcasts = event.broadcasts ?? []
  if (broadcasts.length === 0) return result

  const broadcastsByCountry = new Map<string, string[]>()
  const allBroadcastNames = new Set<string>()
  for (const b of broadcasts) {
    allBroadcastNames.add(b.name)
    if (b.country) {
      const key = normalizeCountryKey(b.country)
      const list = broadcastsByCountry.get(key) ?? []
      list.push(b.name)
      broadcastsByCountry.set(key, list)
    }
  }

  for (const channel of channels) {
    const channelCountry = parseCategory(channel.groupTitle ?? '').countryName
    const candidates = channelCountry ? (broadcastsByCountry.get(channelCountry.toUpperCase()) ?? []) : [...allBroadcastNames]
    const hit = candidates.find((name) => namesOverlap(name, channel.name))
    if (hit) result.set(channel.id, hit)
  }
  return result
}

function newMatchViaResolver(event: NinetyEvent, resolutions: Map<string, LogicalChannelResolution>): Map<string, { logicalChannelId: string; classification: IdentityClassification }> {
  const result = new Map<string, { logicalChannelId: string; classification: IdentityClassification }>()
  for (const b of event.broadcasts ?? []) {
    const res = resolutions.get(b.logical_channel_id)
    if (!res) continue
    if (res.classification === 'CONFIRMED' || res.classification === 'STRONG') {
      for (const m of res.matches) result.set(m.channel.id, { logicalChannelId: b.logical_channel_id, classification: res.classification })
    }
  }
  return result
}

function reportOldVsNew(events: NinetyEvent[], playlist: Channel[], resolutions: Map<string, LogicalChannelResolution>): void {
  console.log('\n=== 7. OLD vs NEW shadow comparison ===')
  console.log(`Events considered: ${events.length}`)

  let agree = 0
  let newFindsOldMisses = 0
  let oldFindsNewRejects = 0
  const newRejectsExamples: string[] = []
  const newFindsExamples: string[] = []
  let differentChannelEvents = 0
  const differentChannelExamples: string[] = []
  let newAmbiguousCount = 0
  const newAmbiguousExamples: string[] = []

  const byChannelId = new Map(playlist.map((c) => [c.id, c]))

  for (const event of events) {
    const oldMatches = oldMatchViaNinetyApi(event, playlist)
    const newMatches = newMatchViaResolver(event, resolutions)

    const oldIds = new Set(oldMatches.keys())
    const newIds = new Set(newMatches.keys())

    for (const id of oldIds) {
      if (newIds.has(id)) agree++
      else {
        oldFindsNewRejects++
        if (newRejectsExamples.length < 20) {
          const ch = byChannelId.get(id)
          newRejectsExamples.push(`event ${event.id}: OLD matched "${ch?.name}" via "${oldMatches.get(id)}", NEW did not accept it`)
        }
      }
    }
    for (const id of newIds) {
      if (!oldIds.has(id)) {
        newFindsOldMisses++
        if (newFindsExamples.length < 20) {
          const ch = byChannelId.get(id)
          newFindsExamples.push(`event ${event.id}: NEW matched "${ch?.name}" (${newMatches.get(id)?.classification}) via logical ${newMatches.get(id)?.logicalChannelId}, OLD missed it`)
        }
      }
    }

    if (oldIds.size > 0 && newIds.size > 0) {
      const overlap = [...oldIds].some((id) => newIds.has(id))
      if (!overlap) {
        differentChannelEvents++
        if (differentChannelExamples.length < 10) {
          differentChannelExamples.push(
            `event ${event.id}: OLD -> [${[...oldIds].map((id) => byChannelId.get(id)?.name).join(', ')}], NEW -> [${[...newIds].map((id) => byChannelId.get(id)?.name).join(', ')}]`,
          )
        }
      }
    }

    for (const b of event.broadcasts ?? []) {
      const res = resolutions.get(b.logical_channel_id)
      if (res?.classification === 'AMBIGUOUS') {
        newAmbiguousCount++
        if (newAmbiguousExamples.length < 15) {
          newAmbiguousExamples.push(`event ${event.id}: broadcast "${b.name}" (${b.logical_channel_id}) AMBIGUOUS — candidates: ${res.matches.map((m) => `"${m.channel.name}" (score ${m.score})`).join(', ')}`)
        }
      }
    }
  }

  console.log(`A. BOTH AGREE (same channel matched by both): ${agree}`)
  console.log(`B. NEW finds, OLD misses (recall improvement candidates): ${newFindsOldMisses}`)
  console.log(`C. OLD finds, NEW rejects (needs manual classification): ${oldFindsNewRejects}`)
  console.log(`D. BOTH match but to entirely different playlist channels (HIGH PRIORITY review): ${differentChannelEvents}`)
  console.log(`E. NEW-ambiguous broadcast instances: ${newAmbiguousCount}`)

  if (newFindsExamples.length) {
    console.log('\n-- B examples (NEW finds / OLD misses) --')
    newFindsExamples.forEach((e) => console.log(`  + ${e}`))
  }
  if (newRejectsExamples.length) {
    console.log('\n-- C examples (OLD finds / NEW rejects) — inspect each: likely old FP, likely new FN, or uncertain --')
    newRejectsExamples.forEach((e) => console.log(`  - ${e}`))
  }
  if (differentChannelExamples.length) {
    console.log('\n-- D examples (different-channel disagreements) --')
    differentChannelExamples.forEach((e) => console.log(`  ! ${e}`))
  }
  if (newAmbiguousExamples.length) {
    console.log('\n-- E examples (NEW ambiguous) --')
    newAmbiguousExamples.forEach((e) => console.log(`  ? ${e}`))
  }
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main() {
  console.log(`Loading exported playlist projection from ${EXPORT_FILE}...`)
  const playlist = loadExportedPlaylist(EXPORT_FILE as string)
  console.log(`Loaded ${playlist.length} playlist channels.`)

  console.log('Fetching public Ninety channel catalog...')
  const { channels: catalog } = await fetchCatalog()
  console.log(`Catalog: ${catalog.length} logical channels.`)

  const resolutions = resolveChannelIdentities(catalog, playlist)

  const playlistCountries = reportPlaylistSummary(playlist)
  const relevant = reportResolverCoverage(catalog, resolutions, playlistCountries)
  reportSportsReview(relevant, resolutions)
  reportSuspiciousCases(relevant, resolutions)

  console.log('\nFetching current/upcoming events for OLD vs NEW shadow comparison...')
  try {
    const events = await fetchAllEvents()
    reportOldVsNew(events, playlist, resolutions)
  } catch (err) {
    console.log(`Skipping OLD vs NEW comparison — events fetch failed: ${(err as Error).message}`)
  }

  console.log('\nDone. This script made no changes to live matching behavior.')
}

main().catch((err) => {
  console.error('Diagnostic run failed:', (err as Error).message)
  process.exit(1)
})
