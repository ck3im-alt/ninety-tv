// Persisted "reconnect" state — the connected playlist and the Channels
// filter selection. Lets the app skip straight back to Home/Channels on
// reload instead of re-running setup/onboarding every time. Same
// localStorage-is-enough reasoning as preferences.ts: single-device data,
// nothing that needs to sync or survive a reinstall.

import { readStored, writeStored } from '../core/storage/localStore'
import type { Channel } from './channel'
import type { XtreamCredentials } from './xtream/types'

const PLAYLIST_KEY = 'ninety.playlist'
const FILTERS_KEY = 'ninety.channelFilters'

interface StoredPlaylist {
  channels: Channel[]
  xtreamCreds: XtreamCredentials | null
}

export function loadPlaylist(): StoredPlaylist | null {
  return readStored<StoredPlaylist | null>(PLAYLIST_KEY, null)
}

export function savePlaylist(channels: Channel[], xtreamCreds: XtreamCredentials | null): void {
  writeStored<StoredPlaylist>(PLAYLIST_KEY, { channels, xtreamCreds })
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
    localStorage.removeItem(PLAYLIST_KEY)
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
