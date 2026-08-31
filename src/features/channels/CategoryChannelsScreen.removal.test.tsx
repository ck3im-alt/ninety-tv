// @vitest-environment jsdom
//
// Removing the row the viewer is standing on — the Favorites case.
//
// Unfavoriting the focused channel takes it out of `channels`. Two effects
// then run, child-first: VirtualChannelList re-anchors its window, and
// CategoryChannelsScreen focuses the row that slid into the gap
// (pickFallbackAfterRemoval). Those two have to agree. While the list
// component reset its window to row 0 in this case they did not: the row the
// parent was about to focus had just been unmounted, setFocus parked the
// service on a key with no component behind it, and because an explicit
// setFocus cancels norigin's debounced auto-restore nothing ever moved focus
// again. Arrows did nothing; only the hardware Back key still worked.
//
// jsdom has no layout, so this asserts only what is structural: which rows
// are mounted, and whether the current focus key resolves to a real
// focusable.
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { doesFocusableExist, getCurrentFocusKey, init, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { CategoryChannelsScreen } from './CategoryChannelsScreen'
import { NO_XTREAM_CREDENTIALS } from '../../data/playlists/xtreamResolver'
import type { Channel } from '../../data/channel'

init({ debug: false, visualDebug: false })
Element.prototype.scrollIntoView = () => {}

// The preview pane builds a real player on focus; this screen's subject is
// focus, not playback.
vi.mock('../../core/player', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/player')>()
  return {
    ...actual,
    createHtmlVideoPlayer: () => ({
      attach() {},
      async load() {},
      async play() {},
      pause() {},
      seekBy() {},
      seekToLive() {},
      setMuted() {},
      setSubtitleTrack() {},
      getState: () => ({
        status: 'idle' as const,
        currentTime: 0,
        duration: 0,
        error: null,
        subtitleTracks: [],
        activeSubtitleTrack: null,
        muted: true,
      }),
      subscribe: () => () => {},
      dispose() {},
    }),
  }
})

function channels(count: number): Channel[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `id-CH${i}`,
    name: `CH${i}`,
    groupTitle: 'NO| Sports',
    sources: [{ label: 'HD', url: `https://provider.example/CH${i}.ts` }],
  }))
}

function Favorites({ list }: { list: Channel[] }) {
  return (
    <CategoryChannelsScreen
      country=""
      category=""
      title="Favorites"
      breadcrumb={['Channels', 'Favorites']}
      channels={list}
      xtream={NO_XTREAM_CREDENTIALS}
      favoriteChannels={new Set(list.map((c) => c.id))}
      onToggleFavoriteChannel={() => {}}
      onWatch={() => {}}
      onBack={() => {}}
    />
  )
}

function mountedNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.ch-row-name')].map((n) => n.textContent ?? '')
}

function windowTop(container: HTMLElement): number {
  return Number(mountedNames(container)[0].replace('CH', ''))
}

// Walks the virtualization window deep into the list the way the remote
// does: focus the row that owns the "shift the window" Down handler, press
// Down, repeat. Only ~50 rows are mounted at a time, so this is the only way
// to reach row 300 without pretending the window moved.
async function scrollDeep(container: HTMLElement): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const trigger = windowTop(container) + 40
    if (trigger >= 480) break
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await setFocus(`category-channel-row-${trigger}`)
    })
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowDown', keyCode: 40 })
    })
  }
  return Number(getCurrentFocusKey()!.replace('category-channel-row-', ''))
}

afterEach(cleanup)

describe('unfavoriting the focused row deep in Favorites', () => {
  it('leaves focus on a real, mounted row and does not jump to the top', async () => {
    const all = channels(500)
    const { container, rerender } = render(<Favorites list={all} />)

    const focusedIndex = await scrollDeep(container)
    expect(focusedIndex).toBeGreaterThan(200)
    expect(mountedNames(container)).toContain(`CH${focusedIndex}`)
    const topBefore = windowTop(container)

    await act(async () => {
      rerender(<Favorites list={all.filter((c) => c.id !== `id-CH${focusedIndex}`)} />)
    })

    // The remote must still work: whatever holds focus has to be something
    // that actually exists.
    const current = getCurrentFocusKey()
    expect(current).not.toBeNull()
    expect(doesFocusableExist(current!)).toBe(true)
    // And the viewer must still be where they were.
    expect(windowTop(container)).toBe(topBefore)
    expect(mountedNames(container)).not.toContain(`CH${focusedIndex}`)
    // NOT a slow assertion — a genuinely expensive setup. scrollDeep drives
    // ~20 real focus-then-ArrowDown cycles through a 500-channel list, each
    // one re-rendering the ~50 mounted rows and re-registering their
    // focusables, and only then is the removal exercised. Vitest's 5s
    // default is a framework default rather than a budget for this, and on
    // a cold transform cache in a full parallel run it was the one test in
    // the suite that could tip over it. Stated explicitly instead of being
    // left to flake in CI; nothing here is waiting on a timer.
  }, 30_000)
})
