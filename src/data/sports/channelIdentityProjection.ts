// Serializable identity-only projection of a runtime Channel — the shape
// that's actually safe to hand to a Web Worker (see channelIdentityWorker.ts)
// or log/export anywhere else. A full Channel carries ChannelSource entries
// (stream URLs, and for Xtream playlists those URLs embed the user's own
// credentials) that Channel Identity Resolver v2 never needs — it only ever
// reasons about names/ids/group-title, never how to play the stream. This
// module is the one place that decides which Channel fields cross that
// boundary, so "does the identity resolver ever see a stream URL" has a
// single, auditable answer.
import type { Channel } from '../channel'

export interface PlaylistChannelIdentitySource {
  epgChannelId?: string
  originalName?: string
}

export interface PlaylistChannelIdentity {
  id: string
  name: string
  groupTitle?: string
  epgChannelIds?: string[]
  rawNames?: string[]
  sources?: PlaylistChannelIdentitySource[]
}

// Deliberately an allow-list, not an omit-list — a future field added to
// Channel/ChannelSource (e.g. a new credential-bearing property) is safe by
// default here; it simply won't be copied over unless someone explicitly
// decides it's identity-relevant and adds it above.
export function projectChannelIdentity(channel: Channel): PlaylistChannelIdentity {
  return {
    id: channel.id,
    name: channel.name,
    groupTitle: channel.groupTitle,
    epgChannelIds: channel.epgChannelIds,
    rawNames: channel.rawNames,
    sources: channel.sources.map((s) => ({ epgChannelId: s.epgChannelId, originalName: s.originalName })),
  }
}
