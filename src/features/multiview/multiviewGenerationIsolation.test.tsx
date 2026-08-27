// @vitest-environment jsdom
//
// PLAYBACK ISOLATION FOR MULTIVIEW — the non-negotiable half of aggressive
// playlist refreshing.
//
// Now that provider playlists refresh on a ~12-minute cadence, a new
// generation genuinely can land while up to four decoders are running. The
// requirement is absolute: a refresh may change what Ninety can discover and
// play NEXT, and must change nothing about what is already playing. The two
// ways that could break here are both structural rather than visual, so both
// are asserted directly:
//
//   H1 — MultiviewPaneVideo's source-sync effect calls controller.selectSource(),
//        which is a real reload. It fires on an EXTERNAL pane.sourceIndex
//        change. If anything ever re-resolves panes on a playlist change,
//        every live pane reloads. Nothing may call it here.
//   H4 — a pane must not remount (a remount disposes the Player and creates
//        a new one), so the underlying player instance count must not grow.
//
// The "install a generation" event is modelled the way App.tsx actually
// delivers it: MultiviewScreen re-renders with new `channels`/`homeFeed`
// props, because App re-rendered.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { init } from '@noriginmedia/norigin-spatial-navigation'
import { MultiviewPane } from './MultiviewPane'
import type { MultiviewSourceCandidate } from './multiviewCandidates'
import type { Channel } from '../../data/channel'
import type { Player, PlayerState } from '../../core/player/types'

init({ debug: false, visualDebug: false })

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
    muted: true,
  }
  const listeners = new Set<(state: PlayerState) => void>()
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

function channel(id: string, url: string): Channel {
  return { id, name: id.toUpperCase(), sources: [{ label: 'HD', url }] }
}

function candidatesFor(id: string): MultiviewSourceCandidate[] {
  return [
    {
      channel: channel(id, `https://provider.example/${id}-hd.ts`),
      source: { label: 'HD', url: `https://provider.example/${id}-hd.ts` },
      qualityTier: 2,
      qualityLabel: 'HD',
      displayName: `${id.toUpperCase()} HD`,
    },
    {
      channel: channel(id, `https://provider.example/${id}-sd.ts`),
      source: { label: 'SD', url: `https://provider.example/${id}-sd.ts` },
      qualityTier: 1,
      qualityLabel: 'SD',
      displayName: `${id.toUpperCase()} SD`,
    },
  ]
}

// Four live panes, each already resolved to real candidates — the state a
// background refresh has to be invisible to.
function makePanes(count: number) {
  return Array.from({ length: count }, (_, i) => {
    return {
      id: `pane-${i}`,
      assignmentId: `assign-${i}`,
      assignment: { kind: 'channel' as const, channel: channel(`ch${i}`, `https://provider.example/ch${i}-hd.ts`) },
      candidates: candidatesFor(`ch${i}`),
      sourceIndex: 0,
      resolution: 'ready' as const,
    }
  })
}

// Stands in for App -> MultiviewScreen re-rendering because `library.channels`
// (and homeFeed) changed. The pane props themselves are IDENTICAL: a
// generation install must not touch MultiviewSession, which is precisely the
// rule this harness encodes.
function Grid({ panes, generation }: { panes: ReturnType<typeof makePanes>; generation: number }) {
  return (
    <div data-generation={generation}>
      {panes.map((pane, index) => (
        <MultiviewPane
          key={pane.assignmentId}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pane={pane as any}
          isMaximized={false}
          isAudioPane={index === 0}
          sessionMuted={false}
          forceFocus={index === 0}
          activePaneCount={panes.length}
          onFocusPane={() => {}}
          onMakeFullscreen={() => {}}
          onRestoreGrid={() => {}}
          onSelectSource={() => {}}
          onUseAudio={() => {}}
          onToggleSessionMute={() => {}}
          onReplaceEvent={() => {}}
          onRemove={() => {}}
        />
      ))}
    </div>
  )
}

afterEach(() => {
  cleanup()
  loadedUrls.length = 0
  vi.clearAllMocks()
})

describe.each([1, 2, 3, 4])('%i live Multiview pane(s) across a playlist generation install', (paneCount) => {
  it('does not reload, remount, or re-source any pane', async () => {
    createHtmlVideoPlayerMock.mockImplementation(() => createFakePlayer())
    const panes = makePanes(paneCount)
    const { container, rerender } = render(<Grid panes={panes} generation={0} />)

    expect(createHtmlVideoPlayerMock).toHaveBeenCalledTimes(paneCount)
    const videosBefore = [...container.querySelectorAll('video')]
    expect(videosBefore).toHaveLength(paneCount)
    const urlsBefore = [...loadedUrls]
    expect(urlsBefore).toHaveLength(paneCount)

    // Five generations install back to back — an hour of refreshes at the
    // real cadence, compressed.
    for (let generation = 1; generation <= 5; generation++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        rerender(<Grid panes={panes} generation={generation} />)
      })
    }

    // No pane remounted: same Player instances, same <video> elements.
    expect(createHtmlVideoPlayerMock).toHaveBeenCalledTimes(paneCount)
    expect([...container.querySelectorAll('video')]).toEqual(videosBefore)
    // No pane reloaded, and no source URL changed — load() is the only thing
    // that can interrupt a decoding stream, and selectSource() goes through it.
    expect(loadedUrls).toEqual(urlsBefore)
  })

  it('keeps the audio owner and the muted state exactly as they were', async () => {
    const players: Player[] = []
    createHtmlVideoPlayerMock.mockImplementation(() => {
      const p = createFakePlayer()
      players.push(p)
      return p
    })
    const panes = makePanes(paneCount)
    const { rerender } = render(<Grid panes={panes} generation={0} />)
    const mutedBefore = players.map((p) => p.getState().muted)

    await act(async () => {
      rerender(<Grid panes={panes} generation={1} />)
    })

    expect(players.map((p) => p.getState().muted)).toEqual(mutedBefore)
    // Pane 0 owns audio in this harness, so exactly one player is unmuted.
    expect(mutedBefore.filter((m) => !m)).toHaveLength(1)
  })
})

describe('adding and removing panes', () => {
  it('adding a pane does not restart its siblings', async () => {
    createHtmlVideoPlayerMock.mockImplementation(() => createFakePlayer())
    const two = makePanes(2)
    const { container, rerender } = render(<Grid panes={two} generation={0} />)
    const videosBefore = [...container.querySelectorAll('video')]
    const urlsBefore = [...loadedUrls]

    const three = [...two, ...makePanes(3).slice(2)]
    await act(async () => {
      rerender(<Grid panes={three} generation={0} />)
    })

    // The two originals kept their exact DOM elements; only the new pane
    // loaded anything.
    expect([...container.querySelectorAll('video')].slice(0, 2)).toEqual(videosBefore)
    expect(loadedUrls.slice(0, urlsBefore.length)).toEqual(urlsBefore)
    expect(loadedUrls).toHaveLength(urlsBefore.length + 1)
  })

  it('removing a pane does not restart the survivors', async () => {
    createHtmlVideoPlayerMock.mockImplementation(() => createFakePlayer())
    const three = makePanes(3)
    const { container, rerender } = render(<Grid panes={three} generation={0} />)
    const videosBefore = [...container.querySelectorAll('video')]
    const urlsBefore = [...loadedUrls]

    await act(async () => {
      rerender(<Grid panes={three.slice(0, 2)} generation={0} />)
    })

    expect([...container.querySelectorAll('video')]).toEqual(videosBefore.slice(0, 2))
    expect(loadedUrls).toEqual(urlsBefore)
  })
})
