// WHEN a provider playlist should be refetched, and WHETHER a refetched
// generation is safe to install. Pure — no React, no timers, no storage —
// so every rule below is testable without rendering anything, exactly the
// split playlistLibrary.ts/usePlaylistLibrary.ts already uses.
//
// The product requirement this exists for: providers add PPV/event channels
// throughout the day, so a playlist fetched at launch is NOT valid three
// hours later. Ninety must refresh aggressively — and must never let that
// refresh disturb a stream the viewer is already watching. This module owns
// the "aggressively" half; usePlaylistLibrary's coordinator owns the
// "never disturb" half.

// Roughly every quarter of an hour, i.e. the middle of the 10-15 minute
// target band. Justified by measurement rather than taste: one refresh
// downloads ~5 MB and costs (with the parse+merge Worker in place) about
// 70 ms of main-thread structured-clone on a dev Mac. At this cadence that
// is ~7 kB/s of average bandwidth — nothing beside a live video stream —
// and ~0.01 % of one core. A tighter cadence would buy very little: a
// provider adding a PPV slot for a 20:00 kickoff publishes it minutes to
// hours ahead, not seconds.
export const PLAYLIST_REFRESH_INTERVAL_MS = 12 * 60 * 1000

// Spread applied to every scheduled due time. Two purposes: several
// connected playlists never come due on the same tick (which would put two
// large merges back to back), and a room full of Ninety installs that
// launched together does not hit one provider in lockstep.
export const PLAYLIST_REFRESH_JITTER_MS = 90 * 1000

// How often the coordinator asks "is anything due?". Deliberately far
// shorter than the interval: the tick itself is a few integer comparisons,
// and a coarse tick would make a resume-triggered or backoff-expiring sync
// wait up to a full interval past its due time.
export const PLAYLIST_SYNC_TICK_MS = 60 * 1000

// Failure backoff, as a multiplier on the base interval: 1x, 2x, 4x, then
// capped. Capped rather than unbounded because the far more likely cause of
// repeated failure is a provider outage or the TV being off the network —
// both of which resolve without any state change Ninety can observe, so it
// has to keep trying eventually. At the cap that is one attempt every ~48
// minutes, which is not a retry storm by any definition.
export const MAX_BACKOFF_MULTIPLIER = 4

// A playlist that previously carried at least this many channels is big
// enough that a sudden collapse is far more likely to be a broken provider
// response than a real catalogue change. Below it, providers legitimately
// have tiny playlists and any ratio test would be noise.
export const SHRINK_GUARD_MIN_PREVIOUS_COUNT = 200

// How much of the previous channel count a new generation must retain to be
// installed automatically. Deliberately loose — a provider dropping a third
// of its catalogue overnight is unusual but real, and Ninety must not
// second-guess it. This only catches the pathological case: a truncated
// download, a partial JSON page, an error body that happens to parse.
export const SHRINK_GUARD_MIN_RATIO = 0.25

// WHETHER THE FETCH HALF OF A SYNC RUNS WHILE A STREAM IS PLAYING.
//
// The INSTALL half is gated unconditionally and is not negotiable (see
// usePlaylistLibrary's playback gate) — installing is the step that touches
// the live React tree, rebuilds the channel-identity index, re-runs Home's
// derivation and re-renders every mounted screen. This flag governs only the
// cheaper half: download, parse and merge, all of which happen off the main
// thread in the playlist-build Worker.
//
// Default TRUE, and here is the arithmetic behind it. A refresh's entire
// main-thread cost while playback is active is ONE structured clone of the
// resulting Channel[] coming back out of the Worker: measured at 67 ms for
// 30,925 channels on a dev Mac, so an estimated 200-400 ms on TV silicon,
// once per PLAYLIST_REFRESH_INTERVAL_MS. For comparison, Home's local
// matching pass ran 1.9 SECONDS of unbroken main-thread work every 60
// seconds on every screen — playback included — before this session's work,
// so the net main-thread load during playback is now far lower than it was,
// not higher. Keeping the fetch running is what makes "exit a two-hour
// match, the new PPV channels are already there" instant rather than a
// download's wait.
//
// TO FLIP IT: set this to false. Freshness then works exactly as the
// requirement's fallback describes — nothing is fetched during playback, and
// leaving the Player triggers an immediate staleness check instead. The
// evidence to decide on is `playlist:build-worker-round-trip` in
// window.__ninetyPerf from a diagnostic build, read while a stream plays,
// plus whether any correlated entry appears in `longTasks`.
export const PREPARE_DURING_PLAYBACK = true

// Every reason a sync can start. Carried through the coordinator because
// two of them change behaviour rather than just bookkeeping: 'manual' is
// the user waiting in Settings (so it ignores both the due check and the
// shrink guard, and its result installs even during playback), and 'launch'
// always runs because a cached playlist of unknown age is exactly the
// staleness this feature exists to fix.
export type PlaylistSyncTrigger = 'launch' | 'interval' | 'resume' | 'playback-exit' | 'manual'

export interface PlaylistSyncRecord {
  // Epoch ms of the last sync that produced an installable generation.
  // null means "never synced this session and no persisted timestamp" —
  // treated as maximally stale.
  lastSuccessAt: number | null
  // Epoch ms of the last attempt, successful or not. Backoff counts from
  // here, so a failing provider is retried on a schedule rather than
  // immediately re-attempted by the next trigger that comes along.
  lastAttemptAt: number | null
  consecutiveFailures: number
}

export const FRESH_SYNC_RECORD: PlaylistSyncRecord = { lastSuccessAt: null, lastAttemptAt: null, consecutiveFailures: 0 }

// 1x after the first failure, 2x after the second, 4x after the third, then
// held. Expressed as a multiplier (not a delay) so the same number describes
// both "how long until the next automatic attempt" and "how stale a
// playlist is allowed to get while its provider is down".
export function backoffMultiplier(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 1
  return Math.min(MAX_BACKOFF_MULTIPLIER, 2 ** (consecutiveFailures - 1))
}

// The earliest moment an automatic trigger may sync this playlist again.
// Counts from the last ATTEMPT while failing (so a dead provider is not
// hammered by every resume) and from the last SUCCESS while healthy (so a
// long, quiet, successful session still comes due on schedule).
export function nextDueAt(record: PlaylistSyncRecord, jitterMs = 0): number {
  if (record.consecutiveFailures > 0 && record.lastAttemptAt != null) {
    return record.lastAttemptAt + PLAYLIST_REFRESH_INTERVAL_MS * backoffMultiplier(record.consecutiveFailures) + jitterMs
  }
  if (record.lastSuccessAt == null) return 0
  return record.lastSuccessAt + PLAYLIST_REFRESH_INTERVAL_MS + jitterMs
}

// The single "should this sync run at all" question, asked by every trigger.
// 'manual' and 'launch' are unconditional by design — the user pressing Sync
// must always do something visible, and a cached playlist restored from disk
// has an unknown (possibly days-old) age that no in-memory record describes.
export function shouldSync(trigger: PlaylistSyncTrigger, record: PlaylistSyncRecord, now: number, jitterMs = 0): boolean {
  if (trigger === 'manual' || trigger === 'launch') return true
  return now >= nextDueAt(record, jitterMs)
}

// Applied to the record after an attempt settles. Kept here rather than
// inline in the hook so "a success clears backoff, a failure advances it"
// is one rule with one test, not a behaviour scattered across call sites.
export function recordSuccess(at: number): PlaylistSyncRecord {
  return { lastSuccessAt: at, lastAttemptAt: at, consecutiveFailures: 0 }
}

export function recordFailure(record: PlaylistSyncRecord, at: number): PlaylistSyncRecord {
  return { ...record, lastAttemptAt: at, consecutiveFailures: record.consecutiveFailures + 1 }
}

export type GenerationValidation = { ok: true } | { ok: false; reason: 'empty' | 'collapsed' }

// The last gate before a fetched generation may replace a working one.
//
// "A malformed response or temporary 0-channel response must not
// automatically replace a healthy playlist without validation" — an empty
// result is already rejected upstream (EmptyPlaylistError), and this adds
// the case that one misses: a response that parses fine but carries a
// fraction of the catalogue, which is what a truncated download or a
// paginated API failing halfway actually looks like.
//
// A manual sync deliberately skips the shrink guard. If a provider really
// has cut its catalogue, the viewer pressing Sync is entitled to the truth;
// the guard exists to stop an UNATTENDED refresh from silently destroying a
// working playlist, not to overrule a person.
export function validateGeneration(
  nextChannelCount: number,
  previousChannelCount: number,
  trigger: PlaylistSyncTrigger,
): GenerationValidation {
  if (nextChannelCount === 0) return { ok: false, reason: 'empty' }
  if (trigger === 'manual') return { ok: true }
  if (previousChannelCount < SHRINK_GUARD_MIN_PREVIOUS_COUNT) return { ok: true }
  if (nextChannelCount < previousChannelCount * SHRINK_GUARD_MIN_RATIO) return { ok: false, reason: 'collapsed' }
  return { ok: true }
}

// Deterministic-in-tests jitter: the hook passes Math.random, tests pass a
// fixed value. Centred on zero so jitter never systematically delays or
// advances the cadence, only spreads it.
export function jitterFor(random: () => number = Math.random): number {
  return Math.round((random() - 0.5) * 2 * PLAYLIST_REFRESH_JITTER_MS)
}
