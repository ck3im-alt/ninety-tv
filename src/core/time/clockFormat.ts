// THE ONE CLOCK FORMAT IN THE APP: 24-hour "HH:mm".
//
// Ninety shows a time in four places — TopNav's wall clock, Home's card
// labels ("Today 21:00"), Match View's kickoff, and Settings' "Synced
// 14:32" — and three of them used to ask the DEVICE what shape a time
// should be, via `toLocaleTimeString([], …)`. On a TV whose locale is
// en-US that renders 19:00 as "7 PM", which is what this module exists to
// stop: the times sit next to each other across screens (a Home card and
// the Match View header for the same fixture), next to always-24h values
// extracted from provider stream names (see ppvDisplayName.ts's
// extractRawStreamStartTime), and next to fixture data from European
// leagues that nobody quotes in AM/PM.
//
// WHY NOT `hour12: false` / `hourCycle: 'h23'`. Both are Intl features and
// this app's floor is Tizen 6.5, i.e. Samsung's 2022 model year / Chromium
// M85 (Samsung maps 2021 -> Tizen 6.0 -> M76 and 2022 -> Tizen 6.5 -> M85;
// an earlier comment here mistakenly paired 6.5 with M76), on a device
// build whose ICU
// data we do not control — a reduced-ICU build answers locale requests it
// cannot honour rather than failing loudly, and `hour12: false` has a
// history of resolving to the h24 cycle, which renders midnight as "24:00".
// Reading the fields off Date and padding them cannot do either: it needs
// no ICU at all, and 00:00–23:59 is the only output it has.
//
// TIMEZONE IS UNTOUCHED. getHours()/getMinutes() are the platform's own
// LOCAL-time accessors, so a UTC instant still lands on the viewer's wall
// clock exactly as it did before — only the DISPLAY shape is fixed here.
export function formatClockTime24h(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// Same format from an ISO timestamp, returning '' for an absent or
// unparseable one — never a fabricated time. Shared so every caller that
// starts from a `dateTimeUtc` string agrees on both halves of that
// contract.
export function formatIsoClockTime24h(dateTimeUtc: string | null | undefined): string {
  if (!dateTimeUtc) return ''
  const date = new Date(dateTimeUtc)
  if (Number.isNaN(date.getTime())) return ''
  return formatClockTime24h(date)
}
