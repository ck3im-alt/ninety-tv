// Formats an event's real dateTimeUtc for the redesigned header's center
// fixture block — deliberately separate from mapEvent.ts's timeLabel
// (a compact "Today 21:00" / "Mon 21:00" string meant for list rows), since
// this screen wants the day and the kickoff time as two independently
// styled/sized pieces (see the Event Details redesign task, section 4).
import { formatIsoClockTime24h } from '../../core/time/clockFormat'

const WEEKDAY_MONTH_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }

function parseValidDate(dateTimeUtc: string | null): Date | null {
  if (!dateTimeUtc) return null
  const d = new Date(dateTimeUtc)
  return Number.isNaN(d.getTime()) ? null : d
}

// "Today" / "Tomorrow" / a short localized date otherwise ("Wed, 19 Aug").
export function formatEventDayLabel(dateTimeUtc: string | null): string {
  const d = parseValidDate(dateTimeUtc)
  if (!d) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString([], WEEKDAY_MONTH_FORMAT)
}

// 24-hour "HH:mm" kickoff time — the large center value in the header.
//
// Was device-localized until 2026-08-28, which rendered a 19:00 kickoff as
// "7 PM" on a TV set to en-US — while the SAME fixture's Home card, the
// Schedule row beside it and the advertised time parsed out of the stream
// name all said 19:00. One clock format across the app beats matching each
// device's convention; see core/time/clockFormat.ts.
export function formatKickoffTime(dateTimeUtc: string | null): string {
  return formatIsoClockTime24h(dateTimeUtc)
}

// The PPV/event-stream display line's FALLBACK time source (see
// ppvDisplayName.ts's buildEventStreamDisplayParts), used when the raw
// stream name carries no extractable advertised time of its own.
//
// Kept as a separate NAME because that call site's requirement is genuinely
// its own: it sits directly beside extractRawStreamStartTime's always-24h
// output and has to match it whatever the device thinks. It is now the same
// IMPLEMENTATION as formatKickoffTime — since 2026-08-28 the whole app is
// 24-hour, so the two can no longer disagree, which is what the old comment
// here warned about.
export function formatTimeOnly24h(dateTimeUtc: string | null): string {
  return formatIsoClockTime24h(dateTimeUtc)
}
