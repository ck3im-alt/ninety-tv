// @vitest-environment jsdom
//
// H2 — Channels must survive a background playlist install.
//
// VirtualChannelList used to reset its window to row 0 on ANY change of the
// `channels` array reference. That was correct while the array only ever
// changed because the viewer switched category, and became wrong the moment
// provider playlists started refreshing on their own: a viewer four thousand
// rows into "Norway · Sports" would be yanked back to the top, with focus
// stranded on a key that no longer resolves.
//
// jsdom has no layout, so nothing geometric is asserted here — only the two
// things that are structural and therefore provable: which rows are MOUNTED
// (the window position) and which focus key is current.
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrentFocusKey, init, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { VirtualChannelList } from './VirtualChannelList'
import type { Channel } from '../../data/channel'

init({ debug: false, visualDebug: false })
// jsdom implements no layout, so it has no scrollIntoView — the shared
// useFocusScrollIntoView hook every focusable row uses calls it on focus.
Element.prototype.scrollIntoView = () => {}

function channels(names: string[]): Channel[] {
  return names.map((name) => ({
    id: `id-${name}`,
    name,
    groupTitle: 'NO| Sports',
    sources: [{ label: 'HD', url: `https://provider.example/${name}.ts` }],
  }))
}

const BIG = Array.from({ length: 500 }, (_, i) => `CH${i}`)

function List({ list, listKey, selectedId }: { list: Channel[]; listKey: string; selectedId: string | undefined }) {
  return (
    <VirtualChannelList
      channels={list}
      favoriteChannels={new Set<string>()}
      selectedChannelId={selectedId}
      focusKeyPrefix="row"
      listKey={listKey}
      onSelect={() => {}}
      onFocusChannel={() => {}}
      onToggleFavorite={() => {}}
    />
  )
}

// The window position, expressed as the names actually mounted right now.
// This is the only structural signal jsdom can give — and it is the exact
// thing that matters: which rows exist, and therefore which focus keys
// resolve.
function mountedNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.ch-row-name')].map((n) => n.textContent ?? '')
}

afterEach(cleanup)
beforeEach(() => {
  init({ debug: false, visualDebug: false })
})

describe('a new generation of the SAME list', () => {
  it('keeps the viewer where they were instead of resetting to row 0', async () => {
    const { container, rerender } = render(<List list={channels(BIG)} listKey="Norway::Sports" selectedId="id-CH0" />)
    expect(mountedNames(container)[0]).toBe('CH0')

    // Move the anchor deep into the list — this is what selectedChannelId
    // tracks in both real screens (it follows focus via onFocusChannel).
    await act(async () => {
      rerender(<List list={channels(BIG)} listKey="Norway::Sports" selectedId="id-CH300" />)
    })
    const deepWindow = mountedNames(container)
    expect(deepWindow).toContain('CH300')
    expect(deepWindow).not.toContain('CH0')

    // A background refresh installs a generation with one channel inserted
    // ABOVE the anchor — the worst case, because every positional focus key
    // below it now addresses a different channel.
    await act(async () => {
      rerender(<List list={channels(['NEW PPV', ...BIG])} listKey="Norway::Sports" selectedId="id-CH300" />)
    })

    const afterRefresh = mountedNames(container)
    expect(afterRefresh).toContain('CH300')
    expect(afterRefresh).not.toContain('CH0')
    expect(afterRefresh).not.toContain('NEW PPV')
  })

  it('re-points focus at the SAME channel when its index shifts', async () => {
    const list = channels(BIG.slice(0, 40))
    const { rerender } = render(<List list={list} listKey="Norway::Sports" selectedId="id-CH5" />)
    await act(async () => {
      await setFocus('row-5')
    })
    expect(getCurrentFocusKey()).toBe('row-5')

    // A generation that inserts one channel at the top shifts CH5 to index 6.
    await act(async () => {
      rerender(<List list={channels(['NEW PPV', ...BIG.slice(0, 40)])} listKey="Norway::Sports" selectedId="id-CH5" />)
    })

    expect(getCurrentFocusKey()).toBe('row-6')
  })

  it('holds the window in place when the anchored channel disappears', async () => {
    const { container, rerender } = render(<List list={channels(BIG)} listKey="Norway::Sports" selectedId="id-CH300" />)
    await act(async () => {
      rerender(<List list={channels(BIG)} listKey="Norway::Sports" selectedId="id-CH300" />)
    })
    expect(mountedNames(container)).toContain('CH300')
    const topBefore = mountedNames(container)[0]

    // The provider dropped CH300 — there is nothing left to re-anchor on.
    await act(async () => {
      rerender(<List list={channels(BIG.filter((n) => n !== 'CH300'))} listKey="Norway::Sports" selectedId="id-CH300" />)
    })

    // The window does NOT reset to the top. Every caller recovers from a
    // removal by focusing the row that slid into the gap
    // (CategoryChannelsScreen's pickFallbackAfterRemoval effect, which runs
    // after this component's because React flushes passive effects
    // child-first) — resetting here unmounted exactly that row, so the
    // caller's setFocus landed on a key with nothing behind it and the
    // remote stopped responding. The neighbour has to still be mounted.
    expect(mountedNames(container)[0]).toBe(topBefore)
    expect(mountedNames(container)).toContain('CH299')
    expect(mountedNames(container)).toContain('CH301')
  })

  // The row a viewer is standing on must stay the row OK plays, across a
  // background generation that shifts every index below an insertion.
  //
  // norigin registers a focusable in a mount-only effect, so a surviving
  // component whose focusKey PROP changes keeps its old registration, while
  // updateFocusable writes its node/handlers into whichever component owns
  // the new key — and never updates that entry's onUpdateFocus. The
  // highlight and the action ended up on two different rows.
  it('keeps the highlight and the OK target on the same channel after an insertion above it', async () => {
    const onSelect = vi.fn()
    const list = channels(BIG.slice(0, 40))
    const { container, rerender } = render(
      <VirtualChannelList
        channels={list}
        favoriteChannels={new Set<string>()}
        selectedChannelId="id-CH5"
        focusKeyPrefix="row"
        listKey="Norway::Sports"
        onSelect={onSelect}
        onFocusChannel={() => {}}
        onToggleFavorite={() => {}}
      />,
    )
    await act(async () => {
      await setFocus('row-5')
    })
    expect(container.querySelector('.ch-row.focused .ch-row-name')?.textContent).toBe('CH5')

    await act(async () => {
      rerender(
        <VirtualChannelList
          channels={channels(['NEW PPV', ...BIG.slice(0, 40)])}
          favoriteChannels={new Set<string>()}
          selectedChannelId="id-CH5"
          focusKeyPrefix="row"
          listKey="Norway::Sports"
          onSelect={onSelect}
          onFocusChannel={() => {}}
          onToggleFavorite={() => {}}
        />,
      )
    })

    expect(container.querySelector('.ch-row.focused .ch-row-name')?.textContent).toBe('CH5')
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 })
    })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0].name).toBe('CH5')
  })
})

describe('a genuinely different list', () => {
  it('still resets to row 0 when the viewer switches category', async () => {
    const { container, rerender } = render(<List list={channels(BIG)} listKey="Norway::Sports" selectedId="id-CH300" />)
    await act(async () => {
      rerender(<List list={channels(BIG)} listKey="Norway::Sports" selectedId="id-CH300" />)
    })
    expect(mountedNames(container)).toContain('CH300')

    await act(async () => {
      rerender(<List list={channels(BIG)} listKey="Norway::Movies" selectedId={undefined} />)
    })
    const afterSwitch = mountedNames(container)
    expect(afterSwitch[0]).toBe('CH0')
    expect(afterSwitch).not.toContain('CH300')
  })
})
