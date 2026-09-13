// "WHEN DID THIS LAST HAPPEN", in the one shape Ninety states it.
//
// Coarse on purpose. "Synced 14:32" is useful and stable; "Synced 6 minutes
// ago" would need a ticking re-render forever and tells the viewer nothing
// they can act on. The one exception is the last minute, which collapses to
// "just now" — that is the window where the viewer has just pressed the
// button themselves and needs to see that it worked.
//
// The VERB is a parameter because two screens say this about the same
// underlying timestamp in their own vocabulary: Settings' Playlists pane
// calls it syncing (see features/settings/formatLastSynced.ts) and Event
// Details' no-stream state calls it refreshing, because that is the word on
// the button the viewer just pressed. One implementation, so the two can
// never drift in shape — only in the word.
import { formatClockTime24h } from './clockFormat'

export function formatLastUpdated(verb: string, at: number | null, now: number = Date.now()): string {
  if (at == null) return `Never ${verb.toLowerCase()}`
  const elapsed = now - at
  // A future timestamp can occur when the TV/provider clocks differ. It is
  // not "just now"; show its explicit clock/date below. The lower bound
  // also keeps midnight-sensitive tests and the real UI honest.
  if (elapsed >= 0 && elapsed < 60_000) return `${verb} just now`
  const date = new Date(at)
  // Always 24-hour, via the app's shared formatter, so this cannot drift
  // from the times on every other screen.
  const time = formatClockTime24h(date)
  // Same calendar day -> a clock time is the most precise thing that stays
  // unambiguous; within the last week -> the weekday; older -> a date.
  if (elapsed < 24 * 60 * 60 * 1000 && new Date(now).getDate() === date.getDate()) return `${verb} ${time}`
  if (elapsed < 7 * 24 * 60 * 60 * 1000) return `${verb} ${date.toLocaleDateString(undefined, { weekday: 'long' })}`
  return `${verb} ${date.toLocaleDateString()}`
}
