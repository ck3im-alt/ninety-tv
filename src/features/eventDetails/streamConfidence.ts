// Derives a UI-facing trust tier from a ChannelMatch's existing evidence
// (source stage + isExactMatch/identityClassification) — a display/ranking
// concern layered on top of channelMatch.ts's matching truth, not a change
// to it (see the Event Details redesign task: "do not alter resolver truth
// semantics just to make the UI easier").
//
// 'confirmed' — genuinely exact identity: a Ninety CONFIRMED resolution, or
//   an exact broadcaster-map channel-name match (namesExactMatch). Both
//   already set ChannelMatch.isExactMatch, so this is a direct read of it.
// 'likely' — a real, automatically-watchable match that isn't a literal
//   exact-identity one: Ninety STRONG (structured/fuzzy resolver signal),
//   a PPV listing whose name contains both team names and a plausible
//   date, or a primary-stage EPG listing containing both team names near
//   kickoff. All specific, event-level evidence — trustworthy enough to
//   recommend, not loose guessing.
// 'candidate' — a loose broadcaster-map word-overlap match (numbered/
//   sibling channel, kept as a fallback candidate rather than a
//   recommendation), or the widened last-resort PPV-EPG search (partial
//   word overlap, not a full team-name match — see channelMatch.ts's
//   matchViaEpgAllPpv and isWeakEpgMatch).
import type { ChannelMatch } from '../../data/sports/channelMatch'

export type StreamMatchConfidence = 'confirmed' | 'likely' | 'candidate'

const RANK: Record<StreamMatchConfidence, number> = { confirmed: 2, likely: 1, candidate: 0 }

export function confidenceRank(confidence: StreamMatchConfidence): number {
  return RANK[confidence]
}

export function matchConfidence(match: ChannelMatch): StreamMatchConfidence {
  if (match.isExactMatch) return 'confirmed'
  if (match.source === 'ninety') return 'likely' // STRONG — CONFIRMED already returned above
  if (match.source === 'ppvName') return 'likely'
  if (match.source === 'epg') return match.isWeakEpgMatch ? 'candidate' : 'likely'
  return 'candidate' // broadcasterMap: namesOverlap without namesExactMatch
}
