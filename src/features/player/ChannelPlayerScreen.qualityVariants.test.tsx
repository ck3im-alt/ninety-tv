// @vitest-environment jsdom
//
// Playback started from Event Details receives the WHOLE logical stream
// group (stream-dedupe task, Parts 4-6): every quality variant the row
// collapsed — including variants belonging to a different playlist Channel
// — best-first, with the best one playing immediately, switchable in place,
// and an overlay that always reports the quality actually playing.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { init } from '@noriginmedia/norigin-spatial-navigation'
import { ChannelPlayerScreen } from './ChannelPlayerScreen'
import { handleBackPress } from '../../core/platform/backHandler'
import type { EventPlaybackGroup } from '../eventDetails/eventPlaybackGroup'
import type { Channel } from '../../data/channel'
import type { Player, PlayerState } from '../../core/player/types'

init({ debug: false, visualDebug: false })
Element.prototype.scrollIntoView = () => {}

const { createHtmlVideoPlayerMock } = vi.hoisted(() => ({ createHtmlVideoPlayerMock: vi.fn() }))
vi.mock('../../core/player/htmlVideoPlayer', () => ({
  createHtmlVideoPlayer: createHtmlVideoPlayerMock,
  preloadPlayerEngine: vi.fn(),
}))

// Same fake-Player shape playerSessionController.test.ts uses, plus a
// record of every URL it was asked to load (that list IS the observable
// "what is actually playing" signal) and a way to raise a hard error so the
// controller's own failover policy runs for real.
interface FakePlayer extends Player {
  loaded: string[]
  raiseError(): void
}

function createFakePlayer(): FakePlayer {
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
  const loaded: string[] = []
  function setState(patch: Partial<PlayerState>): void {
    state = { ...state, ...patch }
    for (const listener of listeners) listener(state)
  }
  return {
    loaded,
    raiseError() {
      setState({ status: 'error', error: { code: 'network', message: 'boom' } })
    },
    attach() {},
    async load(url: string) {
      loaded.push(url)
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

// Two playlist channels, one logical broadcaster — the merged shape Event
// Details now produces (see groupChannelMatches.ts).
const CHANNEL_A: Channel = { id: 'p1', name: 'TV2 SPORT 1', groupTitle: 'NO| Sports', sources: [] }
const CHANNEL_B: Channel = { id: 'p2', name: 'TV 2 SPORT 1', groupTitle: 'NOR | Sports', sources: [] }

const GROUP: EventPlaybackGroup = {
  key: 'Norway|ninety|no_tv2_sport_1',
  displayName: 'TV 2 Sport 1',
  displayParts: { provider: 'TV 2 Sport 1', eventTitle: 'Olympique Lyonnais - Fenerbahce', startTime: '21:00', quality: '8K' },
  variants: [
    { qualityTier: 5, qualityLabel: '8K', candidates: [{ channel: CHANNEL_A, source: { label: '8K', url: 'http://x/8k' } }] },
    { qualityTier: 4, qualityLabel: 'UHD', candidates: [{ channel: CHANNEL_B, source: { label: 'UHD', url: 'http://x/uhd' } }] },
    { qualityTier: 3, qualityLabel: '1080p', candidates: [{ channel: CHANNEL_A, source: { label: 'FHD', url: 'http://x/fhd' } }] },
    { qualityTier: 2, qualityLabel: '720p', candidates: [{ channel: CHANNEL_B, source: { label: 'HD', url: 'http://x/hd' } }] },
  ],
}

// The same broadcaster with MIRRORS: two candidates behind UHD, two behind
// 1080p, one behind 720p. Three user-facing qualities, five playable
// streams — the distinction this model exists for.
const MIRROR_GROUP: EventPlaybackGroup = {
  key: 'Norway|ninety|no_tv2_sport_1',
  displayName: 'TV 2 Sport 1',
  displayParts: { provider: 'TV 2 Sport 1', eventTitle: 'Olympique Lyonnais - Fenerbahce', startTime: '21:00', quality: 'UHD' },
  variants: [
    {
      qualityTier: 4,
      qualityLabel: 'UHD',
      candidates: [
        { channel: CHANNEL_A, source: { label: 'UHD', url: 'http://m/uhd-a' } },
        { channel: CHANNEL_B, source: { label: 'UHD', url: 'http://m/uhd-b' } },
      ],
    },
    {
      qualityTier: 3,
      qualityLabel: '1080p',
      candidates: [
        { channel: CHANNEL_A, source: { label: 'FHD', url: 'http://m/fhd-a' } },
        { channel: CHANNEL_B, source: { label: 'FHD', url: 'http://m/fhd-b' } },
      ],
    },
    { qualityTier: 2, qualityLabel: '720p', candidates: [{ channel: CHANNEL_A, source: { label: 'HD', url: 'http://m/hd-a' } }] },
  ],
}

// The channel-only watch path (Home/Browse/Favorites/Recent), which must
// keep behaving exactly as before.
const PLAIN_CHANNEL: Channel = {
  id: 'plain',
  name: 'Test Sports Channel',
  groupTitle: 'NO| Sports',
  sources: [
    { label: 'HD', url: 'http://plain/hd' },
    { label: 'SD', url: 'http://plain/sd' },
  ],
}

function renderPlayer(props: Partial<React.ComponentProps<typeof ChannelPlayerScreen>> = {}) {
  let fake: FakePlayer | null = null
  createHtmlVideoPlayerMock.mockImplementation(() => {
    fake = createFakePlayer()
    return fake
  })
  const onBack = vi.fn()
  const view = render(<ChannelPlayerScreen channels={[CHANNEL_A]} playbackGroup={GROUP} onBack={onBack} {...props} />)
  return { view, onBack, player: () => fake! }
}

function overlayLine(): string {
  return document.querySelector('.overlay-channel-name')!.textContent ?? ''
}

function openVariantMenu(toolbarLabel: string): HTMLElement {
  fireEvent.click(screen.getByText(toolbarLabel))
  return document.querySelector('.options-popup') as HTMLElement
}

function menuLabels(popup: HTMLElement): (string | null)[] {
  return [...popup.querySelectorAll('.option-row-label')].map((node) => node.textContent)
}

// The row itself, addressed by its label text — each option renders that
// text twice (a chip badge plus the label), so a plain getByText is
// ambiguous by design.
function menuRow(popup: HTMLElement, label: string): HTMLElement {
  const row = [...popup.querySelectorAll('.option-row')].find((node) => node.querySelector('.option-row-label')?.textContent === label)
  if (!row) throw new Error(`No "${label}" row in the variant menu (have: ${menuLabels(popup).join(', ')})`)
  return row as HTMLElement
}

function activeMenuLabels(popup: HTMLElement): (string | null)[] {
  return [...popup.querySelectorAll('.option-row')]
    .filter((row) => row.querySelector('.option-row-check'))
    .map((row) => row.querySelector('.option-row-label')?.textContent ?? null)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ChannelPlayerScreen event-stream playback', () => {
  it('starts the best variant in the group immediately', () => {
    const { player } = renderPlayer()
    expect(player().loaded).toEqual(['http://x/8k'])
  })

  it('offers every grouped variant as a Quality menu, best-first, one row per tier', () => {
    renderPlayer()
    const popup = openVariantMenu('Quality')
    expect(menuLabels(popup)).toEqual(['8K', 'UHD', '1080p', '720p'])
    expect(activeMenuLabels(popup)).toEqual(['8K'])
  })

  it('shows the active quality in the overlay line', () => {
    renderPlayer()
    expect(overlayLine()).toBe('TV 2 Sport 1 | Olympique Lyonnais - Fenerbahce | 21:00 | 8K')
  })

  it('plays a manually selected lower quality without leaving playback, including one from another playlist channel', () => {
    const { player } = renderPlayer()
    const popup = openVariantMenu('Quality')
    fireEvent.click(menuRow(popup, '1080p'))

    expect(player().loaded).toEqual(['http://x/8k', 'http://x/fhd'])
    expect(document.querySelector('video')).toBeTruthy()
  })

  it('updates the overlay quality when the user switches quality', () => {
    renderPlayer()
    const popup = openVariantMenu('Quality')
    fireEvent.click(menuRow(popup, '720p'))

    expect(overlayLine()).toBe('TV 2 Sport 1 | Olympique Lyonnais - Fenerbahce | 21:00 | 720p')
  })

  it('marks the newly selected quality as the active one in the menu', () => {
    renderPlayer()
    const first = openVariantMenu('Quality')
    fireEvent.click(menuRow(first, 'UHD'))
    expect(activeMenuLabels(document.querySelector('.options-popup') as HTMLElement)).toEqual(['UHD'])
  })

  it('fails over to the next variant on a playback error, and the overlay follows', async () => {
    const { player } = renderPlayer()
    await act(async () => {
      player().raiseError()
    })

    expect(player().loaded).toEqual(['http://x/8k', 'http://x/uhd'])
    expect(overlayLine()).toBe('TV 2 Sport 1 | Olympique Lyonnais - Fenerbahce | 21:00 | UHD')
  })

  it('counts every grouped variant when reporting that everything failed', async () => {
    const { player } = renderPlayer()
    for (let i = 0; i < GROUP.variants.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        player().raiseError()
      })
    }
    expect(screen.getByText('All 4 sources for this channel failed to play.')).toBeTruthy()
  })

  it('leaves the player on Back exactly as before', () => {
    const { onBack } = renderPlayer()
    expect(handleBackPress()).toBe(true)
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

// Requirements 1-5 of the same-quality-mirror refinement.
describe('ChannelPlayerScreen same-quality mirrors', () => {
  function renderMirrors() {
    return renderPlayer({ playbackGroup: MIRROR_GROUP })
  }

  async function fail(player: FakePlayer) {
    await act(async () => {
      player.raiseError()
    })
  }

  it('offers one menu row per quality, never one per playable source', () => {
    renderMirrors()
    expect(menuLabels(openVariantMenu('Quality'))).toEqual(['UHD', '1080p', '720p'])
  })

  it('starts the best quality on its primary candidate', () => {
    const { player } = renderMirrors()
    expect(player().loaded).toEqual(['http://m/uhd-a'])
    expect(overlayLine()).toBe('TV 2 Sport 1 | Olympique Lyonnais - Fenerbahce | 21:00 | UHD')
  })

  it('fails over to the OTHER UHD candidate before leaving UHD', async () => {
    const { player } = renderMirrors()
    await fail(player())
    expect(player().loaded).toEqual(['http://m/uhd-a', 'http://m/uhd-b'])
  })

  it('keeps reporting UHD while switching between two UHD candidates', async () => {
    const { player } = renderMirrors()
    await fail(player())
    expect(overlayLine()).toBe('TV 2 Sport 1 | Olympique Lyonnais - Fenerbahce | 21:00 | UHD')
    expect(activeMenuLabels(openVariantMenu('Quality'))).toEqual(['UHD'])
  })

  it('drops to 1080p only once BOTH UHD candidates have failed, and says so', async () => {
    const { player } = renderMirrors()
    await fail(player())
    await fail(player())
    expect(player().loaded).toEqual(['http://m/uhd-a', 'http://m/uhd-b', 'http://m/fhd-a'])
    expect(overlayLine()).toBe('TV 2 Sport 1 | Olympique Lyonnais - Fenerbahce | 21:00 | 1080p')
    expect(activeMenuLabels(openVariantMenu('Quality'))).toEqual(['1080p'])
  })

  it('starts the primary candidate when the user picks 1080p manually', () => {
    const { player } = renderMirrors()
    fireEvent.click(menuRow(openVariantMenu('Quality'), '1080p'))
    expect(player().loaded).toEqual(['http://m/uhd-a', 'http://m/fhd-a'])
    expect(overlayLine()).toBe('TV 2 Sport 1 | Olympique Lyonnais - Fenerbahce | 21:00 | 1080p')
  })

  it('exhausts the manually chosen 1080p candidates before going anywhere else', async () => {
    const { player } = renderMirrors()
    fireEvent.click(menuRow(openVariantMenu('Quality'), '1080p'))
    await fail(player())
    expect(player().loaded.at(-1)).toBe('http://m/fhd-b')
    expect(overlayLine()).toBe('TV 2 Sport 1 | Olympique Lyonnais - Fenerbahce | 21:00 | 1080p')
  })

  it('moves DOWN to 720p, never back up to UHD, once both 1080p candidates fail', async () => {
    const { player } = renderMirrors()
    fireEvent.click(menuRow(openVariantMenu('Quality'), '1080p'))
    await fail(player())
    await fail(player())
    expect(player().loaded.at(-1)).toBe('http://m/hd-a')
    expect(overlayLine()).toBe('TV 2 Sport 1 | Olympique Lyonnais - Fenerbahce | 21:00 | 720p')
  })

  it('never shows a duplicate menu row, however many candidates are behind a quality', async () => {
    const { player } = renderMirrors()
    await fail(player())
    fireEvent.click(menuRow(openVariantMenu('Quality'), '1080p'))
    const labels = menuLabels(document.querySelector('.options-popup') as HTMLElement)
    expect(labels).toEqual(['UHD', '1080p', '720p'])
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('counts every playable candidate when reporting total failure', async () => {
    const { player } = renderMirrors()
    for (let i = 0; i < 6; i++) {
      // eslint-disable-next-line no-await-in-loop
      await fail(player())
    }
    expect(screen.getByText('All 5 sources for this channel failed to play.')).toBeTruthy()
  })
})

describe('ChannelPlayerScreen ordinary channel playback (unchanged)', () => {
  it('keeps the Source menu and the channel\'s own sources when there is no stream group', () => {
    renderPlayer({ channels: [PLAIN_CHANNEL], playbackGroup: undefined })
    expect(screen.queryByText('Quality')).toBeNull()
    expect(menuLabels(openVariantMenu('Source'))).toEqual(['HD', 'SD'])
  })

  it('still honours initialSourceLabel for a plain channel watch', () => {
    const { player } = renderPlayer({ channels: [PLAIN_CHANNEL], playbackGroup: undefined, initialSourceLabel: 'SD' })
    expect(player().loaded).toEqual(['http://plain/sd'])
  })

  it('shows the plain channel name (no fabricated quality line)', () => {
    renderPlayer({ channels: [PLAIN_CHANNEL], playbackGroup: undefined })
    expect(overlayLine()).toBe('Test Sports Channel')
  })
})
