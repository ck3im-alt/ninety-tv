import { describe, expect, it, vi } from 'vitest'
import { createPlayerSessionController } from './playerSessionController'
import type { Player, PlayerState } from './types'

function createFakePlayer(): Player & {
  loadedUrls: string[]
  fail(): void
  stall(): void
  setStatus(status: PlayerState['status']): void
} {
  let state: PlayerState = {
    status: 'idle',
    currentTime: 0,
    duration: 0,
    error: null,
    subtitleTracks: [],
    activeSubtitleTrack: null,
    muted: true,
  }
  const listeners = new Set<(state: PlayerState) => void>()
  const loadedUrls: string[] = []

  function setState(patch: Partial<PlayerState>): void {
    state = { ...state, ...patch }
    for (const listener of listeners) listener(state)
  }

  return {
    attach() {},
    async load(url) {
      loadedUrls.push(url)
      setState({ status: 'loading', error: null })
    },
    async play() {
      setState({ status: 'playing' })
    },
    pause() {
      setState({ status: 'paused' })
    },
    seekBy() {},
    seekToLive() {},
    setMuted(muted) {
      setState({ muted })
    },
    setSubtitleTrack() {},
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      listeners.clear()
    },
    loadedUrls,
    fail() {
      setState({ status: 'error', error: { code: 'unknown', message: 'boom' } })
    },
    stall() {
      setState({
        status: 'error',
        error: {
          code: 'stalled',
          message: 'Playback stalled',
          diagnostics: {
            sourceType: 'mpegts',
            currentTime: 5,
            previousProgressingCurrentTime: 5,
            stalledDurationMs: 7000,
            readyState: 4,
            networkState: 2,
            bufferedRanges: [],
          },
        },
      })
    },
    setStatus(status) {
      setState({ status })
    },
  }
}

const URLS = ['http://x/1', 'http://x/2', 'http://x/3']

describe('createPlayerSessionController', () => {
  it('loads the initial source when attached', () => {
    const player = createFakePlayer()
    const controller = createPlayerSessionController(player, URLS)
    controller.attach({} as HTMLVideoElement)
    expect(player.loadedUrls).toEqual(['http://x/1'])
    expect(controller.getState().sourceIndex).toBe(0)
  })

  it('clamps an out-of-range initial index', () => {
    const player = createFakePlayer()
    const controller = createPlayerSessionController(player, URLS, 99)
    expect(controller.getState().sourceIndex).toBe(2)
  })

  it('fails over to the next untried source, in order, on error', () => {
    const player = createFakePlayer()
    const controller = createPlayerSessionController(player, URLS)
    controller.attach({} as HTMLVideoElement)

    player.fail() // source 0 fails
    expect(controller.getState().sourceIndex).toBe(1)
    expect(controller.getState().allSourcesFailed).toBe(false)
    expect(player.loadedUrls).toEqual(['http://x/1', 'http://x/2'])

    player.fail() // source 1 fails
    expect(controller.getState().sourceIndex).toBe(2)
    expect(player.loadedUrls).toEqual(['http://x/1', 'http://x/2', 'http://x/3'])
  })

  it('sets allSourcesFailed once every source has errored, and stops trying', () => {
    const player = createFakePlayer()
    const controller = createPlayerSessionController(player, URLS)
    controller.attach({} as HTMLVideoElement)

    player.fail()
    player.fail()
    player.fail() // source 2 fails — nothing untried left

    expect(controller.getState().allSourcesFailed).toBe(true)
    expect(player.loadedUrls).toEqual(['http://x/1', 'http://x/2', 'http://x/3'])
  })

  it('a manual selectSource loads immediately without resetting failover tracking', () => {
    const player = createFakePlayer()
    const controller = createPlayerSessionController(player, URLS)
    controller.attach({} as HTMLVideoElement)

    player.fail() // 0 fails -> tried={0}, moves to 1
    player.fail() // 1 fails -> tried={0,1}, moves to 2
    controller.selectSource(0) // user manually rewinds to the already-failed source 0
    expect(player.loadedUrls.at(-1)).toBe('http://x/1')

    // 0 fails again: tried is still {0,1} from before the manual detour, so
    // failover correctly skips the already-known-bad 1 and jumps to 2 —
    // proving the manual selectSource() call didn't reset tracking.
    player.fail()
    expect(controller.getState().sourceIndex).toBe(2)
  })

  it('ignores an out-of-range selectSource call', () => {
    const player = createFakePlayer()
    const controller = createPlayerSessionController(player, URLS)
    controller.attach({} as HTMLVideoElement)
    controller.selectSource(99)
    expect(controller.getState().sourceIndex).toBe(0)
    controller.selectSource(-1)
    expect(controller.getState().sourceIndex).toBe(0)
  })

  it('notifies subscribers on every relevant state change', () => {
    const player = createFakePlayer()
    const controller = createPlayerSessionController(player, URLS)
    controller.attach({} as HTMLVideoElement)
    const seen: string[] = []
    controller.subscribe((s) => seen.push(s.playerState.status))
    player.setStatus('playing')
    expect(seen).toEqual(['playing'])
  })

  it('dispose unsubscribes from the underlying player and stops emitting', () => {
    const player = createFakePlayer()
    const controller = createPlayerSessionController(player, URLS)
    controller.attach({} as HTMLVideoElement)
    const seen: string[] = []
    controller.subscribe((s) => seen.push(s.playerState.status))
    controller.dispose()
    player.setStatus('playing')
    expect(seen).toEqual([])
  })

  it('handles an empty source list without throwing', () => {
    const player = createFakePlayer()
    const controller = createPlayerSessionController(player, [])
    expect(() => controller.attach({} as HTMLVideoElement)).not.toThrow()
    expect(controller.getState().sourceIndex).toBe(0)
    expect(player.loadedUrls).toEqual([])
  })

  describe('bounded stall recovery', () => {
    it('a stall reloads the SAME source once, without advancing to the next one', () => {
      const player = createFakePlayer()
      const controller = createPlayerSessionController(player, URLS)
      controller.attach({} as HTMLVideoElement)
      player.stall()
      expect(controller.getState().sourceIndex).toBe(0)
      expect(player.loadedUrls).toEqual(['http://x/1', 'http://x/1'])
      expect(controller.getState().allSourcesFailed).toBe(false)
    })

    it('a second stall on the same source within the cooldown advances via normal failover', () => {
      let t = 0
      const player = createFakePlayer()
      const controller = createPlayerSessionController(player, URLS, 0, { now: () => t, stallRetryCooldownMs: 15000 })
      controller.attach({} as HTMLVideoElement)
      player.stall() // attempt 1: reload source 0
      t += 5000 // well within the cooldown
      player.stall() // attempt 2 on source 0 -> give up, advance
      expect(controller.getState().sourceIndex).toBe(1)
      expect(player.loadedUrls).toEqual(['http://x/1', 'http://x/1', 'http://x/2'])
    })

    it('a stall on a source AFTER the cooldown elapsed counts as a fresh episode (reloads once more, does not immediately advance)', () => {
      let t = 0
      const player = createFakePlayer()
      const controller = createPlayerSessionController(player, URLS, 0, { now: () => t, stallRetryCooldownMs: 15000 })
      controller.attach({} as HTMLVideoElement)
      player.stall() // attempt 1 on source 0
      t += 20000 // cooldown has elapsed — the reload evidently worked for a while
      player.stall() // treated as a FRESH first stall, not attempt 2
      expect(controller.getState().sourceIndex).toBe(0)
      expect(player.loadedUrls).toEqual(['http://x/1', 'http://x/1', 'http://x/1'])
    })

    it('never enters an infinite reload loop — repeated stalls eventually exhaust all sources and stop reloading entirely', () => {
      let t = 0
      const player = createFakePlayer()
      const controller = createPlayerSessionController(player, URLS, 0, { now: () => t, stallRetryCooldownMs: 15000 })
      controller.attach({} as HTMLVideoElement)
      // Drive enough stalls (within the cooldown each time) to exhaust all 3
      // sources: each source gets exactly one same-source reload attempt
      // before advancing (1 initial + 2 loads per source x 3 sources = 6),
      // then allSourcesFailed and every further stall is a pure no-op.
      for (let i = 0; i < 8; i++) {
        player.stall()
        t += 1000
      }
      expect(controller.getState().allSourcesFailed).toBe(true)
      expect(player.loadedUrls).toEqual(['http://x/1', 'http://x/1', 'http://x/2', 'http://x/2', 'http://x/3', 'http://x/3'])
      const countAfterExhaustion = player.loadedUrls.length
      // Further stalls after giving up must not trigger any more reloads.
      player.stall()
      player.stall()
      expect(player.loadedUrls.length).toBe(countAfterExhaustion)
    })

    it('a hard (non-stalled) error always advances immediately, even mid-stall-episode', () => {
      const player = createFakePlayer()
      const controller = createPlayerSessionController(player, URLS)
      controller.attach({} as HTMLVideoElement)
      player.stall() // attempt 1 on source 0 (reload same)
      player.fail() // a genuine hard error on the reloaded source 0
      expect(controller.getState().sourceIndex).toBe(1) // advanced immediately, not treated as stall-attempt-2
      expect(player.loadedUrls).toEqual(['http://x/1', 'http://x/1', 'http://x/2'])
    })

    it('a manual selectSource resets any in-progress stall episode for that source', () => {
      let t = 0
      const player = createFakePlayer()
      const controller = createPlayerSessionController(player, URLS, 0, { now: () => t, stallRetryCooldownMs: 15000 })
      controller.attach({} as HTMLVideoElement)
      player.stall() // attempt 1 on source 0
      controller.selectSource(0) // user manually re-picks the same source
      t += 5000 // still within what would have been the cooldown
      player.stall() // must be treated as a fresh attempt 1, not attempt 2
      expect(controller.getState().sourceIndex).toBe(0)
    })

    it('reports diagnostics (via console.warn) including recoveryAttempt and activePaneCount', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const player = createFakePlayer()
        const controller = createPlayerSessionController(player, URLS, 0, { getActivePaneCount: () => 3 })
        controller.attach({} as HTMLVideoElement)
        player.stall()
        expect(warnSpy).toHaveBeenCalledWith(
          '[playerSessionController] playback stall',
          expect.objectContaining({
            recoveryAttempt: 1,
            outcome: 'reload-same-source',
            activePaneCount: 3,
            sourceType: 'mpegts',
            stalledDurationMs: 7000,
          }),
        )
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('one controller stalling never mutates a completely independent sibling controller', () => {
      const playerA = createFakePlayer()
      const playerB = createFakePlayer()
      const controllerA = createPlayerSessionController(playerA, URLS)
      const controllerB = createPlayerSessionController(playerB, URLS)
      controllerA.attach({} as HTMLVideoElement)
      controllerB.attach({} as HTMLVideoElement)

      playerA.stall()
      playerA.stall() // exhausts source 0, advances A to source 1... let's push A further
      playerA.stall()
      playerA.stall()

      expect(playerB.loadedUrls).toEqual(['http://x/1']) // B untouched throughout
      expect(controllerB.getState().sourceIndex).toBe(0)
      expect(controllerB.getState().allSourcesFailed).toBe(false)
    })
  })
})
