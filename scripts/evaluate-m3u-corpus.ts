// Evaluates the realistic "dirty" IPTV/M3U channel-name corpus
// (fixtures/m3u-corpus/cases.ts) against a real snapshot of ninety-api's
// live channel catalog (fixtures/m3u-corpus/catalog-snapshot.json, fetched
// 2026-08-20 from GET /v1/channels/catalog) through the real Channel
// Identity Resolver v2 pipeline (normalizeChannelName -> mergeChannelSources
// -> resolveChannelIdentities). DB-free, network-free.
//
// Each corpus case is evaluated as a SINGLE playlist channel against the
// WHOLE real catalog (not just its own market) so the resolver's
// disambiguation/negative-signal logic is genuinely exercised, not given
// an artificially narrow candidate pool.
//
// Prints a per-market table (Cases / Correct / Ambiguous / Failed) plus the
// detail for every non-Correct case, for the M3U-matching validation task.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mergeChannelSources } from '../src/features/channels/mergeChannels.ts'
import { resolveChannelIdentities } from '../src/data/sports/channelIdentityResolver.ts'
import type { NinetyLogicalChannel } from '../src/data/sports/ninetyApiClient.ts'
import type { RawChannel } from '../src/data/rawChannel.ts'
import { M3U_CORPUS } from '../fixtures/m3u-corpus/cases.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const catalog: NinetyLogicalChannel[] = JSON.parse(readFileSync(join(__dirname, '../fixtures/m3u-corpus/catalog-snapshot.json'), 'utf8'))

type Outcome = 'CORRECT' | 'AMBIGUOUS' | 'FAILED'

interface CaseResult {
  market: string
  playlistName: string
  expected: string | null
  outcome: Outcome
  detail: string
}

const results: CaseResult[] = []

for (const c of M3U_CORPUS) {
  const raw: RawChannel[] = [{ id: 'corpus-entry', name: c.playlistName, url: 'http://example.invalid/stream' }]
  const [channel] = mergeChannelSources(raw)
  const resolutions = resolveChannelIdentities(catalog, [channel])

  if (c.expectedLogicalChannelId === null) {
    const anyConfirmed = [...resolutions.values()].some((r) => r.classification === 'CONFIRMED' || r.classification === 'STRONG')
    results.push({
      market: c.market,
      playlistName: c.playlistName,
      expected: null,
      outcome: anyConfirmed ? 'FAILED' : 'CORRECT',
      detail: anyConfirmed ? 'unexpected auto-match on a case with no expected target' : 'correctly produced no auto-match',
    })
    continue
  }

  const res = resolutions.get(c.expectedLogicalChannelId)
  const classification = res?.classification ?? 'NONE'
  const matchedThisChannel = (res?.matches ?? []).some((m) => m.playlistChannelId === channel.id)

  let outcome: Outcome
  let detail: string
  if ((classification === 'CONFIRMED' || classification === 'STRONG') && matchedThisChannel) {
    outcome = 'CORRECT'
    detail = `${classification} (canonical="${channel.name}", quality="${channel.sources[0].label}")`
  } else if (classification === 'AMBIGUOUS') {
    outcome = 'AMBIGUOUS'
    detail = `runner-up margin=${res?.margin ?? 'n/a'}, candidates=[${(res?.matches ?? []).map((m) => m.playlistChannelId).join(', ')}]`
  } else {
    outcome = 'FAILED'
    detail = `expected ${c.expectedLogicalChannelId}, got classification=${classification} (canonical="${channel.name}")`
  }
  results.push({ market: c.market, playlistName: c.playlistName, expected: c.expectedLogicalChannelId, outcome, detail })
}

const byMarket = new Map<string, { cases: number; correct: number; ambiguous: number; failed: number }>()
for (const r of results) {
  const bucket = byMarket.get(r.market) ?? { cases: 0, correct: 0, ambiguous: 0, failed: 0 }
  bucket.cases++
  if (r.outcome === 'CORRECT') bucket.correct++
  else if (r.outcome === 'AMBIGUOUS') bucket.ambiguous++
  else bucket.failed++
  byMarket.set(r.market, bucket)
}

console.log('Market | Cases | Correct | Ambiguous | Failed')
console.log('------ | ----: | ------: | --------: | -----:')
let totals = { cases: 0, correct: 0, ambiguous: 0, failed: 0 }
for (const [market, b] of [...byMarket.entries()].sort()) {
  console.log(`${market} | ${b.cases} | ${b.correct} | ${b.ambiguous} | ${b.failed}`)
  totals.cases += b.cases
  totals.correct += b.correct
  totals.ambiguous += b.ambiguous
  totals.failed += b.failed
}
console.log(`TOTAL | ${totals.cases} | ${totals.correct} | ${totals.ambiguous} | ${totals.failed}`)

console.log('\n--- non-CORRECT cases ---')
for (const r of results.filter((r) => r.outcome !== 'CORRECT')) {
  console.log(`[${r.outcome}] ${r.market} "${r.playlistName}" -> ${r.detail}`)
}
