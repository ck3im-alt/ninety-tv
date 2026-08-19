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
// hydratePlaylistState()'s 'recovering' case and src/data/playlistRecovery.ts,
// which App.tsx drives on startup. A
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
import { idbReadChannels, idbWriteChannels, idbClearChannels } from '../core/storage/idbChannelStore'
import type { Channel } from './channel'
import type { XtreamCredentials } from './xtream/types'

const PLAYLIST_SOURCE_KEY = 'ninety.playlist.source'
// The old (pre-IndexedDB) localStorage key for the full merged Channel[]
// cache. Never read again — hydratePlaylistState() below reads exclusively
// from IndexedDB now — but the constant is kept so
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

// Bump when Channel's shape or the merge/normalization logic changes in a
// way that makes previously-cached channels stale or invalid. Bumped to 2
// when Channel gained epgChannelIds/rawNames (Channel Identity Resolver v2
// Phase 1) — old cached entries lack those fields, so they're treated as
// invalid and rebuilt via hydratePlaylistState()'s recovery path rather than
// silently served without the new identity data.
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
// needs reconnecting. See hydratePlaylistState()'s 'unrecoverable-file-source'
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

// The small, cheap half of playlist state — reconnect source only. Read/
// written synchronously via localStorage, same as before; this never grew
// large enough to need IndexedDB.
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

// The four outcomes hydrating playlist state can land on:
//   - ready: a valid IndexedDB channel cache exists — use it as-is, along
//     with its generationId (see data/playlistGeneration.ts) and whatever
//     source record was recorded alongside it.
//   - recovering: the (large) channel cache is missing or stale-versioned,
//     but the (small, essentially-never-fails) Xtream/M3U-URL source record
//     survived — auto-recoverable via recoverChannelsFromSource.
//   - unrecoverable-file-source: the only source on record is a file
//     upload and there's no valid cache — nothing to auto-refetch from,
//     the UI must ask the user to re-add the file.
//   - no-source: nothing usable was ever persisted (or it's all been
//     cleared) — normal first-run / post-reset state.
export type PlaylistHydrationResult =
  | { kind: 'ready'; channels: Channel[]; generationId: string; source: PlaylistSourceRecord | null }
  | { kind: 'recovering'; source: XtreamSourceRecord | M3uUrlSourceRecord }
  | { kind: 'unrecoverable-file-source'; source: FileSourceRecord }
  | { kind: 'no-source' }

// Async — reads the (small) source record synchronously from localStorage
// and the (large) channel cache from IndexedDB, never blocking the main
// thread on a multi-MB JSON.parse the way the old synchronous
// loadPlaylistState() did. Called once from App.tsx's bootstrap effect,
// post-mount, never at module load — Home can paint and accept input before
// this resolves.
export async function hydratePlaylistState(): Promise<PlaylistHydrationResult> {
  const source = loadPlaylistSource()
  const cached = await idbReadChannels()
  const cacheValid = cached != null && cached.version === PLAYLIST_CHANNELS_SCHEMA_VERSION

  if (cacheValid) {
    return { kind: 'ready', channels: cached.channels, generationId: cached.generationId, source }
  }
  if (!source) {
    return { kind: 'no-source' }
  }
  if (source.type === 'file') {
    return { kind: 'unrecoverable-file-source', source }
  }
  return { kind: 'recovering', source }
}

// Backward/simple-compatible helper for call sites that only care about
// "do we have a usable, connected-EPG-capable Xtream session right now" —
// EPG (get_short_epg) only exists on the Xtream JSON API, so a plain M3U
// or file source never has one.
export function xtreamCredsFromSource(source: PlaylistSourceRecord | null): XtreamCredentials | null {
  if (!source || source.type !== 'xtream') return null
  return { server: source.server, username: source.username, password: source.password }
}

// Writes the (large, quota-risky) channel cache to IndexedDB — structured
// clone, no JSON.stringify pass over the whole array. Called from exactly
// one place (App.tsx's playlist-persistence effect) so a fresh
// connect/recovery performs exactly one large write, never two — see that
// effect's own comments for why the write must not also happen inline in
// the recovery path.
export function savePlaylistChannels(channels: Channel[], generationId: string): Promise<boolean> {
  return idbWriteChannels({ version: PLAYLIST_CHANNELS_SCHEMA_VERSION, generationId, channels })
}

// Clears the connected playlist (source + cached channel list) — not
// onboarding, preferences, or the Channels filter selection. Needed because
// the merge (country-prefix stripping, quality-tag collapsing — see
// mergeChannels.ts) runs once at connect time and is cached; a
// normalization fix landing later (e.g. recognizing a new country-code
// prefix) has no effect on an already-cached playlist until it's re-fetched
// and re-merged. The full "Reset onboarding & preferences" admin action
// already covers this as a side effect of wiping everything, but that's a
// bigger hammer than this specific, common need.
//
// IndexedDB is cleared FIRST, and only removes the localStorage source/
// legacy keys once that's confirmed complete — a failed IndexedDB delete
// must not partially destroy playlist state (i.e. never end up with the
// source record gone but the large channel cache still sitting in
// IndexedDB with nothing pointing away from it). Returns whether the clear
// fully succeeded; every caller that reloads/reconnects afterward MUST
// check this and skip doing so on `false`, or a stale cached playlist can
// silently reappear on the next hydration.
export async function clearPlaylist(): Promise<boolean> {
  const channelsCleared = await idbClearChannels()
  if (!channelsCleared) return false
  let sourceOk = true
  try {
    localStorage.removeItem(PLAYLIST_SOURCE_KEY)
  } catch {
    sourceOk = false
  }
  removeLegacyPlaylistChannelsCache()
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
