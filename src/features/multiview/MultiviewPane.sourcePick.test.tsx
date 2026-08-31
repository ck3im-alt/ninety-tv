// @vitest-environment jsdom
//
// Picking a source from a pane's own menu must load that source ONCE.
//
// Two things apply a pick: the menu's handler calls controller.selectSource
// straight away (so the stream changes on the keypress, not a render later),
// and the pane's source-sync effect applies an external pane.sourceIndex
// change — which is what a rerank-on-maximize does. Both used to fire for a
// manual pick, and selectSource has no same-index bail, so the pane tore
// down and rebuilt the identical stream twice. On TV silicon that is a
// visible double stall, in one of up to four simultaneously decoding panes.
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { init, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { MultiviewPane } from './MultiviewPane'
import type { MultiviewSourceCandidate } from './multiviewCandidates'
import type { Player, PlayerState } from '../../core/player/types'

init({ debug: false, visualDebug: false })
Element.prototype.scrollIntoView = () => {}

const { createHtmlVideoPlayerMock } = vi.hoisted(() => ({ createHtmlVideoPlayerMock: vi.fn() }))
vi.mock('../../core/player/htmlVideoPlayer', () => ({
  createHtmlVideoPlayer: createHtmlVideoPlayerMock,
  preloadPlayerEngine: vi.fn(),
}))

const loadedUrls: string[] = []

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
  const listeners = new Set<(s: PlayerState) => void>()
  const set = (patch: Partial<PlayerState>) => {
    state = { ...state, ...patch }
    for (const l of listeners) l(state)
  }
  return {
    attach() {},
    async load(url: string) {
      loadedUrls.push(url)
      set({ status: 'loading', error: null })
    },
    async play() {
      set({ status: 'playing' })
    },
    pause() {
      set({ status: 'paused' })
    },
    seekBy() {},
    seekToLive() {},
    setMuted(muted) {
      set({ muted })
    },
    setSubtitleTrack() {},
    setAudioTrack() {},
    getState: () => state,
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    dispose() {
      listeners.clear()
    },
  }
}

function candidates(): MultiviewSourceCandidate[] {
  return ['HD', 'SD'].map((label) => ({
    channel: { id: `ch-${label}`, name: label, sources: [{ label, url: `https://provider.example/${label}.ts` }] },
    source: { label, url: `https://provider.example/${label}.ts` },
    qualityTier: label === 'HD' ? 2 : 1,
    qualityLabel: label,
    displayName: label,
  }))
}

// Stands in for MultiviewScreen, which owns pane.sourceIndex and updates it
// when a pane reports a pick.
function Harness() {
  const [sourceIndex, setSourceIndex] = useState(0)
  const pane = {
    id: 'pane-0',
    assignmentId: 'assign-0',
    assignment: {
      kind: 'channel' as const,
      channel: { id: 'ch', name: 'CH', sources: [{ label: 'HD', url: 'https://provider.example/HD.ts' }] },
    },
    candidates: candidates(),
    sourceIndex,
    resolution: 'ready' as const,
  }
  return (
    <MultiviewPane
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pane={pane as any}
      isMaximized={false}
      isAudioPane
      sessionMuted={false}
      forceFocus
      activePaneCount={1}
      onFocusPane={() => {}}
      onMakeFullscreen={() => {}}
      onRestoreGrid={() => {}}
      onSelectSource={(index) => setSourceIndex(index)}
      onUseAudio={() => {}}
      onToggleSessionMute={() => {}}
      onReplaceEvent={() => {}}
      onRemove={() => {}}
    />
  )
}

afterEach(() => {
  cleanup()
  loadedUrls.length = 0
  vi.clearAllMocks()
})

describe('choosing another source for a live Multiview pane', () => {
  it('loads the chosen source exactly once', async () => {
    createHtmlVideoPlayerMock.mockImplementation(() => createFakePlayer())
    const { container } = render(<Harness />)
    expect(loadedUrls).toEqual(['https://provider.example/HD.ts'])

    // OK on the pane opens its menu.
    await act(async () => {
      await setFocus('pane-0')
    })
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 })
    })
    const rows = () => [...container.querySelectorAll('.pane-menu-row')]
    const changeSource = rows().find((r) => r.textContent?.includes('Change source'))
    expect(changeSource).toBeTruthy()
    await act(async () => {
      ;(changeSource as HTMLElement).click()
    })

    const sd = rows().find((r) => r.textContent?.includes('SD'))
    expect(sd).toBeTruthy()
    await act(async () => {
      ;(sd as HTMLElement).click()
    })

    expect(loadedUrls).toEqual(['https://provider.example/HD.ts', 'https://provider.example/SD.ts'])
  })
})
