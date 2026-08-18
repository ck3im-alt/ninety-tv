export interface ChannelSource {
  label: string // quality tag, e.g. "RAW", "UHD", "HD" — or "Default" when the source list had no quality suffix at all
  url: string
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
  // Whether ANY of this channel's merged source entries carried a source
  // EPG-channel id (M3U tvg-id / Xtream epg_channel_id) — see RawChannel.
  // Absence is a structural (not name/text-based) signal that this is
  // likely a synthetically-generated one-off entry rather than a stable
  // linear channel the provider maintains an EPG mapping for.
  hasEpgChannelId?: boolean
}
