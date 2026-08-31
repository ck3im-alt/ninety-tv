// What the viewer actually watches, learned locally.
//
// A small, decaying, on-device tally of the teams and competitions a viewer
// opens and plays, so Home can eventually notice "you watch a lot of
// Eliteserien" without anyone having ticked a box. Feeds
// homePersonalization.ts's learned-affinity terms, which are capped well
// below the explicit favorites: an inference must never outweigh a stated
// preference.
//
// DELIBERATE LIMITS:
//
// - LOCAL ONLY. localStorage, same as every other preference in this app
//   (see preferences.ts / session.ts). No account, no sync, nothing leaves
//   the TV. Losing it costs the viewer nothing they chose.
//
// - CANONICAL IDS ONLY. Team and competition ids, never display names —
//   the same rule favoriteTeamIds follows. An event from a backend that
//   doesn't send team ids simply records its competition and nothing else.
//
// - NO PLAYER INSTRUMENTATION. The two signals recorded are "opened an
//   event" and "started a stream for an event", both captured at
//   navigation points in App.tsx that already exist. Watch DURATION would
//   be a better signal, but getting it means reaching into the playback
//   session, and playback reliability outranks recommendation quality by a
//   wide margin. The shape below (a weight per signal) takes a duration
//   signal as one more call whenever that is worth doing.
import { readStored, writeStored } from '../../core/storage/localStore'
import type { SportEvent } from './types'

const AFFINITY_KEY = 'ninety.watchAffinity'
const AFFINITY_VERSION = 1

// Opening an event's details is mild interest; actually starting a stream
// is real interest. Both are small — this tally is meant to become
// meaningful over weeks of use, not to reshape Home after one click.
const OPEN_WEIGHT = 1
const WATCH_WEIGHT = 3

// Interest fades. Fourteen days halves a signal's weight, so a club watched
// intensively during one cup run stops dominating a month later without
// ever being forgotten outright.
const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000

// Turns an unbounded tally into the 0..1 the scorer wants, with strongly
// diminishing returns: one watch ~0.33, two ~0.5, five ~0.71. Nothing
// reaches 1, which is what keeps learned affinity structurally below the
// explicit favorite it is standing in for.
const SATURATION = 6

// A single obsessively-watched team can't accumulate unbounded weight and
// permanently flatten everything else.
const MAX_STRENGTH = 40

// Bounded storage: the strongest N of each kind survive a write. A TV that
// has been in use for a year should not carry a thousand dead entries.
const MAX_ENTRIES = 60

// How recently a stream must have been playing for "you were just watching
// this" to still be true. Long enough to cover leaving the player, browsing
// Home and coming back; short enough that it is genuinely about THIS
// sitting, not this afternoon.
const CONTINUITY_WINDOW_MS = 12 * 60 * 1000

interface AffinityEntry {
  strength: number
  lastAt: number
}

interface StoredAffinity {
  version: number
  teams: Record<string, AffinityEntry>
  competitions: Record<string, AffinityEntry>
  // The last event a stream was actually started for — the continuity
  // signal. Not part of the tallies: it answers "are you still in the
  // middle of watching this?", not "how much do you like it?".
  lastWatched?: { eventId: string; at: number }
}

// A FUNCTION, not a shared constant. record() mutates the object read()
// hands back before writing it, so a single shared empty literal would
// accumulate every signal from the first-ever write into module state and
// hand it to the next reader.
function emptyStore(): StoredAffinity {
  return { version: AFFINITY_VERSION, teams: {}, competitions: {} }
}

function isEntry(value: unknown): value is AffinityEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<AffinityEntry>
  return typeof entry.strength === 'number' && Number.isFinite(entry.strength) && typeof entry.lastAt === 'number' && Number.isFinite(entry.lastAt)
}

// Anything unrecognizable — an older/newer schema, a hand-edited store, a
// half-written record — resets to empty rather than propagating garbage
// into scoring. This data is inferred and freely re-earned; there is
// nothing here worth trying to salvage, unlike the user's actual choices.
function read(): StoredAffinity {
  const stored = readStored<Partial<StoredAffinity> | null>(AFFINITY_KEY, null)
  if (!stored || stored.version !== AFFINITY_VERSION) return emptyStore()
  // A plain loop rather than Object.fromEntries: this runs at app start on
  // a Samsung TV, and nothing else in this codebase depends on that built-in
  // (Chrome 73+). The packaged widget declares Tizen 6.5 (Chromium M85),
  // which does have it — but a TypeError here would take out Home's
  // ranking for no benefit
  // over three lines of loop.
  const clean = (record: unknown): Record<string, AffinityEntry> => {
    const cleaned: Record<string, AffinityEntry> = {}
    if (typeof record !== 'object' || record === null) return cleaned
    for (const [id, value] of Object.entries(record as Record<string, unknown>)) {
      if (isEntry(value)) cleaned[id] = value
    }
    return cleaned
  }
  return {
    version: AFFINITY_VERSION,
    teams: clean(stored.teams),
    competitions: clean(stored.competitions),
    lastWatched:
      stored.lastWatched && typeof stored.lastWatched.eventId === 'string' && typeof stored.lastWatched.at === 'number'
        ? stored.lastWatched
        : undefined,
  }
}

function decayedStrength(entry: AffinityEntry, now: number): number {
  const elapsed = Math.max(0, now - entry.lastAt)
  return entry.strength * Math.pow(0.5, elapsed / HALF_LIFE_MS)
}

// Decay is applied on WRITE (fold the old value forward, then add the new
// signal) as well as on read, so the stored strength is always "as of
// lastAt" and two signals a month apart don't sum as if they were
// simultaneous.
function bump(record: Record<string, AffinityEntry>, id: string, weight: number, now: number): void {
  const existing = record[id]
  const carried = existing ? decayedStrength(existing, now) : 0
  record[id] = { strength: Math.min(MAX_STRENGTH, carried + weight), lastAt: now }
}

function prune(record: Record<string, AffinityEntry>, now: number): Record<string, AffinityEntry> {
  const entries = Object.entries(record)
  if (entries.length <= MAX_ENTRIES) return record
  const kept: Record<string, AffinityEntry> = {}
  for (const [id, entry] of entries
    .sort(([, a], [, b]) => decayedStrength(b, now) - decayedStrength(a, now))
    .slice(0, MAX_ENTRIES)) {
    kept[id] = entry
  }
  return kept
}

function write(next: StoredAffinity, now: number): void {
  writeStored<StoredAffinity>(AFFINITY_KEY, {
    ...next,
    teams: prune(next.teams, now),
    competitions: prune(next.competitions, now),
  })
}

// Records both sides' teams and the competition. An event whose team ids
// the backend hasn't started sending yet still contributes its competition,
// which is why the two are tallied separately rather than as one blob.
function record(event: SportEvent, weight: number, now: number, watched: boolean): void {
  const store = read()
  if (event.homeTeamId) bump(store.teams, event.homeTeamId, weight, now)
  if (event.awayTeamId) bump(store.teams, event.awayTeamId, weight, now)
  if (event.leagueId) bump(store.competitions, event.leagueId, weight, now)
  if (watched) store.lastWatched = { eventId: event.id, at: now }
  write(store, now)
}

// The viewer drilled into an event's details. Mild interest — they might
// just have been checking the kickoff time.
export function recordEventOpened(event: SportEvent, now: number = Date.now()): void {
  record(event, OPEN_WEIGHT, now, false)
}

// The viewer actually started playing a stream for this event. The
// strongest signal available without instrumenting playback, and the one
// that also arms the continuity boost below.
export function recordEventWatched(event: SportEvent, now: number = Date.now()): void {
  record(event, WATCH_WEIGHT, now, true)
}

export interface WatchAffinitySnapshot {
  teams: ReadonlyMap<string, number>
  competitions: ReadonlyMap<string, number>
  // The event a stream was started for within the continuity window, or
  // null. Home uses it to put a match the viewer stepped away from minutes
  // ago back near the front — while it is still live.
  continuityEventId: string | null
}

function normalize(record: Record<string, AffinityEntry>, now: number): Map<string, number> {
  const map = new Map<string, number>()
  for (const [id, entry] of Object.entries(record)) {
    const strength = decayedStrength(entry, now)
    // Below this a signal is indistinguishable from noise and only costs
    // the scorer a map lookup.
    if (strength < 0.05) continue
    map.set(id, strength / (strength + SATURATION))
  }
  return map
}

// Read once per Home derivation, never per event — the scorer takes the
// resulting maps, so a feed of several hundred events does one localStorage
// read and one decay pass in total.
export function loadWatchAffinity(now: number = Date.now()): WatchAffinitySnapshot {
  const store = read()
  const continuity =
    store.lastWatched && now - store.lastWatched.at >= 0 && now - store.lastWatched.at <= CONTINUITY_WINDOW_MS
      ? store.lastWatched.eventId
      : null
  return {
    teams: normalize(store.teams, now),
    competitions: normalize(store.competitions, now),
    continuityEventId: continuity,
  }
}

// Test-only, and the escape hatch a future "forget what I've watched"
// Settings action would use.
export function clearWatchAffinity(): void {
  writeStored<StoredAffinity>(AFFINITY_KEY, emptyStore())
}
