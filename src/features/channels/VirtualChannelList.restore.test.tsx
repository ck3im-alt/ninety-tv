// @vitest-environment jsdom
//
// RETURNING TO THE CHANNEL YOU WERE JUST WATCHING.
//
// Back out of the player used to reopen the channel list at the top. The
// cause was structural rather than a focus mistake: the mounted window is
// local to VirtualChannelList and started at row 0 on every remount, so the
// row the viewer came from was not merely unfocused — it did not exist in
// the DOM, and nothing could focus a key with no component behind it.
//
// jsdom has no layout, so nothing about scrolling is asserted here. The two
// things that ARE structural are exactly the two that were broken: which
// rows are mounted, and which focus key is current.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ROOT_FOCUS_KEY, getCurrentFocusKey, init, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { VirtualChannelList } from './VirtualChannelList'
import { planChannelRestore } from './virtualWindow'
import type { Channel } from '../../data/channel'

init({ debug: false, visualDebug: false })
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

function List({ list, restoreChannelId }: { list: Channel[]; restoreChannelId?: string | null }) {
  return (
    <VirtualChannelList
      channels={list}
      favoriteChannels={new Set<string>()}
      selectedChannelId={undefined}
      focusKeyPrefix="row"
      listKey="Norway::Sports"
      restoreChannelId={restoreChannelId}
      onSelect={() => {}}
      onFocusChannel={() => {}}
      onToggleFavorite={() => {}}
      forceFocusFirst
    />
  )
}

const mountedNames = (container: HTMLElement) =>
  [...container.querySelectorAll('.ch-row-name')].map((n) => n.textContent ?? '')

afterEach(cleanup)
beforeEach(() => {
  init({ debug: false, visualDebug: false })
})

describe('planChannelRestore — the decision, before anything is focused', () => {
  const list = channels(BIG)

  it('finds the channel by identity and names a window that mounts it', () => {
    const plan = planChannelRestore(list, 'id-CH300', 50, 450)
    expect(plan.found).toBe(true)
    expect(plan.index).toBe(300)
    expect(plan.windowStart).toBeLessThanOrEqual(300)
    expect(plan.windowStart + 50).toBeGreaterThan(300)
  })

  // POSITION IS NOT IDENTITY. A playlist refresh can insert rows above the
  // viewer while the match is on, so the index the channel had when playback
  // started is not the index it has now.
  it('resolves the CURRENT index, not the one the channel used to have', () => {
    const shifted = channels(['NEW-A', 'NEW-B', ...BIG])
    expect(planChannelRestore(shifted, 'id-CH300', 50, 452).index).toBe(302)
  })

  // No "nearest" is knowable here — the stale index is untrustworthy for
  // exactly the reason above — so the honest fallback is the first row, and
  // `found` says which of the two happened.
  it('falls back to the first row when the channel is gone', () => {
    const plan = planChannelRestore(list, 'id-DELETED', 50, 450)
    expect(plan).toEqual({ index: 0, windowStart: 0, found: false })
  })

  it('reports nothing to focus for an empty list', () => {
    expect(planChannelRestore([], 'id-CH300', 50, 0)).toEqual({ index: -1, windowStart: 0, found: false })
  })

  it('starts at the top for an ordinary entry with nothing to restore', () => {
    expect(planChannelRestore(list, undefined, 50, 450)).toEqual({ index: 0, windowStart: 0, found: false })
  })
})

describe('VirtualChannelList — restoring a row outside the initial window', () => {
  it('mounts a deep channel on the FIRST render, not after an effect', () => {
    const { container } = render(<List list={channels(BIG)} restoreChannelId="id-CH300" />)
    // The row has to exist before any parent effect runs setFocus — an
    // effect-driven window move would land a frame too late and the parent
    // would silently fall back to row 0.
    expect(mountedNames(container)).toContain('CH300')
    expect(mountedNames(container)).not.toContain('CH0')
  })

  it('focuses that exact row rather than the first one', async () => {
    render(<List list={channels(BIG)} restoreChannelId="id-CH300" />)
    await act(async () => {
      await setFocus(ROOT_FOCUS_KEY)
    })
    expect(getCurrentFocusKey()).toBe('row-300')
  })

  it('still opens at the top when there is nothing to restore', async () => {
    const { container } = render(<List list={channels(BIG)} />)
    expect(mountedNames(container)[0]).toBe('CH0')
    await act(async () => {
      await setFocus(ROOT_FOCUS_KEY)
    })
    expect(getCurrentFocusKey()).toBe('row-0')
  })

  // The channel was unfavorited, filtered out, or dropped by a refresh while
  // it was playing. Landing at the top is the pre-existing behaviour, and is
  // the right one for the only case where nothing better is knowable.
  it('falls back safely to the first row when the target has disappeared', async () => {
    const { container } = render(<List list={channels(BIG)} restoreChannelId="id-GONE" />)
    expect(mountedNames(container)[0]).toBe('CH0')
    await act(async () => {
      await setFocus(ROOT_FOCUS_KEY)
    })
    expect(getCurrentFocusKey()).toBe('row-0')
  })

  it('restores a channel that moved index while the player was up', async () => {
    const shifted = channels(['NEW-A', 'NEW-B', ...BIG])
    const { container } = render(<List list={shifted} restoreChannelId="id-CH300" />)
    expect(mountedNames(container)).toContain('CH300')
    await act(async () => {
      await setFocus(ROOT_FOCUS_KEY)
    })
    // Two insertions above it: the row is at 302 now, and the restore
    // followed the CHANNEL rather than the old position.
    expect(getCurrentFocusKey()).toBe('row-302')
  })

  it('handles a list shorter than one window', async () => {
    const { container } = render(<List list={channels(['A', 'B', 'C'])} restoreChannelId="id-B" />)
    expect(mountedNames(container)).toEqual(['A', 'B', 'C'])
    await act(async () => {
      await setFocus(ROOT_FOCUS_KEY)
    })
    expect(getCurrentFocusKey()).toBe('row-1')
  })
})
