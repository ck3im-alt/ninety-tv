// @vitest-environment jsdom
//
// Integration coverage for the Samsung screensaver lease at the seam it is
// actually taken from: usePlayerSession, which is shared by the full-screen
// player and every Multiview pane. screenSaver.test.ts already proves the
// coordinator's arithmetic in isolation; what this file proves is that real
// player STATE TRANSITIONS drive it — that a session which starts playing
// acquires, one that pauses/errors/unmounts releases, and that several
// concurrent sessions still produce one correct global state.
//
// The coordinator is spied on rather than replaced: the module singleton is
// what production uses, and asserting against the calls it receives keeps
// this honest about the wiring instead of about a stand-in.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayerSession } from './usePlayerSession'
import { playbackScreenSaver } from '../platform/screenSaver'
import type { Player, PlayerState } from './types'

const { createHtmlVideoPlayerMock } = vi.hoisted(() => ({ createHtmlVideoPlayerMock: vi.fn() }))
vi.mock('./htmlVideoPlayer', () => ({
  createHtmlVideoPlayer: createHtmlVideoPlayerMock,
  preloadPlayerEngine: vi.fn(),
}))

interface ControllablePlayer extends Player {
  emit(patch: Partial<PlayerState>): void
}

// Deliberately does NOT auto-advance to 'playing' on play(), unlike the
// audio-tracks harness — every transition here is driven explicitly so the
// lease can be observed at each step.
function createFakePlayer(): ControllablePlayer {
  let state: PlayerState = {
    status: 'idle',
    currentTime: 0,
    duration: 0,
    error: null,
    subtitleTracks: [],
    activeSubtitleTrack: null,
    audioTracks: [],
    activeAudioTrack: null,
    muted: true,
  }
  const listeners = new Set<(state: PlayerState) => void>()
  function setState(patch: Partial<PlayerState>): void {
    state = { ...state, ...patch }
    for (const listener of listeners) listener(state)
  }
  return {
    attach() {},
    async load() {
      setState({ status: 'loading', error: null })
    },
    async play() {},
    pause() {},
    seekBy() {},
    seekToLive() {},
    setMuted() {},
    setSubtitleTrack() {},
    setAudioTrack() {},
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      listeners.clear()
    },
    emit: setState,
  }
}

function Pane({ player }: { player: ControllablePlayer }) {
  createHtmlVideoPlayerMock.mockImplementation(() => player)
  const { videoRef } = usePlayerSession(['https://provider.example/a.m3u8'])
  return <video ref={videoRef} />
}

let acquireSpy: ReturnType<typeof vi.spyOn>
let releaseCount = 0

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('usePlayerSession screensaver lease', () => {
  beforeEach(() => {
    releaseCount = 0
    playbackScreenSaver.releaseAll()
    const realAcquire = playbackScreenSaver.acquire.bind(playbackScreenSaver)
    acquireSpy = vi.spyOn(playbackScreenSaver, 'acquire').mockImplementation(() => {
      const release = realAcquire()
      return () => {
        releaseCount++
        release()
      }
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    playbackScreenSaver.releaseAll()
  })

  it('does not hold a lease while a session is merely loading', () => {
    // A channel that never starts must not suppress the screensaver
    // indefinitely.
    const player = createFakePlayer()
    render(<Pane player={player} />)

    expect(acquireSpy).not.toHaveBeenCalled()
    expect(playbackScreenSaver.getActiveCount()).toBe(0)
  })

  it('acquires when the engine reports playback started', async () => {
    const player = createFakePlayer()
    render(<Pane player={player} />)
    await flush()

    await act(async () => {
      player.emit({ status: 'playing' })
    })

    expect(acquireSpy).toHaveBeenCalledTimes(1)
    expect(playbackScreenSaver.getActiveCount()).toBe(1)
  })

  it('releases on pause and re-acquires on resume', async () => {
    const player = createFakePlayer()
    render(<Pane player={player} />)
    await flush()

    await act(async () => player.emit({ status: 'playing' }))
    expect(playbackScreenSaver.getActiveCount()).toBe(1)

    await act(async () => player.emit({ status: 'paused' }))
    expect(playbackScreenSaver.getActiveCount()).toBe(0)

    await act(async () => player.emit({ status: 'playing' }))
    expect(playbackScreenSaver.getActiveCount()).toBe(1)
  })

  it('releases when playback errors out', async () => {
    const player = createFakePlayer()
    render(<Pane player={player} />)
    await flush()
    await act(async () => player.emit({ status: 'playing' }))

    await act(async () => player.emit({ status: 'error', error: { code: 'network', message: 'gone' } }))

    expect(playbackScreenSaver.getActiveCount()).toBe(0)
  })

  it('releases when the session unmounts', async () => {
    const player = createFakePlayer()
    render(<Pane player={player} />)
    await flush()
    await act(async () => player.emit({ status: 'playing' }))
    expect(playbackScreenSaver.getActiveCount()).toBe(1)

    cleanup()

    expect(playbackScreenSaver.getActiveCount()).toBe(0)
    expect(releaseCount).toBe(1)
  })

  it('four concurrent playing panes hold four leases and one global state', async () => {
    const players = [createFakePlayer(), createFakePlayer(), createFakePlayer(), createFakePlayer()]
    function Grid() {
      return (
        <>
          {players.map((player, index) => (
            <Pane key={index} player={player} />
          ))}
        </>
      )
    }
    render(<Grid />)
    await flush()

    for (const player of players) {
      await act(async () => player.emit({ status: 'playing' }))
    }

    expect(playbackScreenSaver.getActiveCount()).toBe(4)
  })

  it('one pane erroring leaves the screensaver suppressed while the others still play', async () => {
    // The Multiview failure the coordinator exists for, reached through
    // real hook state rather than by calling acquire/release directly.
    const players = [createFakePlayer(), createFakePlayer(), createFakePlayer()]
    function Grid() {
      return (
        <>
          {players.map((player, index) => (
            <Pane key={index} player={player} />
          ))}
        </>
      )
    }
    render(<Grid />)
    await flush()
    for (const player of players) {
      await act(async () => player.emit({ status: 'playing' }))
    }

    await act(async () => players[0].emit({ status: 'error', error: { code: 'network', message: 'gone' } }))

    expect(playbackScreenSaver.getActiveCount()).toBe(2)
  })
})
