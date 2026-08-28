// Coarse on purpose. "Synced 14:32" is useful and stable; "Synced 6 minutes
// ago" would need a ticking re-render forever and tells the user nothing
// they can act on. Pure, and its own module so it can be tested without
// rendering the Playlists pane.
import { formatClockTime24h } from '../../core/time/clockFormat'

export function formatLastSynced(at: number | null, now: number = Date.now()): string {
  if (at == null) return 'Never synced'
  const elapsed = now - at
  if (elapsed < 60_000) return 'Synced just now'
  const date = new Date(at)
  // This one was always 24-hour, by hand. Now it is the app's shared
  // formatter, so it cannot drift from the times on every other screen.
  const time = formatClockTime24h(date)
  // Same calendar day -> a clock time is the most precise thing that stays
  // unambiguous; within the last week -> the weekday; older -> a date.
  if (elapsed < 24 * 60 * 60 * 1000 && new Date(now).getDate() === date.getDate()) return `Synced ${time}`
  if (elapsed < 7 * 24 * 60 * 60 * 1000) return `Synced ${date.toLocaleDateString(undefined, { weekday: 'long' })}`
  return `Synced ${date.toLocaleDateString()}`
}
