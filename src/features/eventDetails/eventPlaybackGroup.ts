// What Event Details hands to playback when the user presses Watch now.
//
// The old hand-off was (channel, source, displayParts) — one Channel and one
// ChannelSource. That was already lossy before this pass (the player could
// only ever offer the sources belonging to that ONE Channel object), and it
// became actively wrong once a display row could span several playlist
// Channels resolved to the same logical broadcaster: the other quality
// variants the row had already collapsed were simply unreachable once
// playback started.
//
// So the unit of playback is the same unit the user actually chose: the
// logical stream GROUP, with every quality it resolved to, best-first, and
// every interchangeable playback candidate behind each of those qualities
// (see buildEventStreamOptions.ts's groupSourcesByTier). Two levels, not
// one, because they answer different questions: the quality list is what
// the viewer picks from, the candidate list is what the player fails over
// between WITHOUT changing what the viewer picked.
import type { EventStreamOption, EventStreamQualityVariant } from './buildEventStreamOptions'
import type { EventStreamDisplayParts } from './ppvDisplayName'

export interface EventPlaybackGroup {
  // The originating EventStreamOption.key — stable identity for this logical
  // stream, useful for keying/debugging playback back to the row it came
  // from.
  key: string
  displayName: string
  // Structured contextual identity (provider/event/start time/quality) — the
  // player recomposes its overlay line from these parts plus the CURRENTLY
  // ACTIVE variant's quality, never the quality baked in at watch time.
  displayParts: EventStreamDisplayParts
  // Best quality first; variants[0] is the correct initial selection, and
  // within it candidates[0] is the primary stream to open. Never empty for
  // a group that produced a playable row.
  variants: EventStreamQualityVariant[]
}

// A pure projection of the row the user selected — no re-ranking, no
// re-deriving quality, no reaching back into the playlist.
export function toEventPlaybackGroup(option: EventStreamOption): EventPlaybackGroup {
  return {
    key: option.key,
    displayName: option.displayName,
    displayParts: option.displayParts,
    variants: option.qualityVariants,
  }
}
