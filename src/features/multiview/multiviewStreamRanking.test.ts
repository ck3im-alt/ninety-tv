import { describe, expect, it } from 'vitest'
import { selectMultiviewSource } from './multiviewStreamRanking'
import type { MultiviewSourceCandidate } from './multiviewCandidates'
import type { QualityTier } from '../eventDetails/rankStreamQuality'
import type { Channel } from '../../data/channel'

let counter = 0
function candidate(qualityTier: QualityTier, displayName = 'Channel'): MultiviewSourceCandidate {
  counter += 1
  const channel: Channel = { id: `ch-${counter}`, name: displayName, sources: [] }
  return {
    channel,
    source: { label: String(qualityTier), url: `http://x/${counter}` },
    qualityTier,
    qualityLabel: null,
    displayName,
  }
}

describe('selectMultiviewSource', () => {
  it('returns -1 for an empty candidate list', () => {
    expect(selectMultiviewSource([], 1)).toBe(-1)
  })

  it('prefers the best (8K) candidate for a single pane', () => {
    const candidates = [candidate(5), candidate(3), candidate(2)]
    expect(selectMultiviewSource(candidates, 1)).toBe(0)
  })

  it('caps at UHD (tier 4) for 2 panes, skipping an 8K best pick', () => {
    const candidates = [candidate(5), candidate(4), candidate(2)]
    expect(selectMultiviewSource(candidates, 2)).toBe(1)
  })

  it('caps at FHD (tier 3) for 3 panes, skipping both 8K and UHD', () => {
    const candidates = [candidate(5), candidate(4), candidate(3), candidate(1)]
    expect(selectMultiviewSource(candidates, 3)).toBe(2)
  })

  it('caps at FHD (tier 3) for 4 panes as well', () => {
    const candidates = [candidate(4), candidate(3)]
    expect(selectMultiviewSource(candidates, 4)).toBe(1)
  })

  it('never leaves a pane blank: falls back to the best overall candidate when nothing satisfies the ceiling', () => {
    const candidates = [candidate(5), candidate(4)]
    // 4 panes active, but only 4K/8K candidates exist — must still pick one
    // (the best-ranked one) rather than returning -1/no selection.
    expect(selectMultiviewSource(candidates, 4)).toBe(0)
  })

  it('picks the first candidate within the ceiling by existing rank order, not by re-sorting on quality alone', () => {
    // Both are within the 2-pane ceiling (tier <= 4) — the lower-quality one
    // is ranked first (e.g. preferred country beat a higher-quality
    // candidate in a different country during normal ranking), and that
    // existing order must be preserved, not overridden to prefer the higher
    // tier.
    const candidates = [candidate(2, 'Preferred country'), candidate(4, 'Other country')]
    expect(selectMultiviewSource(candidates, 2)).toBe(0)
  })
})
