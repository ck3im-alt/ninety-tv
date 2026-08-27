// Copy for the Ninety loading state — kept out of LoadingScreen.tsx so that
// file exports only its component (which is also what keeps Fast Refresh
// working on it).

// The real stages of a playlist import, in the order they actually happen.
// Each one corresponds to a distinct await in the import path, so the copy
// only ever advances when something genuinely finished:
//
//   fetching   — connectPlaylist.ts: fetch + parse M3U / Xtream
//   organizing — usePlaylistLibrary.install: merge + persist channels
//   preparing  — channelIndex warm (country/category/channel buckets)
export const PLAYLIST_IMPORT_TITLE = 'Loading your channels'
export const PLAYLIST_IMPORT_STAGES = {
  fetching: 'Preparing your playlist for Ninety',
  organizing: 'Organizing your channels',
  preparing: 'Preparing your playlist for Ninety',
} as const
export type PlaylistImportStage = keyof typeof PLAYLIST_IMPORT_STAGES
