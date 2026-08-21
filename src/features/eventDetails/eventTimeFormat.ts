// Formats an event's real dateTimeUtc for the redesigned header's center
// fixture block — deliberately separate from mapEvent.ts's timeLabel
// (a compact "Today 21:00" / "Mon 21:00" string meant for list rows), since
// this screen wants the day and the kickoff time as two independently
// styled/sized pieces (see the Event Details redesign task, section 4).
const WEEKDAY_MONTH_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }
const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }

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

// Localized "HH:MM" kickoff time — the large center value in the header.
export function formatKickoffTime(dateTimeUtc: string | null): string {
  const d = parseValidDate(dateTimeUtc)
  return d ? d.toLocaleTimeString([], TIME_FORMAT) : ''
}

// Fixed 24-hour "HH:mm", no date — the PPV/event-stream display line's
// FALLBACK time source only (see ppvDisplayName.ts's
// buildEventStreamDisplayParts), used when the raw stream name itself
// carries no extractable advertised time. Deliberately NOT locale-aware
// like formatKickoffTime (which intentionally follows device
// AM/PM-vs-24h conventions for the event header) — this segment sits right
// next to extractRawStreamStartTime's own always-24h output, so it needs
// to match that shape for visual consistency regardless of device locale.
// Still converts the UTC instant to the device's actual local time (via
// Date's own local getHours/getMinutes) — only the DISPLAY FORMAT is
// fixed, not the timezone. Returns '' (never a fabricated time) when
// dateTimeUtc is absent/invalid, same contract as the other formatters
// here.
export function formatTimeOnly24h(dateTimeUtc: string | null): string {
  const d = parseValidDate(dateTimeUtc)
  if (!d) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
