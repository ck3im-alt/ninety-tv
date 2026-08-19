// Stamps a new playlist generation with a small opaque id — never derived
// from playlist content (no hashing ~30,925 channel ids on every launch),
// generated exactly once per fresh connect/recovery and then persisted
// alongside the IndexedDB channel cache (see idbChannelStore.ts) so a normal
// cached launch just reads it back. Used to key the identity resolver's
// cross-session resolution cache (see
// data/sports/channelIdentityResolutionCache.ts) — a new generation id means
// "this is a different playlist," which correctly invalidates any stale
// cached resolution without inspecting a single channel.
export function generatePlaylistGenerationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for older Tizen WebKit runtimes that may lack crypto.randomUUID
  // — still O(1), still zero playlist-content inspection.
  return `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
