export interface ChannelSource {
  label: string // quality tag, e.g. "RAW", "UHD", "HD" — or "Default" when the source list had no quality suffix at all
  url: string
  // This specific source entry's own EPG-channel identity (M3U tvg-id /
  // Xtream epg_channel_id), carried over from RawChannel.epgChannelId.
  // Kept per-source (not just rolled up into Channel.epgChannelIds) so a
  // future matcher can tell which quality variant a given id came from.
  epgChannelId?: string
  // The raw provider-listed name this source entry had before merge-key
  // normalization (see mergeChannels.ts) — e.g. "UK | TNT SPORTS 1 FHD".
  originalName?: string
}

// Logical channel after merging quality-variant duplicates from the raw
// playlist (see mergeChannels.ts) — one entry per real channel, with every
// quality variant available as a selectable source.
export interface Channel {
  id: string
  name: string
  logo?: string
  groupTitle?: string
  sources: ChannelSource[]
  // Every distinct source EPG-channel id (M3U tvg-id / Xtream
  // epg_channel_id) carried by this channel's merged source entries,
  // deduplicated. Empty/absent when none of the sources had one.
  // Source-specific ids are still available per-entry on
  // ChannelSource.epgChannelId; this is the rolled-up view for
  // whole-channel identity signals. Optional (rather than always-present
  // empty array) so hand-built Channel literals elsewhere — mostly tests —
  // don't all need updating; mergeChannelSources always sets it.
  epgChannelIds?: string[]
  // Every distinct raw/original provider name that merged into this
  // channel (e.g. both "UK | TNT SPORTS 1 FHD" and "UK | TNT SPORT 1 UHD"),
  // in first-seen order — useful for identity matching against a catalog
  // that may know a channel by a provider-specific name we've since
  // normalized away. Optional for the same reason as epgChannelIds above.
  rawNames?: string[]
  // Whether ANY of this channel's merged source entries carried a source
  // EPG-channel id — derived from epgChannelIds.length > 0. Kept as its
  // own field (rather than requiring every call site to check
  // epgChannelIds.length) since existing code already reads this as a
  // structural signal that this is likely a synthetically-generated
  // one-off entry rather than a stable linear channel the provider
  // maintains an EPG mapping for — see channelMatch.ts's PPV matching.
  hasEpgChannelId?: boolean
}
