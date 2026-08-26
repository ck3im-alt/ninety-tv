// Adapters that turn Multiview's two pane-assignment shapes (a resolved
// event, or a plain playlist channel) into one uniform, pre-ranked list of
// selectable sources — reusing Event Details' own resolution/ranking output
// (buildEventStreamOptions.ts) and quality-dedup logic rather than
// reimplementing either. See multiviewStreamRanking.ts for how a pane picks
// an initial index out of this list, and multiviewSession.ts for how a pane
// stores it.
import { dedupeSourcesByTier } from '../eventDetails/buildEventStreamOptions'
import type { PartitionedStreamOptions } from '../eventDetails/buildEventStreamOptions'
import type { QualityTier } from '../eventDetails/rankStreamQuality'
import type { EventStreamDisplayParts } from '../eventDetails/ppvDisplayName'
import type { Channel, ChannelSource } from '../../data/channel'

export interface MultiviewSourceCandidate {
  channel: Channel
  source: ChannelSource
  qualityTier: QualityTier
  qualityLabel: string | null
  // The owning broadcaster's normalized display identity (see
  // ppvDisplayName.ts) — carried per-candidate since Multiview flattens
  // across several distinct broadcasters into one selectable list, unlike
  // Event Details' own per-broadcaster StreamRow.
  displayName: string
  displayParts?: EventStreamDisplayParts
}

// Flattens Event Details' own ranked/partitioned stream options into one
// ordered "Change source" list for a Multiview pane — every trusted
// (confirmed/likely) broadcaster's own quality variants, in the exact order
// rankEventStreamOptions/dedupeSourcesByTier already produced. Deliberately
// excludes 'candidate' (loose/fuzzy) confidence matches, same as Event
// Details never auto-recommending one — those stay reachable via the full
// Event Details screen, not duplicated into Multiview.
export function flattenTrustedCandidates(partitioned: PartitionedStreamOptions): MultiviewSourceCandidate[] {
  return partitioned.trusted.flatMap((option) =>
    // One entry per quality tier — a pane picks by a quality CEILING (see
    // selectMultiviewSource), so a same-tier mirror would only ever be a
    // duplicate row in the pane's "Change source" list. The primary
    // candidate is the deterministic representative, exactly what this
    // consumed before quality variants gained candidate lists.
    option.qualityVariants.map((variant) => ({
      channel: variant.candidates[0].channel,
      source: variant.candidates[0].source,
      qualityTier: variant.qualityTier,
      qualityLabel: variant.qualityLabel,
      displayName: option.displayName,
      displayParts: option.displayParts,
    })),
  )
}

// A plain channel added without any event context (Multiview's Channels
// tab, or the direct hand-off from the single-stream player when it wasn't
// playing from Event Details) has no broadcaster/event identity to show —
// just its own quality-variant sources, exactly like ChannelPlayerScreen's
// existing Source popup.
export function channelToMultiviewCandidates(channel: Channel): MultiviewSourceCandidate[] {
  return dedupeSourcesByTier(channel.sources.map((source) => ({ channel, source }))).map((sourceOption) => ({
    channel: sourceOption.channel,
    source: sourceOption.source,
    qualityTier: sourceOption.qualityTier,
    qualityLabel: sourceOption.qualityLabel,
    displayName: channel.name,
    displayParts: undefined,
  }))
}
