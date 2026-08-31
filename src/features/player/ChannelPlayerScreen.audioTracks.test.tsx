// @vitest-environment jsdom
//
// The Audio control in the full-screen OSD: when it exists at all, and how
// it behaves under a remote.
//
// Two properties carry most of the weight here. The control is rendered
// ONLY when the stream offers a real choice (2+ renditions), because a
// channel with one audio track has nothing to decide and a toolbar button
// that opens a one-row menu is pure clutter — and because a control that is
// not rendered registers no focusable, so it cannot be reached by the D-pad
// at all. And Source / Audio / Text are mutually exclusive: three popups
// anchored over the same toolbar can never be open together, or the OSD
// stacks overlapping menus with focus scoped into whichever mounted last.
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrentFocusKey, init, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { ChannelPlayerScreen } from './ChannelPlayerScreen'
import { handleBackPress } from '../../core/platform'
import type { Channel } from '../../data/channel'
import type { AudioTrack, Player, PlayerState, SubtitleTrack } from '../../core/player/types'

init({ debug: false, visualDebug: false })
Element.prototype.scrollIntoView = () => {}

const { createHtmlVideoPlayerMock } = vi.hoisted(() => ({ createHtmlVideoPlayerMock: vi.fn() }))
vi.mock('../../core/player/htmlVideoPlayer', () => ({
  createHtmlVideoPlayer: createHtmlVideoPlayerMock,
  preloadPlayerEngine: vi.fn(),
}))

// The three commentary renditions of a V Sport Ultra-style channel, in the
// shape the Player layer publishes them (see
// htmlVideoPlayer.audioTracks.test.ts for how they get there).
const SCANDI_TRACKS: AudioTrack[] = [
  { id: 'hls:aud:3', label: 'Norsk', language: 'nor' },
  { id: 'hls:aud:4', label: 'Svenska', language: 'swe' },
  { id: 'hls:aud:5', label: 'Dansk', language: 'dan' },
]

interface FakePlayerOptions {
  audioTracks?: AudioTrack[]
  activeAudioTrack?: string | null
  subtitleTracks?: SubtitleTrack[]
}

interface FakePlayer extends Player {
  audioTrackCalls: string[]
  // Lets a test confirm the switch the way the real engine does — the
  // checkmark follows the ENGINE, not the keypress.
  confirmAudioSwitch(id: string): void
  // Discovery arriving after the screen is already up, the way a parsed
  // manifest really arrives.
  publishAudioTracks(tracks: AudioTrack[], active: string | null): void
}

function createFakePlayer({ audioTracks = [], activeAudioTrack = null, subtitleTracks = [] }: FakePlayerOptions = {}): FakePlayer {
  let state: PlayerState = {
    status: 'idle',
    currentTime: 0,
    duration: 0,
    error: null,
    subtitleTracks,
    activeSubtitleTrack: null,
    audioTracks,
    activeAudioTrack,
    muted: true,
  }
  const listeners = new Set<(state: PlayerState) => void>()
  const audioTrackCalls: string[] = []
  function setState(patch: Partial<PlayerState>): void {
    state = { ...state, ...patch }
    for (const listener of listeners) listener(state)
  }
  return {
    audioTrackCalls,
    confirmAudioSwitch(id) {
      setState({ activeAudioTrack: id })
    },
    publishAudioTracks(tracks, active) {
      setState({ audioTracks: tracks, activeAudioTrack: active })
    },
    attach() {},
    async load() {
      // Mirrors the real player: a load clears audio state, then the engine
      // republishes it. Re-publishing immediately keeps these tests about
      // the OSD rather than about engine timing.
      setState({ status: 'loading', error: null, audioTracks, activeAudioTrack })
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
    setAudioTrack(id) {
      audioTrackCalls.push(id)
    },
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
  name: 'V Sport Ultra',
  sources: [{ label: 'HD', url: 'https://provider.example/vsport-ultra.m3u8' }],
}

const OK = { key: 'Enter', keyCode: 13 }

async function press(keyInit: { key: string; keyCode: number }): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(window, keyInit)
    await Promise.resolve()
  })
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function renderPlayer(options: FakePlayerOptions = {}) {
  const player = createFakePlayer(options)
  createHtmlVideoPlayerMock.mockImplementation(() => player)
  const onBack = vi.fn()
  const view = render(<ChannelPlayerScreen channels={[TEST_CHANNEL]} onBack={onBack} />)
  const audioButton = () => [...view.container.querySelectorAll('.toolbar-btn')].find((btn) => btn.textContent?.includes('Audio')) ?? null
  const rows = () => [...view.container.querySelectorAll('.option-row')]
  return { ...view, player, onBack, audioButton, rows, popup: () => view.container.querySelector('.options-popup') }
}

// Reveals the OSD and puts focus on a named toolbar control.
async function revealAndFocus(view: ReturnType<typeof renderPlayer>, focusKey: string) {
  await settle()
  await press(OK)
  await settle()
  await act(async () => {
    await setFocus(focusKey)
  })
  return view
}

// Reveals the OSD, focuses a toolbar control and activates it.
async function openPopupFrom(view: ReturnType<typeof renderPlayer>, focusKey: string) {
  await revealAndFocus(view, focusKey)
  await press(OK)
  await settle()
  return view
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  // norigin's focus service is a module-level singleton that outlives
  // cleanup() — park it on a key nothing here registers so one test cannot
  // hand the next a pre-focused control. Same guard the OSD focus suite uses.
  await setFocus('test-neutral-focus-key')
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  cleanup()
  vi.clearAllMocks()
})

describe('Audio control visibility', () => {
  it('is absent when the engine reports no audio tracks', async () => {
    // The raw MPEG-TS case: mpegts.js cannot enumerate the extra commentary
    // PIDs, so the honest answer is an empty list — and an empty list must
    // not produce a control that opens an empty menu.
    const view = renderPlayer({ audioTracks: [] })
    await settle()
    await press(OK)
    await settle()

    expect(view.audioButton()).toBeNull()
  })

  it('is absent when the stream declares exactly one audio track', async () => {
    const view = renderPlayer({ audioTracks: [SCANDI_TRACKS[0]], activeAudioTrack: 'hls:aud:3' })
    await settle()
    await press(OK)
    await settle()

    // Nothing for the viewer to choose.
    expect(view.audioButton()).toBeNull()
  })

  it('appears once the stream offers a real choice', async () => {
    const view = renderPlayer({ audioTracks: SCANDI_TRACKS, activeAudioTrack: 'hls:aud:3' })
    await settle()
    await press(OK)
    await settle()

    expect(view.audioButton()).not.toBeNull()
    expect(view.audioButton()?.textContent).toContain('Audio')
  })

  it('appears as soon as discovery completes on an already-open OSD', async () => {
    // Discovery is asynchronous — hls.js parses the manifest well after this
    // screen is up — so the control has to be able to arrive mid-session
    // rather than only at mount. This is the path that breaks entirely if
    // sessionStateEqual ignores audio state.
    const view = renderPlayer({ audioTracks: [] })
    await settle()
    await press(OK)
    await settle()
    expect(view.audioButton()).toBeNull()

    await act(async () => {
      view.player.publishAudioTracks(SCANDI_TRACKS, 'hls:aud:3')
    })
    await settle()

    expect(view.audioButton()).not.toBeNull()
  })

  it('disappears again if a failover lands on a stream without alternate audio', async () => {
    const view = renderPlayer({ audioTracks: SCANDI_TRACKS, activeAudioTrack: 'hls:aud:3' })
    await settle()
    await press(OK)
    await settle()
    expect(view.audioButton()).not.toBeNull()

    await act(async () => {
      view.player.publishAudioTracks([], null)
    })
    await settle()

    expect(view.audioButton()).toBeNull()
  })
})

describe('Audio popup contents', () => {
  it('renders one row per rendition, with language chips and readable labels', async () => {
    const view = renderPlayer({ audioTracks: SCANDI_TRACKS, activeAudioTrack: 'hls:aud:3' })
    await openPopupFrom(view, 'player-audio-toggle')

    const rows = view.rows()
    expect(rows).toHaveLength(3)
    // Chip = short language code, label = the readable name. No "Off" row:
    // audio is a pick, not a toggle.
    expect(rows.map((row) => row.querySelector('.option-row-chip')?.textContent)).toEqual(['NO', 'SE', 'DK'])
    expect(rows.map((row) => row.querySelector('.option-row-label')?.textContent)).toEqual(['Norsk', 'Svenska', 'Dansk'])
  })

  it('puts the checkmark on the track the engine reports as playing', async () => {
    // The manifest default here is Swedish — the viewer chose nothing.
    const view = renderPlayer({ audioTracks: SCANDI_TRACKS, activeAudioTrack: 'hls:aud:4' })
    await openPopupFrom(view, 'player-audio-toggle')

    const checked = view.rows().filter((row) => row.querySelector('.option-row-check'))
    expect(checked).toHaveLength(1)
    expect(checked[0].querySelector('.option-row-label')?.textContent).toBe('Svenska')
  })
})

describe('Audio track selection', () => {
  it('asks the session controller for the id of the row that was pressed', async () => {
    const view = renderPlayer({ audioTracks: SCANDI_TRACKS, activeAudioTrack: 'hls:aud:3' })
    await openPopupFrom(view, 'player-audio-toggle')

    await act(async () => {
      await setFocus('player-audio-option-hls:aud:5')
    })
    await press(OK)
    await settle()

    expect(view.player.audioTrackCalls).toEqual(['hls:aud:5'])
  })

  it('keeps playback running and the OSD visible', async () => {
    const view = renderPlayer({ audioTracks: SCANDI_TRACKS, activeAudioTrack: 'hls:aud:3' })
    await openPopupFrom(view, 'player-audio-toggle')

    await act(async () => {
      await setFocus('player-audio-option-hls:aud:4')
    })
    await press(OK)
    await settle()

    // No reload, no source change, no teardown — and the overlay stays up so
    // the viewer can hear the change and pick again.
    expect(view.container.querySelector('.player-overlay')!.className).toContain('visible')
    expect(view.popup()).toBeTruthy()
  })

  it('moves the checkmark only once the player reports the switch', async () => {
    const view = renderPlayer({ audioTracks: SCANDI_TRACKS, activeAudioTrack: 'hls:aud:3' })
    await openPopupFrom(view, 'player-audio-toggle')

    await act(async () => {
      await setFocus('player-audio-option-hls:aud:4')
    })
    await press(OK)
    await settle()

    const checkedLabel = () => view.rows().find((row) => row.querySelector('.option-row-check'))?.querySelector('.option-row-label')?.textContent
    // Requested, not yet confirmed.
    expect(checkedLabel()).toBe('Norsk')

    await act(async () => {
      view.player.confirmAudioSwitch('hls:aud:4')
    })
    await settle()

    expect(checkedLabel()).toBe('Svenska')
  })
})

describe('Audio popup focus behaviour', () => {
  it('lands focus on the currently active track', async () => {
    const view = renderPlayer({ audioTracks: SCANDI_TRACKS, activeAudioTrack: 'hls:aud:5' })
    await openPopupFrom(view, 'player-audio-toggle')

    expect(getCurrentFocusKey()).toBe('player-audio-option-hls:aud:5')
  })

  it('falls back to the first track when the active one is unavailable', async () => {
    // hls.js has not settled on a rendition yet, so nothing is active.
    const view = renderPlayer({ audioTracks: SCANDI_TRACKS, activeAudioTrack: null })
    await openPopupFrom(view, 'player-audio-toggle')

    expect(getCurrentFocusKey()).toBe('player-audio-option-hls:aud:3')
  })

  it('closes on Back and hands focus back to the Audio button', async () => {
    const view = renderPlayer({ audioTracks: SCANDI_TRACKS, activeAudioTrack: 'hls:aud:3' })
    await openPopupFrom(view, 'player-audio-toggle')
    expect(view.popup()).toBeTruthy()

    // The popup owns Back while it is open: it must close only itself, and
    // must not hide the OSD or leave the Player.
    await act(async () => {
      expect(handleBackPress()).toBe(true)
      await Promise.resolve()
    })
    await settle()

    expect(view.popup()).toBeNull()
    expect(view.container.querySelector('.player-overlay')!.className).toContain('visible')
    expect(getCurrentFocusKey()).toBe('player-audio-toggle')
    expect(view.onBack).not.toHaveBeenCalled()
  })

  // The hidden OSD stays MOUNTED (it fades rather than unmounting), so the
  // Audio button is in the DOM the whole time playback is running with
  // nothing on screen. Same contract as every other toolbar control: while
  // hidden it is not a spatial-nav target and OK cannot activate it — see
  // ChannelPlayerScreen.osdFocus.test.tsx for the original defect.
  it('is rendered but not focused while the OSD is hidden', async () => {
    const view = renderPlayer({ audioTracks: SCANDI_TRACKS, activeAudioTrack: 'hls:aud:3' })
    await settle()

    expect(view.audioButton()).not.toBeNull()
    // Focus rests on the non-actionable toolbar container, not on any button.
    expect(getCurrentFocusKey()).toBe('player-toolbar')
  })

  it('cannot be activated by the press that reveals the OSD', async () => {
    const view = renderPlayer({ audioTracks: SCANDI_TRACKS, activeAudioTrack: 'hls:aud:3' })
    await settle()

    // Force focus onto it anyway — the strongest form of the guarantee. A
    // remote cannot do this (the button is not a participating focusable
    // while hidden), but norigin re-checks `focusable` inside its own
    // onEnterPress dispatch, so even a focus that got there some other way
    // must not turn one OK press into "reveal AND open the audio menu".
    await act(async () => {
      await setFocus('player-audio-toggle')
    })
    await press(OK)
    await settle()

    expect(view.popup()).toBeNull()
    expect(view.container.querySelector('.player-overlay')!.className).toContain('visible')
  })
})

describe('Source / Audio / Text are mutually exclusive', () => {
  const options = { audioTracks: SCANDI_TRACKS, activeAudioTrack: 'hls:aud:3', subtitleTracks: [{ id: '0', label: 'Norsk' }] }

  // Exactly one popup may be mounted at any time — asserted structurally
  // rather than per-pair, so a fourth popup added later cannot quietly slip
  // past this.
  function openPopupCount(view: ReturnType<typeof renderPlayer>): number {
    return view.container.querySelectorAll('.options-popup').length
  }

  it('opening Audio closes Source', async () => {
    const view = renderPlayer(options)
    await openPopupFrom(view, 'player-source-toggle')
    expect(view.container.querySelector('.option-row-label')?.textContent).toBe('HD')

    await openPopupFrom(view, 'player-audio-toggle')

    expect(openPopupCount(view)).toBe(1)
    expect(view.rows().map((row) => row.querySelector('.option-row-label')?.textContent)).toEqual(['Norsk', 'Svenska', 'Dansk'])
  })

  it('opening Audio closes Text', async () => {
    const view = renderPlayer(options)
    await openPopupFrom(view, 'player-subtitles-toggle')
    expect(openPopupCount(view)).toBe(1)

    await openPopupFrom(view, 'player-audio-toggle')

    expect(openPopupCount(view)).toBe(1)
    expect(view.rows().some((row) => row.querySelector('.option-row-chip')?.textContent === 'OFF')).toBe(false)
  })

  it('opening Source closes Audio', async () => {
    const view = renderPlayer(options)
    await openPopupFrom(view, 'player-audio-toggle')

    await openPopupFrom(view, 'player-source-toggle')

    expect(openPopupCount(view)).toBe(1)
    expect(view.rows().map((row) => row.querySelector('.option-row-label')?.textContent)).toEqual(['HD'])
  })

  it('opening Text closes Audio', async () => {
    const view = renderPlayer(options)
    await openPopupFrom(view, 'player-audio-toggle')

    await openPopupFrom(view, 'player-subtitles-toggle')

    expect(openPopupCount(view)).toBe(1)
    // The subtitles popup is the one with an Off row.
    expect(view.rows().some((row) => row.querySelector('.option-row-chip')?.textContent === 'OFF')).toBe(true)
  })

  it('closes the Audio popup along with the OSD on the idle timeout', async () => {
    const view = renderPlayer(options)
    await openPopupFrom(view, 'player-audio-toggle')
    expect(view.popup()).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(6000)
      await Promise.resolve()
    })
    await settle()

    expect(view.popup()).toBeNull()
    expect(view.container.querySelector('.player-overlay')!.className).toContain('hidden')
    // Re-anchored on the non-actionable container, so the next OK is safe.
    expect(getCurrentFocusKey()).toBe('player-toolbar')
  })
})
