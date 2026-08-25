// Folds several playlists' already-merged Channel[] into the single
// combined channel set the rest of the app consumes.
//
// This deliberately does NOT introduce a second channel-identity system.
// features/channels/mergeChannels.ts already decides what "the same logical
// channel" means (canonical tag-stripped name within its merged country +
// category) and encodes that decision as Channel.id — the merge key IS the
// id. So combining across playlists is exactly: group by Channel.id.
//
// The consequence is the intended product behaviour: if playlist A and
// playlist B both carry "TNT SPORTS 1", Browse shows ONE row, and that row
// offers BOTH providers' streams (A's FHD and B's UHD), each still tagged
// with the playlist it came from so EPG lookups hit the right panel. A
// stream is never dropped just because another playlist had a similar one.
import type { Channel } from '../channel'

export interface LoadedPlaylistChannels {
  playlistId: string
  channels: Channel[]
}

// Order is deterministic and stable across launches: playlists are combined
// in library order, and within that, each playlist's own channel order is
// preserved. A channel first seen in playlist A keeps A's position even
// when B also carries it — so adding a second playlist never reshuffles the
// browse order of the first.
export function combinePlaylistChannels(playlists: readonly LoadedPlaylistChannels[]): Channel[] {
  // Fast path — by far the common case (one connected playlist). Returns
  // the SAME array reference it was given, which matters: getChannelIndex
  // and the identity-resolver hook both memoize on that reference, so
  // rebuilding an identical copy here would silently throw away a warmed
  // ~30,000-channel index.
  if (playlists.length === 0) return EMPTY_CHANNELS
  if (playlists.length === 1) return playlists[0].channels

  const byId = new Map<string, Channel>()
  const order: string[] = []

  for (const playlist of playlists) {
    for (const channel of playlist.channels) {
      const existing = byId.get(channel.id)
      if (!existing) {
        // Copied rather than referenced: a later playlist may still merge
        // into this entry, and mutating the array that IndexedDB record
        // handed us would corrupt that playlist's own cached channels.
        byId.set(channel.id, {
          ...channel,
          sources: [...channel.sources],
          epgChannelIds: channel.epgChannelIds ? [...channel.epgChannelIds] : undefined,
          rawNames: channel.rawNames ? [...channel.rawNames] : undefined,
        })
        order.push(channel.id)
        continue
      }
      mergeInto(existing, channel)
    }
  }

  return order.map((id) => byId.get(id)!)
}

const EMPTY_CHANNELS: Channel[] = []

function mergeInto(target: Channel, incoming: Channel): void {
  // Every playable stream survives. Deduplicated by URL only — the same
  // exact URL appearing twice would be one stream listed twice, but two
  // different providers' URLs for the same channel are two genuinely
  // different streams and both stay selectable.
  const seenUrls = new Set(target.sources.map((s) => s.url))
  for (const source of incoming.sources) {
    if (seenUrls.has(source.url)) continue
    seenUrls.add(source.url)
    target.sources.push(source)
  }

  target.epgChannelIds = unioned(target.epgChannelIds, incoming.epgChannelIds)
  target.rawNames = unioned(target.rawNames, incoming.rawNames)
  // Recomputed, never OR-ed from the inputs: hasEpgChannelId is documented
  // (see channel.ts) as "epgChannelIds is non-empty", and channelMatch.ts
  // reads it as a structural signal. Deriving it from the merged list keeps
  // that invariant true by construction.
  target.hasEpgChannelId = (target.epgChannelIds?.length ?? 0) > 0
  // First non-empty wins for display fields — the first playlist that
  // carried this channel defines how it looks, so adding a second playlist
  // never changes an existing channel's name or logo.
  if (!target.logo && incoming.logo) target.logo = incoming.logo
  if (!target.groupTitle && incoming.groupTitle) target.groupTitle = incoming.groupTitle
}

function unioned(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (!a?.length) return b?.length ? [...b] : a
  if (!b?.length) return a
  const seen = new Set(a)
  const result = [...a]
  for (const value of b) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}
