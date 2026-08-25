// Pure, framework-agnostic layer over a `Player` (see types.ts) that adds
// the "ordered list of candidate source URLs, fail over to the next untried
// one on error" policy ChannelPlayerScreen used to implement inline as a
// pair of React effects. Kept as a plain object factory — same shape as
// createHtmlVideoPlayer() itself — so this failover state machine is
// testable with a fake Player and no DOM/React/timers, and so a Multiview
// pane can reuse the exact same policy independently of any screen. See
// usePlayerSession.ts for the thin React wrapper.
//
// Stall recovery: a 'stalled' PlayerError (see types.ts/
// playbackStallWatchdog.ts — playback silently stopped advancing with no
// video.error and no engine ERROR event) gets its OWN bounded policy,
// distinct from a hard error's immediate advance-to-next-source: reload the
// SAME source once first (a stall is often transient/recoverable in place),
// and only fall through to the normal next-source failover if that same
// source stalls AGAIN within a cooldown window. This never loops
// indefinitely — at most one extra same-source reload per stall episode,
// then it's just the existing, already-bounded source rotation.
import type { Player, PlayerState } from './types'

export interface PlayerSessionState {
  playerState: PlayerState
  sourceIndex: number
  // Every candidate source has now errored at least once with nothing left
  // to try — mirrors ChannelPlayerScreen's original allSourcesFailed, INCLUDING
  // its original quirk of never resetting on a manual selectSource() call
  // (only a brand-new controller instance resets it) — preserved
  // deliberately so the refactor changes no observable behavior.
  allSourcesFailed: boolean
}

export interface PlayerSessionController {
  attach(element: HTMLVideoElement): void
  getState(): PlayerSessionState
  subscribe(listener: (state: PlayerSessionState) => void): () => void
  // Manual source pick (e.g. the Source/Change-source popup) — loads
  // immediately. Deliberately does NOT reset the failover-tried set or
  // allSourcesFailed, matching ChannelPlayerScreen's original behavior (see
  // allSourcesFailed above).
  selectSource(index: number): void
  play(): Promise<void>
  pause(): void
  seekToLive(): void
  setMuted(muted: boolean): void
  setSubtitleTrack(id: string | null): void
  dispose(): void
}

export interface PlayerSessionOptions {
  // Diagnostic-only — lets a caller (e.g. a Multiview pane) report how many
  // panes are active whenever a stall/recovery is logged, without this
  // controller needing any knowledge of Multiview itself (see the task
  // spec's "do not make this Multiview-only" constraint). Re-read on every
  // log, so a caller can back it with a ref that always reflects current
  // state rather than whatever was true when the controller was created.
  // Defaults to 1 (the ordinary single-stream case).
  getActivePaneCount?: () => number
  // How long a same-source reload must go without a repeat stall before a
  // LATER stall on that source counts as a fresh episode (reload once more)
  // rather than "the reload didn't help" (advance to the next source). See
  // the module header.
  stallRetryCooldownMs?: number
  now?: () => number
}

const DEFAULT_STALL_RETRY_COOLDOWN_MS = 15000

function clampIndex(index: number, length: number): number {
  if (length === 0) return 0
  return Math.min(Math.max(index, 0), length - 1)
}

export function createPlayerSessionController(
  player: Player,
  sourceUrls: readonly string[],
  initialIndex = 0,
  options: PlayerSessionOptions = {},
): PlayerSessionController {
  const { getActivePaneCount = () => 1, stallRetryCooldownMs = DEFAULT_STALL_RETRY_COOLDOWN_MS, now = () => Date.now() } = options

  let sourceIndex = clampIndex(initialIndex, sourceUrls.length)
  let allSourcesFailed = false
  const triedIndices = new Set<number>()
  const listeners = new Set<(state: PlayerSessionState) => void>()
  let disposed = false

  // Tracks an in-progress "did our one same-source reload attempt actually
  // fix it" window for whichever sourceIndex most recently stalled — reset
  // (by construction: the sourceIndex check below) whenever a different
  // source is involved, so this never accumulates stale state across a
  // successful failover/manual selection.
  let stallEpisode: { sourceIndex: number; attemptCount: number; lastStallAt: number } | null = null

  function currentState(): PlayerSessionState {
    return { playerState: player.getState(), sourceIndex, allSourcesFailed }
  }

  function emit(): void {
    if (disposed) return
    const state = currentState()
    for (const listener of listeners) listener(state)
  }

  function loadCurrent(): void {
    const url = sourceUrls[sourceIndex]
    if (url === undefined) return
    void player.load(url).then(() => player.play())
  }

  function advanceToNextUntriedOrFail(): void {
    triedIndices.add(sourceIndex)
    const nextIndex = sourceUrls.findIndex((_, i) => !triedIndices.has(i))
    if (nextIndex !== -1) {
      sourceIndex = nextIndex
      loadCurrent()
      return
    }
    allSourcesFailed = true
  }

  function logStallDiagnostics(playerState: PlayerState, recoveryAttempt: number, outcome: 'reload-same-source' | 'advance-to-next-source'): void {
    console.warn('[playerSessionController] playback stall', {
      ...playerState.error?.diagnostics,
      recoveryAttempt,
      outcome,
      sourceIndex,
      activePaneCount: getActivePaneCount(),
    })
  }

  function handleStall(playerState: PlayerState): void {
    // Nothing left to try — every source is already exhausted. Without this
    // guard, a player that keeps emitting stall signals after we've already
    // given up (e.g. a still-mounted but abandoned <video>) would keep
    // reloading the last-tried source forever, one stall event at a time.
    if (allSourcesFailed) return
    const t = now()
    const sameEpisode = stallEpisode !== null && stallEpisode.sourceIndex === sourceIndex && t - stallEpisode.lastStallAt < stallRetryCooldownMs

    if (sameEpisode) {
      const attemptCount = stallEpisode!.attemptCount + 1
      stallEpisode = { sourceIndex, attemptCount, lastStallAt: t }
      // The one bounded same-source reload already happened and this
      // source stalled again within the cooldown — it didn't help. Give up
      // on this source (never a second same-source reload, so this can
      // never loop) and fall through to the existing, already-bounded
      // next-source rotation.
      logStallDiagnostics(playerState, attemptCount, 'advance-to-next-source')
      stallEpisode = null
      advanceToNextUntriedOrFail()
      return
    }

    // First stall on this source (or a stall arriving long after a prior
    // recovery — the cooldown elapsed, so that prior reload evidently DID
    // work for a while, and this counts as a fresh episode rather than a
    // repeat failure).
    stallEpisode = { sourceIndex, attemptCount: 1, lastStallAt: t }
    logStallDiagnostics(playerState, 1, 'reload-same-source')
    loadCurrent()
  }

  // Subscribes for this controller's whole lifetime (unsubscribed only on
  // dispose) — the failover policy has to see every status change, not just
  // ones a currently-mounted React component happens to be listening for.
  const unsubscribePlayer = player.subscribe((playerState) => {
    if (disposed) return
    if (playerState.status === 'error' && sourceUrls.length > 0) {
      if (playerState.error?.code === 'stalled') {
        handleStall(playerState)
        emit()
        return
      }
      // A hard error (not a stall) always clears any in-progress stall
      // bookkeeping for this source — it's a different, immediately
      // actionable failure, not a second data point on the stall episode.
      stallEpisode = null
      advanceToNextUntriedOrFail()
      emit()
      return
    }
    emit()
  })

  return {
    attach(element) {
      player.attach(element)
      loadCurrent()
    },

    getState: currentState,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    selectSource(index) {
      if (index < 0 || index >= sourceUrls.length) return
      stallEpisode = null
      sourceIndex = index
      loadCurrent()
      emit()
    },

    play: () => player.play(),
    pause: () => player.pause(),
    seekToLive: () => player.seekToLive(),
    setMuted: (muted) => player.setMuted(muted),
    setSubtitleTrack: (id) => player.setSubtitleTrack(id),

    dispose() {
      disposed = true
      unsubscribePlayer()
      listeners.clear()
      player.dispose()
    },
  }
}
