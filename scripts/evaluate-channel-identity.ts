// DB-free, network-free evaluator for the Channel Identity Resolver v2
// (see src/data/sports/channelIdentityResolver.ts). Loads the committed
// gold dataset (fixtures/channel-identity/cases.json), runs the pure
// resolver against each scenario's local catalog+playlist, and reports
// precision/recall/ambiguity metrics — mirroring ninety-api's
// scripts/evaluate-resolver.ts in spirit, but entirely local: no Postgres,
// no HTTP.
//
// Quality gate for this phase: automatic precision (CONFIRMED+STRONG)
// must be 100% on this dataset. The script exits non-zero if any false
// positive exists, and always prints recall/coverage/ambiguity numbers
// honestly even when precision is clean, so a resolver that "wins" by
// marking everything AMBIGUOUS is visibly not useful, not just cautious.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resolveChannelIdentities, type IdentityClassification, type MatchSignal } from '../src/data/sports/channelIdentityResolver.ts'
import type { Channel } from '../src/data/channel.ts'
import type { NinetyLogicalChannel } from '../src/data/sports/ninetyApiClient.ts'

interface GoldPlaylistChannel {
  id: string
  name: string
  groupTitle?: string
  epgChannelIds?: string[]
  rawNames?: string[]
}

interface GoldExpected {
  logicalChannelId: string
  classification: IdentityClassification
  playlistIds: string[]
}

interface GoldCase {
  id: string
  provenance: string
  catalog: NinetyLogicalChannel[]
  playlist: GoldPlaylistChannel[]
  expected: GoldExpected[]
  note: string
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const casesPath = join(__dirname, '../fixtures/channel-identity/cases.json')
const cases: GoldCase[] = JSON.parse(readFileSync(casesPath, 'utf8'))

function buildChannel(gc: GoldPlaylistChannel): Channel {
  return {
    id: gc.id,
    name: gc.name,
    groupTitle: gc.groupTitle,
    sources: [{ label: 'Default', url: 'http://example.invalid/stream' }],
    epgChannelIds: gc.epgChannelIds,
    rawNames: gc.rawNames,
    hasEpgChannelId: (gc.epgChannelIds?.length ?? 0) > 0,
  }
}

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((id) => bSet.has(id))
}

const AUTO: ReadonlySet<IdentityClassification> = new Set(['CONFIRMED', 'STRONG'])

interface Mismatch {
  scenario: string
  logicalChannelId: string
  predicted: IdentityClassification
  predictedIds: string[]
  expected: IdentityClassification
  expectedIds: string[]
  explanation: string
}

let totalExpectations = 0
let exactMatches = 0
let expectedAutoPositives = 0
let trueAutoPositives = 0
let predictedAutoCount = 0
let predictedAmbiguousCount = 0
let ambiguousExpected = 0
let ambiguousCorrect = 0
let noneExpected = 0
let noneCorrect = 0

const falsePositives: Mismatch[] = []
const falseNegatives: Mismatch[] = []
const confusion = new Map<string, Map<string, number>>()
const signalBreakdown = new Map<string, { tp: number }>()
const provenanceCounts = new Map<string, number>()

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function explain(res: { matches: { signals: MatchSignal[]; negativeSignals: { type: string; detail: string }[] }[] } | undefined): string {
  if (!res || res.matches.length === 0) return 'no candidates considered'
  return res.matches
    .flatMap((m) => [...m.signals.map((s) => `+${s.type}(${s.weight}): ${s.detail}`), ...m.negativeSignals.map((s) => `-${s.type}: ${s.detail}`)])
    .join(' | ')
}

for (const goldCase of cases) {
  provenanceCounts.set(goldCase.provenance, (provenanceCounts.get(goldCase.provenance) ?? 0) + 1)
  const playlist = goldCase.playlist.map(buildChannel)
  const resolutions = resolveChannelIdentities(goldCase.catalog, playlist)

  for (const expected of goldCase.expected) {
    totalExpectations++
    const res = resolutions.get(expected.logicalChannelId)
    const predictedClassification = res?.classification ?? 'NONE'
    const predictedIds = [...(res?.matches ?? [])].map((m) => m.playlistChannelId).sort()
    const expectedIds = [...expected.playlistIds].sort()
    const idsMatch = sameIdSet(predictedIds, expectedIds)
    const exact = predictedClassification === expected.classification && idsMatch

    bump(confusion.get(expected.classification) ?? (confusion.set(expected.classification, new Map()), confusion.get(expected.classification)!), predictedClassification)

    if (exact) exactMatches++

    const expectedAuto = AUTO.has(expected.classification)
    const predictedAuto = AUTO.has(predictedClassification)
    if (predictedAuto) predictedAutoCount++
    if (predictedClassification === 'AMBIGUOUS') predictedAmbiguousCount++

    const mismatch: Mismatch = {
      scenario: goldCase.id,
      logicalChannelId: expected.logicalChannelId,
      predicted: predictedClassification,
      predictedIds,
      expected: expected.classification,
      expectedIds,
      explanation: explain(res),
    }

    if (expectedAuto) {
      expectedAutoPositives++
      if (exact) trueAutoPositives++
      else falseNegatives.push(mismatch)
    }
    if (predictedAuto && !exact) falsePositives.push(mismatch)

    if (expected.classification === 'AMBIGUOUS') {
      ambiguousExpected++
      if (predictedClassification === 'AMBIGUOUS') ambiguousCorrect++
    }
    if (expected.classification === 'NONE') {
      noneExpected++
      if (predictedClassification === 'NONE') noneCorrect++
    }

    if (exact && predictedAuto && res) {
      for (const m of res.matches) {
        let strongest: MatchSignal | null = null
        for (const s of m.signals) if (!strongest || s.weight > strongest.weight) strongest = s
        if (strongest) {
          const entry = signalBreakdown.get(strongest.type) ?? { tp: 0 }
          entry.tp++
          signalBreakdown.set(strongest.type, entry)
        }
      }
    }
  }
}

const precision = trueAutoPositives + falsePositives.length === 0 ? 1 : trueAutoPositives / (trueAutoPositives + falsePositives.length)
const recall = expectedAutoPositives === 0 ? 1 : trueAutoPositives / expectedAutoPositives
const automaticCoverageRate = totalExpectations === 0 ? 0 : predictedAutoCount / totalExpectations
const ambiguityRate = totalExpectations === 0 ? 0 : predictedAmbiguousCount / totalExpectations
const ambiguityAccuracy = ambiguousExpected === 0 ? 1 : ambiguousCorrect / ambiguousExpected
const noneAccuracy = noneExpected === 0 ? 1 : noneCorrect / noneExpected

console.log('=== Channel Identity Resolver v2 — gold evaluation ===\n')
console.log(`Scenarios: ${cases.length}`)
console.log('Provenance:', Object.fromEntries(provenanceCounts))
console.log(`Total per-logical-channel expectations: ${totalExpectations}`)
console.log(`Exact matches (classification + channel set): ${exactMatches}/${totalExpectations}\n`)

console.log('--- Confusion matrix (rows = expected, columns = predicted) ---')
const classes: IdentityClassification[] = ['CONFIRMED', 'STRONG', 'AMBIGUOUS', 'NONE']
const table: Record<string, Record<string, number>> = {}
for (const row of classes) {
  table[row] = {}
  for (const col of classes) table[row][col] = confusion.get(row)?.get(col) ?? 0
}
console.table(table)

console.log('\n--- Metrics ---')
console.log(`AUTOMATIC PRECISION (CONFIRMED+STRONG correctness): ${(precision * 100).toFixed(1)}% (${trueAutoPositives} tp / ${falsePositives.length} fp)`)
console.log(`AUTOMATIC RECALL (of ${expectedAutoPositives} expected auto-matchable): ${(recall * 100).toFixed(1)}%`)
console.log(`AUTOMATIC COVERAGE RATE (share of all expectations resolved auto): ${(automaticCoverageRate * 100).toFixed(1)}%`)
console.log(`AMBIGUITY RATE (share of all expectations left ambiguous): ${(ambiguityRate * 100).toFixed(1)}%`)
console.log(`AMBIGUITY ACCURACY (${ambiguousCorrect}/${ambiguousExpected} expected-ambiguous correctly flagged): ${(ambiguityAccuracy * 100).toFixed(1)}%`)
console.log(`NONE ACCURACY (${noneCorrect}/${noneExpected} expected-NONE correctly identified): ${(noneAccuracy * 100).toFixed(1)}%`)

console.log('\n--- Strongest signal behind each true automatic positive ---')
console.table(Object.fromEntries([...signalBreakdown.entries()].map(([type, v]) => [type, v.tp])))

if (falsePositives.length > 0) {
  console.log(`\n--- FALSE POSITIVES (${falsePositives.length}) — resolver auto-matched when it should not have ---`)
  for (const m of falsePositives) {
    console.log(`[${m.scenario}] ${m.logicalChannelId}: predicted ${m.predicted} ${JSON.stringify(m.predictedIds)}, expected ${m.expected} ${JSON.stringify(m.expectedIds)}`)
    console.log(`  ${m.explanation}`)
  }
}

if (falseNegatives.length > 0) {
  console.log(`\n--- FALSE NEGATIVES (${falseNegatives.length}) — resolver failed to auto-match when it should have ---`)
  for (const m of falseNegatives) {
    console.log(`[${m.scenario}] ${m.logicalChannelId}: predicted ${m.predicted} ${JSON.stringify(m.predictedIds)}, expected ${m.expected} ${JSON.stringify(m.expectedIds)}`)
    console.log(`  ${m.explanation}`)
  }
}

if (falsePositives.length === 0 && falseNegatives.length === 0) {
  console.log('\nAll gold cases matched expectations exactly.')
} else if (falsePositives.length === 0) {
  console.log('\nNo false positives — automatic precision is 100%. Recall gaps above are tracked, not gated (prefer precision).')
} else {
  console.log('\nQUALITY GATE FAILED: automatic precision below 100%. See FALSE POSITIVES above.')
  process.exitCode = 1
}
