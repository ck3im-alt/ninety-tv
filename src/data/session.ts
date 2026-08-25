// Persisted "reconnect" state — the LEGACY single-playlist record, plus the
// Channels filter selection, favorites and recently-watched. Same
// localStorage-is-enough reasoning as preferences.ts: single-device data,
// nothing that needs to sync or survive a reinstall.
//
// SINCE MULTI-PLAYLIST (see data/playlists/): the connected playlist is no
// longer stored here. data/playlists/playlistLibraryStore.ts owns the
// library index and core/storage/idbPlaylistChannelStore.ts owns one channel
// record per playlist. What remains of the old single-playlist
// representation in this file — loadPlaylistSource/saveSource,
// PLAYLIST_CHANNELS_SCHEMA_VERSION, removeLegacyPlaylistChannelsCache — is
// kept for exactly one reason: the one-time migration in
// data/playlists/playlistMigration.ts has to be able to READ what previous
// versions of Ninety wrote. Nothing writes a new single-playlist record
// anymore.
//
// PlaylistSourceRecord itself is NOT legacy: it's still the canonical
// "how do we reconnect this" type, now held per playlist by
// PlaylistDefinition.
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
// hydratePlaylistLibrary()'s `needsRecovery` and src/data/playlistRecovery.ts,
// which data/playlists/usePlaylistLibrary.ts drives on startup. A
// file-upload source can't be auto-reacquired (we never keep the file's
// contents around after the initial parse), so that case is reported
// separately (`unrecoverableFiles`) and the UI asks the user to re-add the
// file instead of pretending it can recover on its own.
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
import { idbClearChannels } from '../core/storage/idbChannelStore'
import { clearAllPlaylistChannels } from '../core/storage/idbPlaylistChannelStore'
import { clearPlaylistLibrary } from './playlists/playlistLibraryStore'

const PLAYLIST_SOURCE_KEY = 'ninety.playlist.source'
// The old (pre-IndexedDB) localStorage key for the full merged Channel[]
// cache. Never read again — the playlist library reads exclusively from
// IndexedDB now — but the constant is kept so
// removeLegacyPlaylistChannelsCache() can explicitly delete any leftover
// copy once the new architecture proves itself, rather than letting an
// obsolete multi-MB JSON string sit in localStorage forever consuming
// Tizen's (often tighter, shared) quota.
const LEGACY_PLAYLIST_CHANNELS_KEY = 'ninety.playlist.channels'
const FILTERS_KEY = 'ninety.channelFilters'

// Bump when the *source record* shape changes in a way that makes
// previously-stored source records unreadable/unsafe to reconnect with.
// Independent of PLAYLIST_CHANNELS_SCHEMA_VERSION on purpose — see header.
const PLAYLIST_SOURCE_SCHEMA_VERSION = 1

// The version previous (single-playlist) builds stamped their cached
// Channel[] with. Read only by the one-time migration, which treats any
// other value as "stale, refetch instead of carrying over". The
// multi-playlist store has its own, independent
// PLAYLIST_CHANNELS_RECORD_VERSION.
export const PLAYLIST_CHANNELS_SCHEMA_VERSION = 2

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
// needs reconnecting. See hydratePlaylistLibrary()'s `unrecoverableFiles`
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

// The legacy single-playlist source record. loadPlaylistSource is what the
// one-time migration reads to carry a pre-existing install's playlist into
// the library; saveSource no longer runs in production at all (nothing
// writes a new single-playlist record) and is kept as its round-trip pair,
// which is also what session.test.ts writes fixtures with.
export function loadPlaylistSource(): PlaylistSourceRecord | null {
  const stored = readStored<StoredPlaylistSource | null>(PLAYLIST_SOURCE_KEY, null)
  return stored && stored.version === PLAYLIST_SOURCE_SCHEMA_VERSION ? stored.source : null
}

export function saveSource(source: PlaylistSourceRecord | null): boolean {
  if (!source) return true
  return writeStored<StoredPlaylistSource>(PLAYLIST_SOURCE_KEY, { version: PLAYLIST_SOURCE_SCHEMA_VERSION, source })
}

// Idempotent and cheap (a single localStorage key removal, not the large
// payload itself) — safe to call opportunistically any time a channel-cache
// read or write has just succeeded. Removes the obsolete, no-longer-read
// multi-MB JSON string left over from before the IndexedDB migration so it
// stops occupying Tizen's (often tighter, shared-with-other-apps)
// localStorage quota once the new architecture is confirmed working.
export function removeLegacyPlaylistChannelsCache(): void {
  try {
    localStorage.removeItem(LEGACY_PLAYLIST_CHANNELS_KEY)
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

// Clears every connected playlist — the library index, every playlist's
// cached channels, the legacy single-playlist record, and the one-time
// migration marker. Leaves onboarding, preferences, and the Channels filter
// selection alone. Needed because the merge (country-prefix stripping,
// quality-tag collapsing — see mergeChannels.ts) runs once at connect time
// and is cached; a normalization fix landing later (e.g. recognizing a new
// country-code prefix) has no effect on an already-cached playlist until
// it's re-fetched and re-merged. Settings' own per-playlist Resync is the
// user-facing version of this; the dev AdminPanel keeps the blunt one.
//
// IndexedDB is cleared FIRST, and only removes the localStorage source/
// library/legacy keys once that's confirmed complete — a failed IndexedDB delete
// must not partially destroy playlist state (i.e. never end up with the
// source record gone but the large channel cache still sitting in
// IndexedDB with nothing pointing away from it). Returns whether the clear
// fully succeeded; every caller that reloads/reconnects afterward MUST
// check this and skip doing so on `false`, or a stale cached playlist can
// silently reappear on the next hydration.
export async function clearPlaylist(): Promise<boolean> {
  const channelsCleared = await idbClearChannels()
  const libraryChannelsCleared = await clearAllPlaylistChannels()
  if (!channelsCleared || !libraryChannelsCleared) return false
  let sourceOk = true
  try {
    localStorage.removeItem(PLAYLIST_SOURCE_KEY)
  } catch {
    sourceOk = false
  }
  removeLegacyPlaylistChannelsCache()
  // Clearing the migration marker alongside the library is only correct
  // HERE: this action deliberately restores the "nothing connected" state,
  // and the legacy source record it just removed means a re-run of the
  // migration would find nothing to resurrect.
  if (!clearPlaylistLibrary()) sourceOk = false
  return sourceOk
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
