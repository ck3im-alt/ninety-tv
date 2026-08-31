// Settings' vocabulary for "when did this playlist last update" — the
// Playlists pane calls it syncing.
//
// The shape itself (just now / a clock time / a weekday / a date) is shared
// with Event Details' no-stream state, which says the same thing about the
// same timestamp in its own word ("Refreshed", matching the button the
// viewer just pressed). See core/time/lastUpdated.ts: one implementation, so
// the two screens cannot drift apart in anything but the verb.
import { formatLastUpdated } from '../../core/time/lastUpdated'

export function formatLastSynced(at: number | null, now: number = Date.now()): string {
  return formatLastUpdated('Synced', at, now)
}
