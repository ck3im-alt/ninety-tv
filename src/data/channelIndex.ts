// A single prepared/indexed view of the playlist, built once per playlist
// generation (keyed by the `channels` array's own reference identity — see
// getChannelIndex below) instead of being rebuilt on every focus movement.
//
// Before this existed, BrowseCascadeScreen/FilterPopup/App.tsx's player-
// sibling lookup, and channelMatch.ts's broadcasterMap/PPV matching stages
// each independently rescanned the *entire* channels array and re-ran
// parseCategory per channel on every relevant state change — including on
// every single D-pad arrow move within the Country/Category columns (see
// BrowseCascadeScreen's onFocus-driven live preview). For a ~30,925-channel
// playlist that's the literal "one remote press scans the whole playlist"
// performance bug. This module exists to make that O(1)/O(k) instead.
//
// Deliberately unfiltered: hiddenCountries/hiddenCategories filtering and
// favorite-first sorting stay in the consumers (BrowseCascadeScreen needs to
// filter, FilterPopup must NOT — it has to show hidden entries so the user
// can re-enable them). Baking filtering in here would make that impossible
// to express correctly for both consumers.
import type { Channel } from './channel'
import { parseCategory, isPpvCategory, type ParsedCategory } from '../features/channels/parseCategory'
import { foldForMatching } from './fancyUnicode'
import { markPerf, measurePerf } from '../core/perf/devPerf'

const OTHER = 'Other'

export interface ChannelIndexEntry {
  channel: Channel
  parsed: ParsedCategory
  countryKey: string
  // Plain lowercase name (not fancy-Unicode-folded) — matches
  // BrowseCascadeScreen's existing `c.name.toLowerCase().includes(q)` search
  // semantics exactly; changing to a folded compare would be a behavior
  // change, not just a speed-up.
  foldedName: string
  // isPpvCategory(parsed) alone — the predicate matchViaEpgAllPpv's PPV
  // candidate filter and isLikelySportChannel both use.
  isCategoryPpv: boolean
  // matchViaPpvChannelName's exact "isTaggedPpv || isUnmappedEntry" gate:
  // (isPpvCategory(parsed) OR the channel's own name literally says PPV) OR
  // it has no EPG-mapped id at all.
  isPpvOrUnmapped: boolean
  // isLikelySportChannel's exact predicate (matchViaEpg's candidate filter).
  isLikelySport: boolean
}

interface CategoryBucket {
  label: string
  isPpv: boolean
  channels: Channel[]
}

export class ChannelIndex {
  private readonly entries = new Map<string, ChannelIndexEntry>()
  private readonly countryCounts = new Map<string, { code: string | null; count: number }>()
  private readonly countryChannels = new Map<string, Channel[]>()
  // country -> mergedLabel -> bucket
  private readonly categoryBuckets = new Map<string, Map<string, CategoryBucket>>()
  private readonly ppvOrUnmappedChannels: Channel[] = []
  private readonly ppvChannels: Channel[] = []
  private readonly likelySportChannels: Channel[] = []
  // Cache per-distinct-groupTitle folding — a real playlist has vastly fewer
  // distinct groupTitles than channels, same synergy as parseCategory's own
  // cache. `foldForMatching` is a pure, order/length-preserving
  // per-character mapping (verified in fancyUnicode.ts: every mapped
  // character has a 1:1 replacement, and an unmapped character — including
  // a literal space — passes through unchanged), so folding groupTitle and
  // name SEPARATELY and checking `.includes('SPORT')` on each is provably
  // identical to folding the original `${groupTitle} ${name}` combined
  // string and checking once: the literal space this code joins them with
  // can never let a 5-letter match span across the boundary. This removes a
  // full second character-by-character fold per channel without changing
  // behavior.
  private readonly foldedGroupTitleCache = new Map<string, string>()

  // Takes an already-built channel list and ingests it synchronously in one
  // pass — used directly by getChannelIndex's synchronous fast path. For
  // building a fresh index from a large (~30,925-channel) playlist without
  // a single large main-thread task, use warmChannelIndexAsync below
  // instead, which chunks the same per-channel work with yields between
  // batches and populates the same WeakMap cache getChannelIndex reads from.
  constructor(channels: Channel[]) {
    for (const channel of channels) this.ingestOne(channel)
  }

  private foldedGroupTitle(groupTitle: string): string {
    let folded = this.foldedGroupTitleCache.get(groupTitle)
    if (folded === undefined) {
      folded = foldForMatching(groupTitle)
      this.foldedGroupTitleCache.set(groupTitle, folded)
    }
    return folded
  }

  private ingestOne(channel: Channel): void {
    const parsed = parseCategory(channel.groupTitle || '')
    const countryKey = parsed.countryName ?? OTHER
    const foldedName = channel.name.toLowerCase()
    const isCategoryPpv = isPpvCategory(parsed)
    const foldedChannelName = foldForMatching(channel.name)
    const nameHasPpvLiteral = /\bPPV\b/.test(foldedChannelName)
    const isTaggedPpv = isCategoryPpv || nameHasPpvLiteral
    const isPpvOrUnmapped = isTaggedPpv || !channel.hasEpgChannelId
    const isLikelySport =
      isCategoryPpv || foldedChannelName.includes('SPORT') || this.foldedGroupTitle(channel.groupTitle ?? '').includes('SPORT')

    this.entries.set(channel.id, {
      channel,
      parsed,
      countryKey,
      foldedName,
      isCategoryPpv,
      isPpvOrUnmapped,
      isLikelySport,
    })

    const countryCount = this.countryCounts.get(countryKey)
    if (!countryCount) {
      this.countryCounts.set(countryKey, { code: parsed.countryCode, count: 1 })
    } else {
      countryCount.count += 1
    }

    let countryList = this.countryChannels.get(countryKey)
    if (!countryList) {
      countryList = []
      this.countryChannels.set(countryKey, countryList)
    }
    countryList.push(channel)

    let countryCategories = this.categoryBuckets.get(countryKey)
    if (!countryCategories) {
      countryCategories = new Map()
      this.categoryBuckets.set(countryKey, countryCategories)
    }
    let bucket = countryCategories.get(parsed.mergedLabel)
    if (!bucket) {
      bucket = { label: parsed.mergedLabel, isPpv: isCategoryPpv, channels: [] }
      countryCategories.set(parsed.mergedLabel, bucket)
    }
    bucket.channels.push(channel)

    if (isPpvOrUnmapped) this.ppvOrUnmappedChannels.push(channel)
    if (isCategoryPpv) this.ppvChannels.push(channel)
    if (isLikelySport) this.likelySportChannels.push(channel)
  }

  // Package-internal — only warmChannelIndexAsync (below, same module)
  // should ever call this; every other consumer goes through getChannelIndex.
  _ingestChunk(channels: Channel[], start: number, end: number): void {
    for (let i = start; i < end; i++) this.ingestOne(channels[i])
  }

  getEntry(channelId: string): ChannelIndexEntry | undefined {
    return this.entries.get(channelId)
  }

  getCountries(): { name: string; code: string | null; count: number }[] {
    return [...this.countryCounts.entries()].map(([name, { code, count }]) => ({ name, code, count }))
  }

  getCategoriesForCountry(country: string): { label: string; isPpv: boolean; count: number }[] {
    const countryCategories = this.categoryBuckets.get(country)
    if (!countryCategories) return []
    return [...countryCategories.values()].map((bucket) => ({
      label: bucket.label,
      isPpv: bucket.isPpv,
      count: bucket.channels.length,
    }))
  }

  getChannelsForCategory(country: string, category: string): Channel[] {
    const bucket = this.categoryBuckets.get(country)?.get(category)
    return bucket ? [...bucket.channels] : []
  }

  getChannelsForCountry(country: string): Channel[] {
    const list = this.countryChannels.get(country)
    return list ? [...list] : []
  }

  getSiblings(channel: Channel): Channel[] {
    const entry = this.entries.get(channel.id)
    if (!entry) return []
    const bucket = this.categoryBuckets.get(entry.countryKey)?.get(entry.parsed.mergedLabel)
    if (!bucket) return []
    return bucket.channels.filter((c) => c.id !== channel.id)
  }

  search(foldedQuery: string): Channel[] {
    const results: Channel[] = []
    for (const entry of this.entries.values()) {
      if (entry.foldedName.includes(foldedQuery)) results.push(entry.channel)
    }
    return results
  }

  getPpvOrUnmappedChannels(): Channel[] {
    return [...this.ppvOrUnmappedChannels]
  }

  getPpvChannels(): Channel[] {
    return [...this.ppvChannels]
  }

  getLikelySportChannels(): Channel[] {
    return [...this.likelySportChannels]
  }
}

const indexCache = new WeakMap<Channel[], ChannelIndex>()

export function getChannelIndex(channels: Channel[]): ChannelIndex {
  let index = indexCache.get(channels)
  if (!index) {
    markPerf('channelIndex:construct-start')
    index = new ChannelIndex(channels)
    markPerf('channelIndex:construct-end')
    measurePerf('channelIndex:construct', 'channelIndex:construct-start', 'channelIndex:construct-end')
    indexCache.set(channels, index)
  }
  return index
}

// Chunked/incremental pre-warm — measured on a synthetic ~30,925-channel
// benchmark (scripts/benchmarkChannelIndex.ts) at ~65-115ms of main-thread
// work depending on optimization level, on ordinary dev-machine hardware;
// the physical low-powered Tizen TV this app targets should be assumed
// slower, not faster, so this exists as a real mitigation rather than
// insurance against a hypothetical. Builds the SAME ChannelIndex as the
// synchronous constructor, in batches, yielding to the event loop between
// them so no single main-thread task does the whole ~30k-channel pass at
// once. Populates the exact same WeakMap cache getChannelIndex reads from,
// keyed by the same `channels` array reference — call this once, right
// after a fresh connect/recovery/hydration produces a channels array and
// BEFORE that array is handed to any synchronous getChannelIndex() caller
// (e.g. before installPlaylist's setState triggers a render), so by the
// time a synchronous consumer needs the index, it's already built and
// getChannelIndex returns instantly from cache. If a synchronous caller
// gets there first anyway, nothing breaks — getChannelIndex just builds
// synchronously as it always has, and this function's own in-progress work
// is simply discarded in favor of that result (see the cache check below).
const DEFAULT_WARM_CHUNK_SIZE = 2000

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    const w = globalThis as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(() => resolve(), { timeout: 50 })
    else setTimeout(resolve, 0)
  })
}

export async function warmChannelIndexAsync(channels: Channel[], chunkSize = DEFAULT_WARM_CHUNK_SIZE): Promise<ChannelIndex> {
  const cached = indexCache.get(channels)
  if (cached) return cached

  markPerf('channelIndex:construct-async-start')
  const index = new ChannelIndex([])
  for (let start = 0; start < channels.length; start += chunkSize) {
    // Another caller (a synchronous getChannelIndex()) may have already
    // built and cached a real index for this exact array while we were
    // mid-chunk — stop doing redundant work and defer to it rather than
    // finishing a build nobody will use.
    const alreadyBuilt = indexCache.get(channels)
    if (alreadyBuilt) return alreadyBuilt
    index._ingestChunk(channels, start, Math.min(start + chunkSize, channels.length))
    if (start + chunkSize < channels.length) await yieldToMainThread()
  }
  markPerf('channelIndex:construct-async-end')
  measurePerf('channelIndex:construct-async', 'channelIndex:construct-async-start', 'channelIndex:construct-async-end')

  const raceCheck = indexCache.get(channels)
  if (raceCheck) return raceCheck
  indexCache.set(channels, index)
  return index
}
