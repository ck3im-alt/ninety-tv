// Persisted "reconnect" state — the connected playlist and the Channels
// filter selection. Lets the app skip straight back to Home/Channels on
// reload instead of re-running setup/onboarding every time. Same
// localStorage-is-enough reasoning as preferences.ts: single-device data,
// nothing that needs to sync or survive a reinstall.
//
// The playlist is split across two keys rather than one:
//   - "source" (Xtream creds) is a few hundred bytes and effectively never
//     fails to write.
//   - "channels" (the merged Channel[]) is the one part of this file that
//     can get large — a big IPTV playlist can be tens of thousands of
//     entries, tens of KB to low-MB of JSON — and is therefore the one
//     realistically at risk of hitting a storage quota on some Tizen Web
//     Runtime versions. Splitting them means a channel-cache write failure
//     doesn't also lose the (tiny, essentially free) source config, so
//     reconnecting doesn't require the user to re-type their Xtream
//     credentials on top of the playlist re-fetch.
// Both carry PLAYLIST_SCHEMA_VERSION so a future change to the merge/
// normalization logic (see mergeChannels.ts) can bump the version and have
// old cached entries safely ignored (treated as absent, re-fetched) instead
// of being read back in a shape the current code doesn't expect.
//
// Xtream credentials are stored as plain JSON here, same as everything
// else in this file. That's a deliberate choice, not an oversight: a Tizen
// (or any) web app has no OS keychain / secure-enclave API available to it,
// and Web Crypto's SubtleCrypto can only encrypt with a key that itself has
// to live somewhere on-device readable by this same origin — so it adds
// code without changing what's actually recoverable via devtools/the
// filesystem. Given the threat model here (single-user family TV, IPTV
// panel creds, not a banking credential), that obfuscation isn't worth the
// complexity. What actually matters — never sending these off-device to
// ninety-api — is already true (see xtream/xtreamClient.ts: it talks
// directly to the Xtream panel, not through our backend).

import { readStored, writeStored } from '../core/storage/localStore'
import type { Channel } from './channel'
import type { XtreamCredentials } from './xtream/types'

const PLAYLIST_SOURCE_KEY = 'ninety.playlist.source'
const PLAYLIST_CHANNELS_KEY = 'ninety.playlist.channels'
const FILTERS_KEY = 'ninety.channelFilters'

// Bump when Channel's shape or the merge/normalization logic changes in a
// way that makes previously-cached channels stale or invalid.
const PLAYLIST_SCHEMA_VERSION = 1

interface StoredPlaylistSource {
  version: number
  xtreamCreds: XtreamCredentials | null
}

interface StoredPlaylistChannels {
  version: number
  channels: Channel[]
}

interface StoredPlaylist {
  channels: Channel[]
  xtreamCreds: XtreamCredentials | null
}

export function loadPlaylist(): StoredPlaylist | null {
  const source = readStored<StoredPlaylistSource | null>(PLAYLIST_SOURCE_KEY, null)
  const channels = readStored<StoredPlaylistChannels | null>(PLAYLIST_CHANNELS_KEY, null)
  if (!source || source.version !== PLAYLIST_SCHEMA_VERSION) return null
  if (!channels || channels.version !== PLAYLIST_SCHEMA_VERSION) return null
  return { channels: channels.channels, xtreamCreds: source.xtreamCreds }
}

// Returns whether both parts persisted. The channel cache (the large,
// quota-risky part) is written first — if it fails, the caller should
// treat this playlist as not durably saved, and callers that care can log
// or surface that instead of assuming a reload will find it.
export function savePlaylist(channels: Channel[], xtreamCreds: XtreamCredentials | null): boolean {
  const channelsOk = writeStored<StoredPlaylistChannels>(PLAYLIST_CHANNELS_KEY, {
    version: PLAYLIST_SCHEMA_VERSION,
    channels,
  })
  const sourceOk = writeStored<StoredPlaylistSource>(PLAYLIST_SOURCE_KEY, {
    version: PLAYLIST_SCHEMA_VERSION,
    xtreamCreds,
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
