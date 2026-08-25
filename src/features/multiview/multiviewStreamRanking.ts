// Multiview-aware source selection — layered purely over the existing
// text-pattern quality tiers (rankStreamQuality.ts), since no real
// bitrate/codec measurement exists anywhere in this app (see
// data/streamQuality.ts's unused probeStreamQuality, and its own comment on
// why probing was rejected: it would burn concurrent-connection slots
// before the user even presses Play — exactly the risk Multiview would
// multiply by up to 4x). The rule: don't automatically start a very
// high-bitrate-implying stream (4K/8K) just because it ranks highest for
// single-stream playback, once several panes are decoding at once.
import type { QualityTier } from '../eventDetails/rankStreamQuality'
import type { MultiviewSourceCandidate } from './multiviewCandidates'

// Deterministic tier ceiling by how many panes are actively decoding right
// now. Not meant as a precise hardware measurement — see the plan's Tizen
// research note: no public source gives an exact concurrent-decoder count
// for this platform, so this is a conservative, testable default posture,
// not a claim about what the hardware can or can't do.
function tierCeilingForPaneCount(activePaneCount: number): QualityTier {
  if (activePaneCount <= 1) return 5
  if (activePaneCount === 2) return 4
  return 3 // 3-4 panes
}

// Picks the index of the best candidate that satisfies the tier ceiling for
// the given pane count. `candidates` is expected pre-ranked best-first by
// the EXISTING, non-Multiview-aware ranking (country/confidence/favorite,
// then quality — see rankEventStreamOptions) — this only re-filters that
// order by a quality ceiling, it never re-sorts by anything else. Never
// picks an index that would leave the pane blank: if nothing satisfies the
// ceiling, falls back to the single best candidate overall (index 0).
// Returns -1 only when there are no candidates at all.
export function selectMultiviewSource(candidates: readonly MultiviewSourceCandidate[], activePaneCount: number): number {
  if (candidates.length === 0) return -1
  const ceiling = tierCeilingForPaneCount(activePaneCount)
  const withinCeiling = candidates.findIndex((candidate) => candidate.qualityTier <= ceiling)
  return withinCeiling !== -1 ? withinCeiling : 0
}
