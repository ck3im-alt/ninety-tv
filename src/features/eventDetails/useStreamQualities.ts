// Probes real stream quality for a set of candidate channel groups so they
// can be ranked by what's actually being delivered rather than name alone
// (see streamQuality.ts). Only worth doing when there's an actual choice to
// rank between — bounded concurrency because probing opens a real
// connection to the user's IPTV panel per candidate, and Tizen hardware is
// resource-constrained. Probes each group's first source only — the badge
// represents the group's best-guess pick, not every source inside it.
import { useEffect, useState } from 'react'
import { probeStreamQuality } from '../../data/streamQuality'
import type { StreamQuality } from '../../data/streamQuality'
import type { MatchGroup } from './groupChannelMatches'

const PROBE_CONCURRENCY = 3
// A single candidate has nothing to be ranked against, so skip spending a
// real connection on it purely for a quality badge nobody needs to compare.
const MIN_GROUPS_TO_PROBE = 2

export type QualityState = StreamQuality | null | 'loading'
export type QualityByGroup = Map<string, QualityState>

export function useStreamQualities(groups: MatchGroup[]): QualityByGroup {
  const [qualities, setQualities] = useState<QualityByGroup>(new Map())
  const groupKey = groups.map((g) => g.key).join(',')

  useEffect(() => {
    if (groups.length < MIN_GROUPS_TO_PROBE) {
      setQualities(new Map())
      return
    }
    let cancelled = false
    setQualities(new Map(groups.map((g) => [g.key, 'loading' as const])))

    async function probeOne(group: MatchGroup) {
      const source = group.sourceOptions[0]?.source
      const result = source ? await probeStreamQuality(source.url) : null
      if (cancelled) return
      setQualities((prev) => new Map(prev).set(group.key, result))
    }

    let nextIndex = 0
    async function worker() {
      while (nextIndex < groups.length) {
        const group = groups[nextIndex++]
        await probeOne(group)
      }
    }
    void Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, groups.length) }, worker))

    return () => {
      cancelled = true
    }
  }, [groupKey])

  return qualities
}
