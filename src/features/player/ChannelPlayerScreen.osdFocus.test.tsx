// @vitest-environment jsdom
//
// Regression coverage for the beta's worst navigation defect: while the
// Player's OSD was hidden it stayed mounted, laid out and fully registered
// with spatial navigation, and focus was deliberately parked on its toolbar.
// norigin's own window keydown listener is bound in main.tsx's init() —
// before React ever renders — so it ran BEFORE this screen's "any key
// reveals the OSD" listener. One OK press therefore both revealed the OSD
// and fired whatever invisible button held focus, which (norigin resolves a
// container with no preferredChildFocusKey to the child closest to the
// origin) was Channel List → onBack(). To a viewer that reads as "the app
// randomly quit playback", and the dominant path to it is not mount but the
// 6-second idle auto-hide that happens during every single match.
//
// The contract these tests protect:
//
//   OSD hidden   -> no actionable focus target exists at all; OK cannot
//                   trigger a toolbar action; the press only reveals.
//   first reveal -> focus lands on a REAL, VISIBLE control (Play/Pause,
//                   never the button that leaves playback).
//   OSD visible  -> the toolbar works exactly as it always did.
//   Back         -> popup / hide OSD / leave Player, in that order, and
//                   never doubles as a "reveal" press.
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrentFocusKey, init, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { ChannelPlayerScreen } from './ChannelPlayerScreen'
import { handleBackPress } from '../../core/platform'
import type { Channel } from '../../data/channel'
import type { Player, PlayerState } from '../../core/player/types'

// Same one-time setup main.tsx does before rendering <App/> — this is also
// what binds norigin's window keydown listener, i.e. the exact listener
// ordering the bug depended on.
init({ debug: false, visualDebug: false })
Element.prototype.scrollIntoView = () => {}

const { createHtmlVideoPlayerMock } = vi.hoisted(() => ({
  createHtmlVideoPlayerMock: vi.fn(),
}))

vi.mock('../../core/player/htmlVideoPlayer', () => ({
  createHtmlVideoPlayer: createHtmlVideoPlayerMock,
  preloadPlayerEngine: vi.fn(),
}))

// Same fake-Player shape the other ChannelPlayerScreen tests use — jsdom has
// no real <video>/HLS pipeline.
function createFakePlayer(): Player {
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
    setAudioTrack() {},
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

const OK = { key: 'Enter', keyCode: 13 }
const RIGHT = { key: 'ArrowRight', keyCode: 39 }
const TIZEN_BACK = { key: 'XF86Back', keyCode: 10009 }

// One remote press, delivered the way the real device delivers it: a single
// window keydown that BOTH norigin's listener and the screen's own reveal
// listener see, in that order.
async function press(keyInit: { key: string; keyCode: number }): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(window, keyInit)
    // norigin's setFocus/navigate are scheduled, not synchronous.
    await Promise.resolve()
  })
}

function renderPlayer(overrides: Partial<{ onBack: () => void }> = {}) {
  createHtmlVideoPlayerMock.mockImplementation(() => createFakePlayer())
  const onBack = vi.fn(overrides.onBack)
  const view = render(<ChannelPlayerScreen channels={[TEST_CHANNEL]} onBack={onBack} />)
  const overlay = () => view.container.querySelector('.player-overlay')!
  return { ...view, onBack, overlay }
}

// The screen's focus placement happens in a passive effect and norigin's
// setFocus is scheduled — flush both before asserting on focus.
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  // norigin's service is a module-level singleton and `cleanup()` does not
  // reset the key it considers focused. Its `focusOnPresetKey` option
  // (on by default) then re-focuses any component that mounts with that
  // exact key — so a test that ends on `player-channel-list` would hand the
  // next test's freshly-mounted Player a pre-focused Channel List button.
  // Park it on a key nothing in this file ever registers.
  await setFocus('test-neutral-focus-key')
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  cleanup()
  vi.clearAllMocks()
})

describe('Player OSD hidden state', () => {
  it('mounts with the OSD hidden and no actionable toolbar target', async () => {
    const { overlay, container } = renderPlayer()
    await settle()

    expect(overlay().className).toContain('hidden')
    // The buttons stay MOUNTED — the overlay fades, it does not unmount —
    // which is exactly why unmounting was never the fix.
    expect(container.querySelectorAll('.toolbar-btn').length).toBeGreaterThan(0)
    // ...but focus rests on the toolbar CONTAINER, which has no
    // onEnterPress, rather than on any button.
    expect(getCurrentFocusKey()).toBe('player-toolbar')
  })

  it('does not fire the focused toolbar action on the first OK press', async () => {
    const { onBack, overlay } = renderPlayer()
    await settle()

    await press(OK)

    // The whole point: one press reveals, and reveals ONLY.
    expect(onBack).not.toHaveBeenCalled()
    expect(overlay().className).toContain('visible')
  })

  // Same root cause, lower severity: Right used to both reveal the OSD and
  // move focus, so the overlay appeared with the SECOND button selected —
  // an invisible focus move the viewer never saw happen. The direction of
  // the press that wakes the OSD must not decide where focus ends up.
  it('lands the first press on the same control whichever direction it was', async () => {
    const first = renderPlayer()
    await settle()
    await press(RIGHT)
    await settle()
    expect(first.overlay().className).toContain('visible')
    const afterRight = getCurrentFocusKey()
    cleanup()

    const second = renderPlayer()
    await settle()
    await press(OK)
    await settle()
    expect(second.overlay().className).toContain('visible')

    expect(afterRight).toBe(getCurrentFocusKey())
    expect(afterRight).toBe('player-play-pause')
  })

  it('cannot exit playback with the first OK press after the idle auto-hide', async () => {
    const { onBack, overlay } = renderPlayer()
    await settle()

    // Reveal, then let the 6 s idle timer hide it again — the real-world
    // path: the viewer watches a match, the OSD disappears on its own, and
    // the next press is the one that used to quit.
    await press(OK)
    await settle()
    expect(overlay().className).toContain('visible')

    await act(async () => {
      vi.advanceTimersByTime(6000)
      await Promise.resolve()
    })
    expect(overlay().className).toContain('hidden')
    await settle()
    expect(getCurrentFocusKey()).toBe('player-toolbar')

    await press(OK)

    expect(onBack).not.toHaveBeenCalled()
    expect(overlay().className).toContain('visible')
  })
})

describe('Player OSD reveal', () => {
  it('lands focus on a real, visible control — Play/Pause, never Channel List', async () => {
    const { container, overlay } = renderPlayer()
    await settle()

    await press(OK)
    await settle()

    expect(overlay().className).toContain('visible')
    expect(getCurrentFocusKey()).toBe('player-play-pause')
    // And the focused state is actually rendered, so the viewer can see
    // where OK will go.
    const focused = container.querySelectorAll('.toolbar-btn.focused')
    expect(focused).toHaveLength(1)
    expect(focused[0].textContent).toContain('Pause')
  })

  it('returns focus to the control the viewer last used on a later reveal', async () => {
    const { overlay } = renderPlayer()
    await settle()
    await press(OK)
    await settle()

    await act(async () => {
      await setFocus('player-mute')
    })
    expect(getCurrentFocusKey()).toBe('player-mute')

    await act(async () => {
      vi.advanceTimersByTime(6000)
      await Promise.resolve()
    })
    expect(overlay().className).toContain('hidden')

    await press(OK)
    await settle()
    expect(getCurrentFocusKey()).toBe('player-mute')
  })
})

describe('Player OSD visible state (the path that must keep working)', () => {
  it('still runs Channel List -> onBack when it is genuinely focused and visible', async () => {
    const { onBack, overlay } = renderPlayer()
    await settle()
    await press(OK)
    await settle()
    expect(overlay().className).toContain('visible')

    await act(async () => {
      await setFocus('player-channel-list')
    })
    expect(getCurrentFocusKey()).toBe('player-channel-list')

    await press(OK)

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('still runs Play/Pause on OK once the OSD is visible', async () => {
    const { container } = renderPlayer()
    await settle()
    await press(OK)
    await settle()

    await press(OK)
    await settle()

    // The label flips Pause -> Play, proving the button actually fired.
    expect(container.querySelector('.toolbar-btn.focused')?.textContent).toContain('Play')
  })
})

describe('Player popups', () => {
  // Opens the Source/Quality popup from a visible OSD and returns once focus
  // has settled inside it.
  async function openSourcePopup() {
    const view = renderPlayer()
    await settle()
    await press(OK)
    await settle()

    await act(async () => {
      await setFocus('player-source-toggle')
    })
    await press(OK)
    await settle()
    return view
  }

  it('moves focus into the popup on open and back onto its opener on close', async () => {
    const { container } = await openSourcePopup()
    expect(container.querySelector('.options-popup')).toBeTruthy()
    expect(getCurrentFocusKey()).toBe('player-source-option-0')

    // Back belongs to the popup while it is open — it closes the popup and
    // must not hide the OSD or leave the Player.
    await act(async () => {
      expect(handleBackPress()).toBe(true)
      await Promise.resolve()
    })
    await settle()

    expect(container.querySelector('.options-popup')).toBeNull()
    expect(container.querySelector('.player-overlay')!.className).toContain('visible')
    expect(getCurrentFocusKey()).toBe('player-source-toggle')
  })

  // The nastiest ordering case: the popup and the OSD go away in the same
  // commit, so the popup's own "restore my opener" cleanup fires against a
  // toolbar button that is on its way to being unfocusable.
  it('re-anchors focus safely when the idle timer hides an OSD with a popup open', async () => {
    const { container, onBack } = await openSourcePopup()
    expect(container.querySelector('.options-popup')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(6000)
      await Promise.resolve()
    })
    await settle()

    expect(container.querySelector('.options-popup')).toBeNull()
    expect(container.querySelector('.player-overlay')!.className).toContain('hidden')
    expect(getCurrentFocusKey()).toBe('player-toolbar')

    await press(OK)
    expect(onBack).not.toHaveBeenCalled()
  })
})

describe('Player rapid input', () => {
  // Holding OK on a remote fires a burst of keydowns. The first reveals the
  // OSD; the rest land on Play/Pause. None of them may reach Channel List,
  // and focus must never be left on the neutral anchor once the OSD is up.
  it('never reaches onBack under a burst of OK presses from the hidden state', async () => {
    const { onBack, overlay } = renderPlayer()
    await settle()

    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line no-await-in-loop
      await press(OK)
    }
    await settle()

    expect(onBack).not.toHaveBeenCalled()
    expect(overlay().className).toContain('visible')
    expect(getCurrentFocusKey()).toBe('player-play-pause')
  })

  // Every press while the OSD is up refreshes the idle window, so a viewer
  // actively using the toolbar cannot have it vanish under them.
  it('keeps the OSD up while the viewer keeps pressing', async () => {
    const { overlay } = renderPlayer()
    await settle()
    await press(OK)
    await settle()

    for (let i = 0; i < 4; i++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        vi.advanceTimersByTime(4000)
        await Promise.resolve()
      })
      // eslint-disable-next-line no-await-in-loop
      await press(RIGHT)
    }

    expect(overlay().className).toContain('visible')
  })
})

describe('Player subtitles popup', () => {
  it('scopes focus to the popup and hands it back to the Text button', async () => {
    const { container } = renderPlayer()
    await settle()
    await press(OK)
    await settle()

    await act(async () => {
      await setFocus('player-subtitles-toggle')
    })
    await press(OK)
    await settle()

    expect(container.querySelector('.options-popup')).toBeTruthy()
    // No tracks on the fake player, so the popup says so — and the empty
    // popup must still own Back rather than falling through to the screen.
    expect(container.querySelector('.options-empty')).toBeTruthy()

    await act(async () => {
      expect(handleBackPress()).toBe(true)
      await Promise.resolve()
    })
    await settle()

    expect(container.querySelector('.options-popup')).toBeNull()
    expect(container.querySelector('.player-overlay')!.className).toContain('visible')
    expect(getCurrentFocusKey()).toBe('player-subtitles-toggle')
  })
})

describe('Player Back hierarchy', () => {
  it('leaves the Player when Back is pressed with the OSD hidden', async () => {
    const { onBack, overlay } = renderPlayer()
    await settle()

    await act(async () => {
      expect(handleBackPress()).toBe(true)
      fireEvent.keyDown(window, TIZEN_BACK)
      await Promise.resolve()
    })

    expect(onBack).toHaveBeenCalledTimes(1)
    // Back must not double as a "reveal" press — the screen is on its way
    // out; flashing the OSD up on the way would be pure noise.
    expect(overlay().className).toContain('hidden')
  })

  it('hides the OSD (and does not leave the Player) when Back is pressed with the OSD visible', async () => {
    const { onBack, overlay } = renderPlayer()
    await settle()
    await press(OK)
    await settle()
    expect(overlay().className).toContain('visible')

    await act(async () => {
      expect(handleBackPress()).toBe(true)
      fireEvent.keyDown(window, TIZEN_BACK)
      await Promise.resolve()
    })

    expect(onBack).not.toHaveBeenCalled()
    expect(overlay().className).toContain('hidden')
    await settle()
    // ...and focus is re-anchored on the non-actionable container, so the
    // next OK is safe again.
    expect(getCurrentFocusKey()).toBe('player-toolbar')
  })
})
