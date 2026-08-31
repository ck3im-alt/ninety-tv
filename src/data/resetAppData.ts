// "Put this TV back to how it was before I set it up."
//
// Lives in data/ rather than core/storage/ because it is a POLICY over app
// data, not a storage mechanism: it has to know which keys mean "a playlist
// is connected" and which mean "the viewer made a choice". core/storage
// stays ignorant of what the app keeps in it.
//
// Why this exists as its own module at all: the app's persisted state is
// spread across localStorage AND two IndexedDB databases, and the previous
// reset (the dev AdminPanel's) only cleared localStorage — so a "reset"
// left the entire cached channel library sitting in IndexedDB, invisibly
// consuming Tizen's storage quota and ready to be picked up again. Any
// reset that does not name both stores in one place will drift apart again.
import { clearAllAppStorage } from '../core/storage/localStore'
import { idbClearChannels } from '../core/storage/idbChannelStore'
import { clearAllPlaylistChannels } from '../core/storage/idbPlaylistChannelStore'

// 'everything' — a true first launch: no playlist, no preferences, no
//   favorites, no caches. What a factory reset of the app would look like.
// 'onboarding' — the viewer's CHOICES go, the connected playlist stays.
//   Exists for the repeated-testing loop: re-walking onboarding without
//   re-entering Xtream credentials (or re-downloading 30k channels) every
//   cycle.
export type ResetScope = 'everything' | 'onboarding'

// The only keys 'onboarding' preserves, and the whole rule in one line:
// keep WHICH PLAYLIST IS CONNECTED, drop everything else.
//
// Stated as an explicit list rather than a `ninety.playlist*` prefix match
// because the prefix is a coincidence of naming, not a contract — and a
// future `ninety.playlistSortOrder` (a preference, not a connection) would
// silently start surviving resets. If a genuinely new playlist-connection
// key is added, add it here; anything else added anywhere is cleared by
// default, which is the safe direction.
export const PRESERVED_PLAYLIST_STORAGE_KEYS: readonly string[] = [
  // The single-playlist source record (pre-library builds, still read by
  // the one-time migration).
  'ninety.playlist.source',
  // Its equally legacy cached Channel[] — preserved with the record it
  // belongs to so an 'onboarding' reset never leaves a half-migrated pair.
  'ninety.playlist.channels',
  // The multi-playlist library: the definitions themselves...
  'ninety.playlists',
  // ...and the marker saying the single -> library migration already ran.
  // Dropping this while keeping the library would re-run the migration
  // against a source record that has already been absorbed.
  'ninety.playlists.migratedFromSingle',
]

// Resolves false if any part of the wipe failed, so a caller can decline to
// reload into a half-cleared state and say so instead. IndexedDB is cleared
// FIRST and its result checked before localStorage is touched — same
// ordering rule as session.ts's clearPlaylist, and for the same reason: if
// the big asynchronous store fails, nothing has been destroyed yet and the
// app is still coherent.
export async function resetAppData(scope: ResetScope): Promise<boolean> {
  if (scope === 'onboarding') {
    // No IndexedDB work at all — the cached channels belong to the playlist
    // this scope is deliberately keeping.
    clearAllAppStorage(PRESERVED_PLAYLIST_STORAGE_KEYS)
    return true
  }

  // Both databases, not just one: 'ninety-tv-channels' holds the legacy
  // single-playlist cache and 'ninety-tv-playlist-channels' holds the
  // per-playlist library records. A build that has migrated still has the
  // old database on disk.
  const channelsCleared = await idbClearChannels()
  const libraryCleared = await clearAllPlaylistChannels()
  if (!channelsCleared || !libraryCleared) return false

  clearAllAppStorage()
  return true
}
