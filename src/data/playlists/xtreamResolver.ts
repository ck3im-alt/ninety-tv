// Resolves which Xtream account a given playable stream belongs to.
//
// This replaces the single app-wide `xtreamCreds` App.tsx used to derive
// from "the" connected playlist. With more than one playlist that value is
// not just incomplete, it's actively wrong: Xtream stream ids are numeric
// and panel-local, so stream 123 exists on essentially every panel. Sending
// playlist B's stream id to playlist A's panel with A's credentials doesn't
// fail loudly — it cheerfully returns A's programme for a completely
// unrelated channel. Every Xtream-specific lookup therefore has to start
// from the SOURCE, not from the app.
//
// The resolver is intentionally a tiny interface rather than a playlist
// object threaded through the UI: consumers (Browse's preview EPG, Event
// Details' EPG fallback, Home's now-playing strip, Multiview's pane
// resolution) only ever need "credentials for this one stream", and passing
// them the whole playlist library would let them start depending on things
// they have no business knowing about.
import type { Channel, ChannelSource } from '../channel'
import type { PlaylistDefinition } from './playlistDefinition'
import type { XtreamCredentials } from '../xtream/types'

export interface XtreamCredentialResolver {
  // Credentials for the playlist this source came from, or null when that
  // playlist isn't an Xtream one (plain M3U/file playlists have no EPG API
  // at all) or the source carries no provenance.
  forSource(source: ChannelSource | null | undefined): XtreamCredentials | null
  // Whether ANY connected playlist is an Xtream one. Lets callers skip a
  // whole EPG stage up front instead of resolving credentials for dozens of
  // candidate channels only to find none of them can be looked up — the
  // same early-out the old `if (!xtreamCreds) return []` guard provided.
  readonly hasAny: boolean
}

// Shared no-op instance — a stable reference so it can sit in React
// dependency arrays (and be handed to components before the playlist
// library has hydrated) without invalidating memoized work every render.
export const NO_XTREAM_CREDENTIALS: XtreamCredentialResolver = {
  forSource: () => null,
  hasAny: false,
}

export function createXtreamCredentialResolver(playlists: readonly PlaylistDefinition[]): XtreamCredentialResolver {
  const byPlaylistId = new Map<string, XtreamCredentials>()
  for (const playlist of playlists) {
    if (playlist.source.type !== 'xtream') continue
    byPlaylistId.set(playlist.id, {
      server: playlist.source.server,
      username: playlist.source.username,
      password: playlist.source.password,
    })
  }
  if (byPlaylistId.size === 0) return NO_XTREAM_CREDENTIALS

  return {
    forSource: (source) => (source?.playlistId ? (byPlaylistId.get(source.playlistId) ?? null) : null),
    hasAny: true,
  }
}

// The first source of `channel` that can actually be looked up on an Xtream
// panel, together with the credentials to do it with.
//
// Callers used to just take `channel.sources[0]` and pair it with the one
// global credential object. That is no longer sound: after cross-playlist
// merging, sources[0] can belong to a plain M3U playlist while a later
// source is the Xtream one — taking the first source would silently drop
// EPG for a channel that does have it, and (before provenance existed)
// could pair one panel's stream id with another panel's credentials.
export function firstXtreamSource(
  channel: Channel,
  resolver: XtreamCredentialResolver,
  extractStreamId: (url: string) => number | null,
): { source: ChannelSource; creds: XtreamCredentials; streamId: number } | null {
  for (const source of channel.sources) {
    const creds = resolver.forSource(source)
    if (!creds) continue
    const streamId = extractStreamId(source.url)
    if (streamId === null) continue
    return { source, creds, streamId }
  }
  return null
}
