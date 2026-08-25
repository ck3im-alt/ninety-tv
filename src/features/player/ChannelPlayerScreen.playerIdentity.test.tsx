// @vitest-environment jsdom
//
// Regression coverage for the live-scores/background-sync feature's core
// Player-safety requirement: a background sports-data refresh in App.tsx
// (useHomeFeed's silent ~60s/visibility-regain/player-exit revalidation)
// must NEVER remount or reinitialize the player, interrupt playback, or
// recreate the underlying <video> element. ChannelPlayerScreen itself
// doesn't consume any sports/event data (confirmed by inspection — its
// Props are channels/initialSourceLabel/initialDisplayParts/onBack/
// onAddToMultiview, none of which useHomeFeed touches), and
// usePlayerSession.ts creates its Player/PlayerSessionController via
// useMemo with stable deps ([] / [player]) specifically so a parent
// re-render can never recreate them — this test proves that guarantee
// holds for the actual mounted component tree, not just by inspection.
//
// `scoreTick` below stands in for App.tsx re-rendering because
// homeFeedState changed (a background refresh completing) — the harness
// re-renders around ChannelPlayerScreen exactly the way App.tsx's own
// conditional `{screen === 'player' && <ChannelPlayerScreen .../>}` would
// when a sibling piece of state it doesn't consume changes.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { init } from '@noriginmedia/norigin-spatial-navigation'
import { ChannelPlayerScreen } from './ChannelPlayerScreen'
import type { Channel } from '../../data/channel'
import type { Player, PlayerState } from '../../core/player/types'

// Same one-time setup main.tsx does before ever rendering <App/> — without
// it, norigin-spatial-navigation's internal SpatialNavigationService is
// unconfigured and every useFocusable() registration inside
// ChannelPlayerScreen throws an unhandled "measureLayout" rejection in
// jsdom (harmless to these tests' own assertions, but noisy/misleading).
init({ debug: false, visualDebug: false })

const { createHtmlVideoPlayerMock } = vi.hoisted(() => ({
  createHtmlVideoPlayerMock: vi.fn(),
}))

vi.mock('../../core/player/htmlVideoPlayer', () => ({
  createHtmlVideoPlayer: createHtmlVideoPlayerMock,
  preloadPlayerEngine: vi.fn(),
}))

// Same fake-Player shape/style as playerSessionController.test.ts's own
// createFakePlayer — jsdom has no real <video>/HLS pipeline, so every real
// createHtmlVideoPlayer() call is replaced with one of these.
function createFakePlayer(): Player {
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
  function setState(patch: Partial<PlayerState>): void {
    state = { ...state, ...patch }
    for (const listener of listeners) listener(state)
  }
  return {
    attach() {},
    async load() {
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
  }
}

const TEST_CHANNEL: Channel = {
  id: 'chan1',
  name: 'Test Sports Channel',
  sources: [{ label: 'HD', url: 'https://example.test/stream.m3u8' }],
}

function Harness({ scoreTick }: { scoreTick: number }) {
  return (
    <div data-score-tick={scoreTick}>
      <ChannelPlayerScreen channels={[TEST_CHANNEL]} onBack={() => {}} />
    </div>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ChannelPlayerScreen player identity across unrelated parent re-renders', () => {
  it('creates the underlying player exactly once, even after several unrelated parent re-renders (simulated background score refreshes)', async () => {
    createHtmlVideoPlayerMock.mockImplementation(() => createFakePlayer())
    const { rerender } = render(<Harness scoreTick={0} />)
    expect(createHtmlVideoPlayerMock).toHaveBeenCalledTimes(1)

    for (let tick = 1; tick <= 5; tick++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        rerender(<Harness scoreTick={tick} />)
      })
    }

    expect(createHtmlVideoPlayerMock).toHaveBeenCalledTimes(1)
  })

  it('never recreates the <video> DOM element across unrelated parent re-renders', async () => {
    createHtmlVideoPlayerMock.mockImplementation(() => createFakePlayer())
    const { container, rerender } = render(<Harness scoreTick={0} />)
    const videoElBefore = container.querySelector('video')
    expect(videoElBefore).not.toBeNull()

    for (let tick = 1; tick <= 5; tick++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        rerender(<Harness scoreTick={tick} />)
      })
    }

    const videoElAfter = container.querySelector('video')
    expect(videoElAfter).toBe(videoElBefore)
  })

  it('does not reset playback state (e.g. an in-progress "playing" status) across unrelated parent re-renders', async () => {
    let fakePlayer: Player | null = null
    createHtmlVideoPlayerMock.mockImplementation(() => {
      fakePlayer = createFakePlayer()
      return fakePlayer
    })
    const { rerender } = render(<Harness scoreTick={0} />)

    // Drive the fake engine to 'playing', the way a real load()+play() would.
    await act(async () => {
      await fakePlayer!.play()
    })
    expect(fakePlayer!.getState().status).toBe('playing')

    await act(async () => {
      rerender(<Harness scoreTick={1} />)
    })

    // Re-check the SAME fake player instance (proves it's the same
    // underlying engine, not a fresh one reset back to 'idle').
    expect(fakePlayer!.getState().status).toBe('playing')
    expect(createHtmlVideoPlayerMock).toHaveBeenCalledTimes(1)
  })
})
