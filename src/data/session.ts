// Persisted "reconnect" state — the connected playlist and the Channels
// filter selection. Lets the app skip straight back to Home/Channels on
// reload instead of re-running setup/onboarding every time. Same
// localStorage-is-enough reasoning as preferences.ts: single-device data,
// nothing that needs to sync or survive a reinstall.
//
// The playlist is split across two keys rather than one:
//   - "source" (how to reconnect: Xtream creds, an M3U URL, or — for a
//     file upload — just enough metadata to explain a reconnect is needed)
//     is a few hundred bytes and effectively never fails to write.
//   - "channels" (the merged Channel[]) is the one part of this file that
//     can get large — a big IPTV playlist can be tens of thousands of
//     entries, tens of KB to low-MB of JSON — and is therefore the one
//     realistically at risk of hitting a storage quota on some Tizen Web
//     Runtime versions.
//
// Splitting them means a channel-cache write failure doesn't also lose the
// (tiny, essentially free) source record. For Xtream and M3U-URL sources
// that source record is enough to automatically refetch and rebuild the
// channel cache without asking the user to type anything again — see
// loadPlaylistState()'s 'source-available-cache-missing'/'-invalid' cases
// and src/data/playlistRecovery.ts, which App.tsx drives on startup. A
// file-upload source can't be auto-reacquired (we never keep the file's
// contents around after the initial parse), so that case is reported
// separately ('unrecoverable-file-source') and the UI asks the user to
// re-add the file instead of pretending it can recover on its own.
//
// The source and channel-cache records carry their own, independent
// PLAYLIST_SOURCE_SCHEMA_VERSION / PLAYLIST_CHANNELS_SCHEMA_VERSION so a
// future change to the merge/normalization logic (see mergeChannels.ts)
// can bump just the channels version and have old cached entries safely
// ignored (treated as absent, re-fetched) without also throwing away a
// perfectly good, unrelated source record.
//
// Xtream credentials and M3U URLs are stored as plain JSON here, same as
// everything else in this file. That's a deliberate choice, not an
// oversight: a Tizen (or any) web app has no OS keychain / secure-enclave
// API available to it, and Web Crypto's SubtleCrypto can only encrypt with
// a key that itself has to live somewhere on-device readable by this same
// origin — so it adds code without changing what's actually recoverable
// via devtools/the filesystem. Given the threat model here (single-user
// family TV, IPTV panel creds, not a banking credential), that obfuscation
// isn't worth the complexity. What actually matters — never sending these
// off-device to ninety-api — is already true (see xtream/xtreamClient.ts
// and playlistRecovery.ts: both talk directly to the user's own Xtream
// panel / M3U host, not through our backend).

import { readStored, writeStored } from '../core/storage/localStore'
import type { Channel } from './channel'
import type { XtreamCredentials } from './xtream/types'

const PLAYLIST_SOURCE_KEY = 'ninety.playlist.source'
const PLAYLIST_CHANNELS_KEY = 'ninety.playlist.channels'
const FILTERS_KEY = 'ninety.channelFilters'

// Bump when the *source record* shape changes in a way that makes
// previously-stored source records unreadable/unsafe to reconnect with.
// Independent of PLAYLIST_CHANNELS_SCHEMA_VERSION on purpose — see header.
const PLAYLIST_SOURCE_SCHEMA_VERSION = 1

// Bump when Channel's shape or the merge/normalization logic changes in a
// way that makes previously-cached channels stale or invalid.
const PLAYLIST_CHANNELS_SCHEMA_VERSION = 1

// How to reconnect a playlist without the user retyping anything, for the
// two source kinds that support it — plus a third kind that deliberately
// does NOT pretend to support it. Kept as a discriminated union (rather
// than reusing XtreamCredentials directly) so a file-upload source is a
// distinct, type-checked case instead of a null/undefined XtreamCredentials
// that looks like "no source" from the type system's point of view.
export interface XtreamSourceRecord {
  type: 'xtream'
  server: string
  username: string
  password: string
}

export interface M3uUrlSourceRecord {
  type: 'm3u-url'
  url: string
}

// No file contents here, ever — only enough to explain to the user what
// needs reconnecting. See loadPlaylistState()'s 'unrecoverable-file-source'
// outcome: this source type is never auto-refetched.
export interface FileSourceRecord {
  type: 'file'
  fileName: string
}

export type PlaylistSourceRecord = XtreamSourceRecord | M3uUrlSourceRecord | FileSourceRecord

interface StoredPlaylistSource {
  version: number
  source: PlaylistSourceRecord
}

interface StoredPlaylistChannels {
  version: number
  channels: Channel[]
}

// The five outcomes loading persisted playlist state can land on:
//   - ready: valid cache (+ source, when one was recorded) — use it as-is.
//   - source-available-cache-missing: cache was never written (e.g. this is
//     the very first load after a channel-cache write failure) but the
//     source is intact — auto-recoverable for xtream/m3u-url.
//   - source-available-cache-invalid: cache exists but its version is
//     stale — same recovery path as above, just a different cause.
//   - unrecoverable-file-source: the only source on record is a file
//     upload and there's no valid cache — nothing to auto-refetch from,
//     the UI must ask the user to re-add the file.
//   - no-source: nothing usable was ever persisted (or it's all been
//     cleared) — normal first-run / post-reset state.
export type PlaylistState =
  | { kind: 'ready'; channels: Channel[]; source: PlaylistSourceRecord | null }
  | { kind: 'source-available-cache-missing'; source: XtreamSourceRecord | M3uUrlSourceRecord }
  | { kind: 'source-available-cache-invalid'; source: XtreamSourceRecord | M3uUrlSourceRecord }
  | { kind: 'unrecoverable-file-source'; source: FileSourceRecord }
  | { kind: 'no-source' }

export function loadPlaylistState(): PlaylistState {
  const storedSource = readStored<StoredPlaylistSource | null>(PLAYLIST_SOURCE_KEY, null)
  const storedChannels = readStored<StoredPlaylistChannels | null>(PLAYLIST_CHANNELS_KEY, null)

  const source =
    storedSource && storedSource.version === PLAYLIST_SOURCE_SCHEMA_VERSION ? storedSource.source : null
  const cacheValid = storedChannels != null && storedChannels.version === PLAYLIST_CHANNELS_SCHEMA_VERSION

  if (cacheValid) {
    return { kind: 'ready', channels: storedChannels.channels, source }
  }
  if (!source) {
    return { kind: 'no-source' }
  }
  if (source.type === 'file') {
    return { kind: 'unrecoverable-file-source', source }
  }
  return {
    kind: storedChannels == null ? 'source-available-cache-missing' : 'source-available-cache-invalid',
    source,
  }
}

// Backward/simple-compatible helper for call sites that only care about
// "do we have a usable, connected-EPG-capable Xtream session right now" —
// EPG (get_short_epg) only exists on the Xtream JSON API, so a plain M3U
// or file source never has one.
export function xtreamCredsFromSource(source: PlaylistSourceRecord | null): XtreamCredentials | null {
  if (!source || source.type !== 'xtream') return null
  return { server: source.server, username: source.username, password: source.password }
}

// Returns whether both parts persisted. The channel cache (the large,
// quota-risky part) is written first — if it fails, the caller should
// treat this playlist as not durably saved, and callers that care can log
// or surface that instead of assuming a reload will find it. Critically,
// the source record is still written (and still returned as part of a
// combined success/failure signal only for the caller's own bookkeeping)
// even when the channel-cache write fails, so a subsequent reload can find
// 'source-available-cache-missing' and recover instead of 'no-source'.
export function savePlaylist(channels: Channel[], source: PlaylistSourceRecord | null): boolean {
  const channelsOk = writeStored<StoredPlaylistChannels>(PLAYLIST_CHANNELS_KEY, {
    version: PLAYLIST_CHANNELS_SCHEMA_VERSION,
    channels,
  })
  if (!source) return channelsOk
  const sourceOk = writeStored<StoredPlaylistSource>(PLAYLIST_SOURCE_KEY, {
    version: PLAYLIST_SOURCE_SCHEMA_VERSION,
    source,
  })
  return channelsOk && sourceOk
}

// Clears only the cached, already-merged channel list — not onboarding,
// preferences, or the Channels filter selection. Needed because the merge
// (country-prefix stripping, quality-tag collapsing — see mergeChannels.ts)
// runs once at connect time and is cached here; a normalization fix
// landing later (e.g. recognizing a new country-code prefix) has no effect
// on an already-cached playlist until it's re-fetched and re-merged. The
// full "Reset onboarding & preferences" admin action already covered this
// as a side effect of wiping everything, but that's a bigger hammer than
// this specific, common need.
export function clearPlaylist(): void {
  try {
    localStorage.removeItem(PLAYLIST_SOURCE_KEY)
    localStorage.removeItem(PLAYLIST_CHANNELS_KEY)
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

interface StoredFilters {
  hiddenCountries: string[]
  hiddenCategories: string[]
}

const EMPTY_FILTERS: StoredFilters = { hiddenCountries: [], hiddenCategories: [] }

export function loadFilters(): StoredFilters {
  return readStored(FILTERS_KEY, EMPTY_FILTERS)
}

export function saveFilters(hiddenCountries: Set<string>, hiddenCategories: Set<string>): void {
  writeStored<StoredFilters>(FILTERS_KEY, {
    hiddenCountries: [...hiddenCountries],
    hiddenCategories: [...hiddenCategories],
  })
}

// Favorites/recently-watched were, until now, purely in-memory App.tsx
// state — never written here, so they silently reset on every reload
// (including the admin panel's "Resync playlist" and plain dev-server
// restarts). That was flagged as a known, accepted gap several times
// through the project's history, but having it actually bite mid-session
// (a user losing real favorites they'd just set) made clear it should
// just be fixed rather than accepted again. Same localStorage pattern as
// the playlist/filters above.
const FAVORITE_CHANNELS_KEY = 'ninety.favoriteChannels'
const FAVORITE_CATEGORIES_KEY = 'ninety.favoriteCategories'
const RECENTLY_WATCHED_KEY = 'ninety.recentlyWatched'

export function loadFavoriteChannels(): Set<string> {
  return new Set(readStored<string[]>(FAVORITE_CHANNELS_KEY, []))
}

export function saveFavoriteChannels(favoriteChannels: Set<string>): void {
  writeStored<string[]>(FAVORITE_CHANNELS_KEY, [...favoriteChannels])
}

export function loadFavoriteCategories(): Set<string> {
  return new Set(readStored<string[]>(FAVORITE_CATEGORIES_KEY, []))
}

export function saveFavoriteCategories(favoriteCategories: Set<string>): void {
  writeStored<string[]>(FAVORITE_CATEGORIES_KEY, [...favoriteCategories])
}

export function loadRecentlyWatched(): string[] {
  return readStored<string[]>(RECENTLY_WATCHED_KEY, [])
}

export function saveRecentlyWatched(recentlyWatched: string[]): void {
  writeStored<string[]>(RECENTLY_WATCHED_KEY, recentlyWatched)
}
