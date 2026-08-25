// The persisted identity of ONE connected playlist. Pure — no storage, no
// network, no React — so every naming/label/provenance rule below is
// testable on its own (see playlistDefinition.test.ts).
//
// Ninety used to have exactly one playlist: a single PlaylistSourceRecord in
// localStorage plus a single cached Channel[] in IndexedDB (see
// data/session.ts's header). A "playlist" therefore had no identity of its
// own — it was simply "the" playlist. Supporting several means each one
// needs a stable id (to key its own channel cache, and to tag which
// playlist a playable stream actually came from) and a human-readable name
// (because two rows in Settings reading "Xtream" would be useless on a TV).
import type { Channel } from '../channel'
import type { PlaylistSourceRecord } from '../session'

export interface PlaylistDefinition {
  // Stable, opaque, generated once when the playlist is added and never
  // reused — this is what ChannelSource.playlistId points at and what keys
  // the playlist's own IndexedDB channel record.
  id: string
  // User-facing and user-editable. Defaulted from the source (see
  // defaultPlaylistName) purely so a freshly-added playlist is already
  // distinguishable without the user having to name it first.
  name: string
  source: PlaylistSourceRecord
  createdAt: number
  // Epoch ms of the last SUCCESSFUL sync (initial connect counts), or null
  // for a playlist whose channels have never been fetched successfully —
  // which in practice only happens for a file playlist restored from a
  // cache that later went stale.
  lastSyncedAt: number | null
  // Opaque id stamped per successful sync of THIS playlist — mirrors the
  // generationId stored alongside its cached channels so the two can be
  // compared without loading the (large) channel record.
  generationId: string
  // Channels this playlist contributed at its last successful sync. Stored
  // rather than derived so Settings can show a per-playlist count without
  // reading tens of thousands of channels back out of IndexedDB, and so the
  // count is still right for a playlist whose channels are currently
  // unavailable.
  channelCount: number
}

export function newPlaylistId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `pl-${crypto.randomUUID()}`
  return `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

// The hostname of an Xtream server / M3U URL, for display only. Falls back
// to null (never to the raw string) when the value isn't a parseable URL —
// a raw credential-bearing URL must never leak into a visible label.
export function playlistHostname(url: string): string | null {
  try {
    const host = new URL(url.trim()).hostname
    if (host) return host
  } catch {
    // Falls through to the bare-host heuristic below.
  }
  // Tolerates a scheme-less "provider.com:8080" the user may have typed into
  // the server field. Note this is NOT only the throwing case: URL() happily
  // parses "provider.com:8080" as scheme "provider.com" with an empty
  // hostname, so an empty result has to fall through here too. Everything up
  // to the first slash, minus any port, is hostname-shaped and carries no
  // credentials.
  const bare = url.trim().replace(/^\/+/, '').split('/')[0].split('?')[0].split(':')[0]
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(bare) ? bare : null
}

// Short, credential-free description of where a playlist comes from, shown
// under its name in Settings. NEVER includes a username, password, or a
// full URL with a query string.
export function playlistSourceLabel(source: PlaylistSourceRecord): string {
  if (source.type === 'xtream') {
    const host = playlistHostname(source.server)
    return host ? `Xtream · ${host}` : 'Xtream'
  }
  if (source.type === 'm3u-url') {
    const host = playlistHostname(source.url)
    return host ? `M3U URL · ${host}` : 'M3U URL'
  }
  return `M3U file · ${source.fileName}`
}

// Only Xtream and M3U-URL playlists can be re-fetched from what we stored;
// a file playlist's bytes were never kept (see session.ts's
// FileSourceRecord), so its Settings action says "Replace file" instead of
// pretending an automatic resync is possible.
export function isResyncable(source: PlaylistSourceRecord): boolean {
  return source.type !== 'file'
}

// A default display name that is already meaningful on a TV: the provider's
// hostname where one is safely derivable, the file's own name for a file
// upload, and a numbered fallback otherwise. `existingNames` keeps a second
// playlist from the same provider from being indistinguishable from the
// first — it gets a " (2)" suffix rather than a silent duplicate.
export function defaultPlaylistName(source: PlaylistSourceRecord, existingNames: readonly string[] = []): string {
  const base = defaultPlaylistBaseName(source, existingNames.length)
  const taken = new Set(existingNames)
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`
    if (!taken.has(candidate)) return candidate
  }
}

function defaultPlaylistBaseName(source: PlaylistSourceRecord, existingCount: number): string {
  if (source.type === 'file') return source.fileName.replace(/\.(m3u8?|txt)$/i, '') || 'M3U file'
  const host = playlistHostname(source.type === 'xtream' ? source.server : source.url)
  if (host) return host.replace(/^www\./i, '')
  return `Playlist ${existingCount + 1}`
}

// Stamps every playable source in `channels` with the playlist it came
// from. MUTATES in place, deliberately: this is only ever called on a
// channel array that was just produced by mergeChannelSources for this
// exact playlist (fresh connect, resync, or the one-time legacy migration),
// so nothing else can be holding a reference to those source objects — and
// at ~30,000 channels, cloning every channel and every source purely to add
// one field is real main-thread work for no benefit.
//
// Idempotent: re-stamping an already-stamped array with the same id is a
// no-op, so a migration that runs twice can't corrupt provenance.
export function stampPlaylistProvenance(channels: Channel[], playlistId: string): Channel[] {
  for (const channel of channels) {
    for (const source of channel.sources) source.playlistId = playlistId
  }
  return channels
}

// The identity of the COMBINED channel set across every connected playlist
// — used exactly where the old single global generationId was: as the
// "is this the same playlist data as last time" key for the channel
// identity resolver's cross-session resolution cache (see
// data/sports/channelIdentityResolutionCache.ts).
//
// Deterministic and content-free: it changes when a playlist is added,
// removed, reordered or resynced (each of which really does change the
// combined channel set) and is otherwise stable across launches, without
// hashing a single channel.
export function combinedGenerationId(playlists: readonly PlaylistDefinition[]): string | null {
  if (playlists.length === 0) return null
  return playlists.map((p) => `${p.id}:${p.generationId}`).join('|')
}
