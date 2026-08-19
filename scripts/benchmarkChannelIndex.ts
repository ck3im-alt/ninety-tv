// Reproducible, on-demand benchmark for ChannelIndex (src/data/channelIndex.ts)
// against a credential-free synthetic playlist at two sizes — 2,000 channels
// and ~30,925 channels, matching the real-playlist scale this performance
// overhaul is measured against. Prints construction time and per-lookup
// time at each size, plus the large/small ratio.
//
// This is NOT part of `npm test`/CI — per-lookup cost is proven
// structurally (no timing) in src/data/channelIndex.test.ts instead, since
// wall-clock numbers vary too much across machines/CI runners to be a
// reliable pass/fail gate. This script exists purely to produce real,
// human-readable numbers on demand — including on the physical Tizen TV
// itself if ever run there — without baking any threshold into the test
// suite. Run via `npm run benchmark:channel-index`.
import { ChannelIndex } from '../src/data/channelIndex.ts'
import { mergeChannelSources } from '../src/features/channels/mergeChannels.ts'
import { generateSyntheticRawChannels } from '../src/data/testUtils/syntheticPlaylist.ts'
import type { Channel } from '../src/data/channel.ts'

const SMALL_SIZE = 2_000
const LARGE_SIZE = 30_925
const LOOKUP_ITERATIONS = 20_000

function timeMs(fn: () => void): number {
  const start = performance.now()
  fn()
  return performance.now() - start
}

function buildRaw(channelCount: number) {
  // qualityVariantsPerChannel intentionally left at its default (1): with
  // more than one variant, mergeChannelSources collapses same-channel
  // quality-tag duplicates back into one Channel, so the resulting merged
  // playlist would end up smaller than the raw `channelCount` requested —
  // this benchmark cares about the final ChannelIndex size, not the raw
  // ingestion count, so requesting N raw entries with no variants yields
  // exactly N merged channels.
  return generateSyntheticRawChannels({ channelCount, categoriesPerCountry: 8 })
}

function benchmarkAt(channelCount: number) {
  const raw = buildRaw(channelCount)
  let playlist!: Channel[]
  // §11's ingestion-off-main-thread decision needs mergeChannelSources's own
  // cost measured separately from ChannelIndex construction — they're two
  // distinct main-thread tasks in the real app (merge runs once at
  // connect/reconnect/recovery; ChannelIndex builds once per resulting
  // playlist generation, pre-warmed asynchronously — see
  // src/data/channelIndex.ts).
  const mergeMs = timeMs(() => {
    playlist = mergeChannelSources(raw)
  })
  let index!: ChannelIndex
  const constructMs = timeMs(() => {
    index = new ChannelIndex(playlist)
  })

  const sampleChannel = playlist[Math.floor(playlist.length / 2)]
  const sampleEntry = index.getEntry(sampleChannel.id)!
  const sampleCountry = sampleEntry.parsed.countryName ?? 'Other'
  const sampleCategory = sampleEntry.parsed.mergedLabel

  const getEntryMs = timeMs(() => {
    for (let i = 0; i < LOOKUP_ITERATIONS; i++) index.getEntry(sampleChannel.id)
  })
  const getChannelsForCategoryMs = timeMs(() => {
    for (let i = 0; i < LOOKUP_ITERATIONS; i++) index.getChannelsForCategory(sampleCountry, sampleCategory)
  })
  const getSiblingsMs = timeMs(() => {
    for (let i = 0; i < LOOKUP_ITERATIONS; i++) index.getSiblings(sampleChannel)
  })
  const searchMs = timeMs(() => {
    for (let i = 0; i < LOOKUP_ITERATIONS; i++) index.search('channel 1')
  })

  return {
    channelCount: playlist.length,
    mergeMs,
    constructMs,
    perLookupUs: {
      getEntry: (getEntryMs / LOOKUP_ITERATIONS) * 1000,
      getChannelsForCategory: (getChannelsForCategoryMs / LOOKUP_ITERATIONS) * 1000,
      getSiblings: (getSiblingsMs / LOOKUP_ITERATIONS) * 1000,
      search: (searchMs / LOOKUP_ITERATIONS) * 1000,
    },
  }
}

function fmt(n: number): string {
  return n.toFixed(3)
}

console.log('=== ChannelIndex benchmark ===\n')
console.log(`Lookup iterations per operation: ${LOOKUP_ITERATIONS.toLocaleString()}\n`)

const small = benchmarkAt(SMALL_SIZE)
const large = benchmarkAt(LARGE_SIZE)

console.log(`Small playlist: ${small.channelCount.toLocaleString()} channels`)
console.log(`  mergeChannelSources: ${fmt(small.mergeMs)}ms`)
console.log(`  ChannelIndex construction: ${fmt(small.constructMs)}ms`)
console.log(`  per-lookup (µs): getEntry=${fmt(small.perLookupUs.getEntry)} getChannelsForCategory=${fmt(small.perLookupUs.getChannelsForCategory)} getSiblings=${fmt(small.perLookupUs.getSiblings)} search=${fmt(small.perLookupUs.search)}`)
console.log()
console.log(`Large playlist: ${large.channelCount.toLocaleString()} channels`)
console.log(`  mergeChannelSources: ${fmt(large.mergeMs)}ms`)
console.log(`  ChannelIndex construction: ${fmt(large.constructMs)}ms`)
console.log(`  per-lookup (µs): getEntry=${fmt(large.perLookupUs.getEntry)} getChannelsForCategory=${fmt(large.perLookupUs.getChannelsForCategory)} getSiblings=${fmt(large.perLookupUs.getSiblings)} search=${fmt(large.perLookupUs.search)}`)
console.log()

const sizeRatio = large.channelCount / small.channelCount
console.log(`Playlist size ratio (large/small): ${fmt(sizeRatio)}x`)
console.log(`Construction time ratio: ${fmt(large.constructMs / small.constructMs)}x (expected to scale roughly with playlist size — this is legitimately O(n), runs once per connect, not per arrow press)`)
console.log()
console.log('Per-lookup time ratio (large/small) — should stay close to 1x regardless of the playlist-size ratio above, proving lookups are O(1)/O(k), not O(n):')
for (const op of ['getEntry', 'getChannelsForCategory', 'getSiblings', 'search'] as const) {
  const ratio = large.perLookupUs[op] / small.perLookupUs[op]
  console.log(`  ${op}: ${fmt(ratio)}x`)
}
console.log()
console.log(`If ChannelIndex construction at ~${LARGE_SIZE.toLocaleString()} channels exceeds ~100ms, see channelIndex.ts's construction-cost comment for the chunked/async escalation path (already implemented — see warmChannelIndexAsync).`)
console.log(`If mergeChannelSources at ~${LARGE_SIZE.toLocaleString()} channels exceeds ~300-500ms, see mergeChannels.ts / the ingestion-off-main-thread decision in the performance overhaul plan for the chunked escalation path.`)
