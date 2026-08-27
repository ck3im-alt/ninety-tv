// The scheduling rules, tested without a clock, a network, or React — the
// same "test the decision, not the plumbing" split playlistDefinition.test.ts
// already uses for the library's other pure module.
import { describe, expect, it } from 'vitest'
import {
  FRESH_SYNC_RECORD,
  MAX_BACKOFF_MULTIPLIER,
  PLAYLIST_REFRESH_INTERVAL_MS,
  PLAYLIST_REFRESH_JITTER_MS,
  SHRINK_GUARD_MIN_PREVIOUS_COUNT,
  backoffMultiplier,
  jitterFor,
  nextDueAt,
  recordFailure,
  recordSuccess,
  shouldSync,
  validateGeneration,
  type PlaylistSyncRecord,
} from './playlistSyncPolicy'

const T0 = 1_700_000_000_000

describe('refresh cadence', () => {
  it('targets the 10-15 minute band the product requires', () => {
    expect(PLAYLIST_REFRESH_INTERVAL_MS).toBeGreaterThanOrEqual(10 * 60 * 1000)
    expect(PLAYLIST_REFRESH_INTERVAL_MS).toBeLessThanOrEqual(15 * 60 * 1000)
  })

  it('a playlist that has never synced is due immediately', () => {
    expect(nextDueAt(FRESH_SYNC_RECORD)).toBe(0)
    expect(shouldSync('interval', FRESH_SYNC_RECORD, T0)).toBe(true)
  })

  it('a playlist synced one minute ago is not due on the next tick', () => {
    const record = recordSuccess(T0)
    expect(shouldSync('interval', record, T0 + 60_000)).toBe(false)
    expect(shouldSync('resume', record, T0 + 60_000)).toBe(false)
    expect(shouldSync('playback-exit', record, T0 + 60_000)).toBe(false)
  })

  it('a playlist synced longer ago than the interval is due again', () => {
    const record = recordSuccess(T0)
    expect(shouldSync('interval', record, T0 + PLAYLIST_REFRESH_INTERVAL_MS + 1)).toBe(true)
  })

  it('resume after a long suspend refreshes; resume seconds later does not', () => {
    const record = recordSuccess(T0)
    expect(shouldSync('resume', record, T0 + 5_000)).toBe(false)
    expect(shouldSync('resume', record, T0 + 3 * PLAYLIST_REFRESH_INTERVAL_MS)).toBe(true)
  })

  it('launch and manual always run — a cached playlist has an unknown age, and a person pressing Sync must see something happen', () => {
    const justSynced = recordSuccess(T0)
    expect(shouldSync('launch', justSynced, T0 + 1)).toBe(true)
    expect(shouldSync('manual', justSynced, T0 + 1)).toBe(true)
  })
})

describe('failure backoff', () => {
  it('advances 1x, 2x, 4x and then holds at the cap', () => {
    expect(backoffMultiplier(0)).toBe(1)
    expect(backoffMultiplier(1)).toBe(1)
    expect(backoffMultiplier(2)).toBe(2)
    expect(backoffMultiplier(3)).toBe(4)
    expect(backoffMultiplier(9)).toBe(MAX_BACKOFF_MULTIPLIER)
  })

  it('counts from the last ATTEMPT while failing, so a dead provider is not re-hit by every resume', () => {
    let record: PlaylistSyncRecord = recordSuccess(T0)
    record = recordFailure(record, T0 + PLAYLIST_REFRESH_INTERVAL_MS)
    const dueAt = nextDueAt(record)
    expect(dueAt).toBe(T0 + PLAYLIST_REFRESH_INTERVAL_MS + PLAYLIST_REFRESH_INTERVAL_MS)
    expect(shouldSync('resume', record, dueAt - 1)).toBe(false)
    expect(shouldSync('resume', record, dueAt)).toBe(true)
  })

  it('a success clears the backoff entirely', () => {
    let record: PlaylistSyncRecord = FRESH_SYNC_RECORD
    record = recordFailure(record, T0)
    record = recordFailure(record, T0 + 1)
    record = recordFailure(record, T0 + 2)
    expect(record.consecutiveFailures).toBe(3)
    record = recordSuccess(T0 + 3)
    expect(record.consecutiveFailures).toBe(0)
    expect(nextDueAt(record)).toBe(T0 + 3 + PLAYLIST_REFRESH_INTERVAL_MS)
  })

  it('never retries tighter than the base interval — no retry storm is reachable', () => {
    let record: PlaylistSyncRecord = FRESH_SYNC_RECORD
    for (let attempt = 1; attempt <= 12; attempt++) {
      record = recordFailure(record, T0)
      expect(nextDueAt(record) - T0).toBeGreaterThanOrEqual(PLAYLIST_REFRESH_INTERVAL_MS)
    }
  })
})

describe('jitter', () => {
  it('is centred on zero and bounded by the configured spread', () => {
    expect(jitterFor(() => 0)).toBe(-PLAYLIST_REFRESH_JITTER_MS)
    expect(jitterFor(() => 1)).toBe(PLAYLIST_REFRESH_JITTER_MS)
    expect(jitterFor(() => 0.5)).toBe(0)
  })

  it('shifts the due time without changing whether launch/manual run', () => {
    const record = recordSuccess(T0)
    const late = PLAYLIST_REFRESH_JITTER_MS
    expect(shouldSync('interval', record, T0 + PLAYLIST_REFRESH_INTERVAL_MS + 1, late)).toBe(false)
    expect(shouldSync('interval', record, T0 + PLAYLIST_REFRESH_INTERVAL_MS + late, late)).toBe(true)
    expect(shouldSync('manual', record, T0, late)).toBe(true)
  })
})

describe('generation validation — a provider outage must not wipe a working playlist', () => {
  it('rejects an empty generation from every trigger, manual included', () => {
    expect(validateGeneration(0, 30_000, 'interval')).toEqual({ ok: false, reason: 'empty' })
    expect(validateGeneration(0, 30_000, 'manual')).toEqual({ ok: false, reason: 'empty' })
  })

  it('rejects an automatic generation that collapsed to a fraction of the previous one', () => {
    expect(validateGeneration(500, 30_000, 'interval')).toEqual({ ok: false, reason: 'collapsed' })
    expect(validateGeneration(500, 30_000, 'resume')).toEqual({ ok: false, reason: 'collapsed' })
    expect(validateGeneration(500, 30_000, 'launch')).toEqual({ ok: false, reason: 'collapsed' })
  })

  it('accepts a real, ordinary catalogue change', () => {
    expect(validateGeneration(29_000, 30_000, 'interval')).toEqual({ ok: true })
    expect(validateGeneration(31_500, 30_000, 'interval')).toEqual({ ok: true })
    // A third of the catalogue gone is unusual but happens — the guard is
    // for the pathological case only.
    expect(validateGeneration(20_000, 30_000, 'interval')).toEqual({ ok: true })
  })

  it('lets a MANUAL sync override the shrink guard — the viewer is entitled to the truth', () => {
    expect(validateGeneration(500, 30_000, 'manual')).toEqual({ ok: true })
  })

  it('does not apply the ratio test to genuinely small playlists', () => {
    expect(validateGeneration(1, SHRINK_GUARD_MIN_PREVIOUS_COUNT - 1, 'interval')).toEqual({ ok: true })
  })
})
