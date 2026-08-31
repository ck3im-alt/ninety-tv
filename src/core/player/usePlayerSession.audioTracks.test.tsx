// @vitest-environment jsdom
//
// usePlayerSession deliberately suppresses re-renders for player state the
// UI does not read — otherwise every ~4x/sec `timeupdate` would re-render an
// OSD while up to four decoders are running on TV silicon.
//
// That optimisation is also the one way multi-audio can silently not work:
// discovery and switching both happen INSIDE the Player, driven by engine
// events, so a state comparison blind to audio would leave the OSD showing
// no Audio control on a multi-audio stream and a checkmark that never moves,
// with the Player layer itself entirely correct. These tests exercise the
// comparison through the hook (it is intentionally module-private) via the
// thing it actually controls: whether the hook hands the component a NEW
// state object or keeps the previous one. That identity is the contract —
// raw render counts are not, since React may still render a component once
// before bailing out of an update that produced an equal value.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlayerSession } from './usePlayerSession'
import type { PlayerSessionState } from './playerSessionController'
import type { AudioTrack, Player, PlayerState } from './types'

const { createHtmlVideoPlayerMock } = vi.hoisted(() => ({ createHtmlVideoPlayerMock: vi.fn() }))
vi.mock('./htmlVideoPlayer', () => ({
  createHtmlVideoPlayer: createHtmlVideoPlayerMock,
  preloadPlayerEngine: vi.fn(),
}))

// A Player whose audio state can be driven from the test the way engine
// events drive the real one.
interface ControllablePlayer extends Player {
  emit(patch: Partial<PlayerState>): void
}

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
      setState({ status: 'loading', error: null, audioTracks: [], activeAudioTrack: null })
    },
    async play() {
      setState({ status: 'playing' })
    },
    pause() {},
    seekBy() {},
    seekToLive() {},
    setMuted(muted) {
      setState({ muted })
    },
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

const SCANDI: AudioTrack[] = [
  { id: 'hls:aud:3', label: 'Norsk', language: 'nor' },
  { id: 'hls:aud:4', label: 'Svenska', language: 'swe' },
]

async function renderSession() {
  const player = createFakePlayer()
  createHtmlVideoPlayerMock.mockImplementation(() => player)
  let renders = 0
  let latestSession: PlayerSessionState | null = null
  function Harness() {
    const { videoRef, state } = usePlayerSession(['https://provider.example/a.m3u8'])
    renders++
    latestSession = state
    return <video ref={videoRef} />
  }
  render(<Harness />)
  // attach() kicks off load().then(play) — two microtask hops before the
  // status settles. Flushed here so the assertions below are about the
  // audio comparison rather than about mount timing.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  return {
    player,
    renderCount: () => renders,
    // The exact object the hook is holding. sessionStateEqual returning
    // true means this reference is preserved.
    session: () => latestSession!,
    state: () => latestSession!.playerState,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('usePlayerSession audio state equality', () => {
  it('publishes newly discovered audio tracks to the UI', async () => {
    const { player, session, state } = await renderSession()
    const before = session()

    await act(async () => player.emit({ audioTracks: SCANDI, activeAudioTrack: 'hls:aud:3' }))

    expect(session()).not.toBe(before)
    expect(state().audioTracks).toEqual(SCANDI)
  })

  it('publishes a switch when the active track changes but the list does not', async () => {
    const { player, session, state } = await renderSession()
    await act(async () => player.emit({ audioTracks: SCANDI, activeAudioTrack: 'hls:aud:3' }))
    const before = session()

    // The switch-confirmed case: same tracks, different selection. This is
    // exactly what moves the checkmark.
    await act(async () => player.emit({ activeAudioTrack: 'hls:aud:4' }))

    expect(session()).not.toBe(before)
    expect(state().activeAudioTrack).toBe('hls:aud:4')
  })

  it('publishes a track label or language that changed in place', async () => {
    const { player, session } = await renderSession()
    await act(async () => player.emit({ audioTracks: SCANDI, activeAudioTrack: 'hls:aud:3' }))

    const beforeLabel = session()
    await act(async () => player.emit({ audioTracks: [{ ...SCANDI[0], label: 'Ekspertkommentar' }, SCANDI[1]] }))
    expect(session()).not.toBe(beforeLabel)

    // The language drives the popup's chip, so it is just as visible.
    const beforeLanguage = session()
    await act(async () => player.emit({ audioTracks: [{ ...SCANDI[0], label: 'Ekspertkommentar', language: 'nb' }, SCANDI[1]] }))
    expect(session()).not.toBe(beforeLanguage)
  })

  it('publishes the cleared list when a new source drops the previous tracks', async () => {
    const { player, session, state } = await renderSession()
    await act(async () => player.emit({ audioTracks: SCANDI, activeAudioTrack: 'hls:aud:3' }))
    const before = session()

    await act(async () => player.emit({ audioTracks: [], activeAudioTrack: null }))

    expect(session()).not.toBe(before)
    expect(state().audioTracks).toEqual([])
  })

  it('holds the previous state object when the audio state is unchanged', async () => {
    const { player, session } = await renderSession()
    await act(async () => player.emit({ audioTracks: SCANDI, activeAudioTrack: 'hls:aud:3' }))
    const before = session()

    // A fresh array of structurally identical tracks — engine refreshes
    // rebuild the list on every event, so reference inequality here is the
    // normal case, not the exception. Comparing by value is what stops that
    // becoming a re-render per event.
    await act(async () => player.emit({ audioTracks: SCANDI.map((track) => ({ ...track })), activeAudioTrack: 'hls:aud:3' }))

    expect(session()).toBe(before)
  })

  // The property the audio comparison must not have cost us.
  it('still ignores currentTime ticks entirely', async () => {
    const { player, session, renderCount } = await renderSession()
    await act(async () => player.emit({ audioTracks: SCANDI, activeAudioTrack: 'hls:aud:3' }))
    const before = session()
    const rendersBefore = renderCount()

    await act(async () => {
      for (let t = 1; t <= 20; t++) player.emit({ currentTime: t })
    })

    expect(session()).toBe(before)
    // 20 ticks must not cost 20 renders. React can still render once before
    // bailing out of an equal update, so this is a bound rather than an
    // equality — the thing that matters is that it does not scale with the
    // tick rate.
    expect(renderCount() - rendersBefore).toBeLessThanOrEqual(1)
  })
})
