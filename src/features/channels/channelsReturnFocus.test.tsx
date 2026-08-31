// @vitest-environment jsdom
//
// CROSS-SCREEN RETURN NAVIGATION FOR CHANNELS.
//
// Four journeys leave a Channels screen and come back, and each has to land
// somewhere different:
//
//   Player          -> the exact channel row that opened it
//   Recently Watched-> the "Recently Watched" toolbar button
//   Favorites       -> the "Favorites" toolbar button
//   Channel vis.    -> the "Channel Visibility" toolbar button
//
// None of that is inferable from norigin's remembered last-focused child —
// it restores through the parent container on a 300ms debounce, which is the
// mechanism behind the Settings section-jump bug, and "the last thing
// focused" is the wrong answer anyway when four journeys share one screen.
// So the intent is stated by App and applied exactly once here; these tests
// are that contract.
//
// jsdom has no layout: what is asserted is which focus key is current and
// which rows are mounted, never a scroll position.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROOT_FOCUS_KEY, destroy, getCurrentFocusKey, init, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { BrowseCascadeScreen, type CascadeLevel } from './BrowseCascadeScreen'
import { CategoryChannelsScreen } from './CategoryChannelsScreen'
import { CHANNELS_TOOLBAR_FOCUS_KEYS, type ChannelsEntryIntent } from './channelsEntryIntent'
import { getChannelIndex } from '../../data/channelIndex'
import { NO_XTREAM_CREDENTIALS } from '../../data/playlists/xtreamResolver'
import type { Channel } from '../../data/channel'

init({ debug: false, visualDebug: false })
Element.prototype.scrollIntoView = () => {}

// Both screens build a real player for their preview pane on focus; the
// subject here is focus, not playback.
vi.mock('../../core/player', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/player')>()
  return {
    ...actual,
    preloadPlayerEngine: () => {},
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

// One country, one category, 200 channels — enough that the row being
// restored is far outside the list's initial mounted window.
const CHANNELS: Channel[] = Array.from({ length: 200 }, (_, i) => ({
  id: `id-CH${i}`,
  name: `CH${i}`,
  groupTitle: 'NO| Sports',
  sources: [{ label: 'HD', url: `https://provider.example/CH${i}.ts` }],
}))

function Cascade({
  entryIntent,
  level = 'channel',
  onEntryIntentConsumed = () => {},
  onOpenChannelVisibility = () => {},
}: {
  entryIntent?: ChannelsEntryIntent | null
  level?: CascadeLevel
  onEntryIntentConsumed?: () => void
  onOpenChannelVisibility?: () => void
}) {
  return (
    <BrowseCascadeScreen
      channelIndex={getChannelIndex(CHANNELS)}
      xtream={NO_XTREAM_CREDENTIALS}
      hiddenCountries={new Set()}
      preferredCountries={[]}
      hiddenCategories={new Set()}
      favoriteChannels={new Set()}
      onToggleFavoriteChannel={() => {}}
      onWatch={() => {}}
      onOpenFavorites={() => {}}
      onOpenRecent={() => {}}
      onOpenChannelVisibility={onOpenChannelVisibility}
      onExit={() => {}}
      entryIntent={entryIntent}
      onEntryIntentConsumed={onEntryIntentConsumed}
      level={level}
      onLevelChange={() => {}}
      selectedCountry="Norway"
      onSelectedCountryChange={() => {}}
      selectedCategory="Sports"
      onSelectedCategoryChange={() => {}}
      selectedChannel={null}
      onSelectedChannelChange={() => {}}
    />
  )
}

function Favorites({ restoreChannelId, onBack = () => {} }: { restoreChannelId?: string | null; onBack?: () => void }) {
  return (
    <CategoryChannelsScreen
      country=""
      category=""
      title="Favorites"
      breadcrumb={['Channels', 'Favorites']}
      channels={CHANNELS}
      xtream={NO_XTREAM_CREDENTIALS}
      favoriteChannels={new Set(CHANNELS.map((c) => c.id))}
      onToggleFavoriteChannel={() => {}}
      restoreChannelId={restoreChannelId}
      onWatch={() => {}}
      onBack={onBack}
    />
  )
}

const mountedNames = (container: HTMLElement) =>
  [...container.querySelectorAll('.ch-row-name')].map((n) => n.textContent ?? '')

afterEach(() => {
  cleanup()
  // The library keeps the last focus key and a debounced restore alive
  // across unmount; carried into the next test it would silently reclaim a
  // key the moment something registered under it again.
  destroy()
  init({ debug: false, visualDebug: false })
})
beforeEach(() => {
  init({ debug: false, visualDebug: false })
})

describe('Back from the player returns to the channel you were watching', () => {
  it('mounts and focuses that exact row in the cascade, not the first one', async () => {
    const { container } = render(<Cascade entryIntent={{ kind: 'channel', channelId: 'id-CH120' }} />)
    await act(async () => {})

    expect(mountedNames(container)).toContain('CH120')
    expect(getCurrentFocusKey()).toBe('cascade-channel-row-120')
  })

  it('opens the cascade at the top when there is no intent at all', async () => {
    const { container } = render(<Cascade />)
    await act(async () => {})

    expect(mountedNames(container)[0]).toBe('CH0')
    expect(getCurrentFocusKey()).toBe('cascade-channel-row-0')
  })

  it('falls back to the first row when the channel is no longer in the list', async () => {
    const { container } = render(<Cascade entryIntent={{ kind: 'channel', channelId: 'id-GONE' }} />)
    await act(async () => {})

    expect(mountedNames(container)[0]).toBe('CH0')
    expect(getCurrentFocusKey()).toBe('cascade-channel-row-0')
  })

  // Favorites and Recently Watched are the same screen, and had the same
  // bug: it initialised its selection from channels[0] and force-focused
  // row 0 regardless of what the viewer had just been watching.
  it('restores the same row in Favorites too, details panel included', async () => {
    const { container } = render(<Favorites restoreChannelId="id-CH120" />)
    await act(async () => {
      await setFocus(ROOT_FOCUS_KEY)
    })

    expect(mountedNames(container)).toContain('CH120')
    expect(getCurrentFocusKey()).toBe('category-channel-row-120')
    // The details panel has to agree with the row that took focus.
    expect(container.querySelector('.info-name')?.textContent).toBe('CH120')
  })

  it('still opens Favorites on the first channel for an ordinary entry', async () => {
    const { container } = render(<Favorites />)
    await act(async () => {
      await setFocus(ROOT_FOCUS_KEY)
    })
    expect(getCurrentFocusKey()).toBe('category-channel-row-0')
    expect(container.querySelector('.info-name')?.textContent).toBe('CH0')
  })

  it('falls back to the first row in Favorites when the channel was unfavorited while it played', async () => {
    const { container } = render(<Favorites restoreChannelId="id-GONE" />)
    await act(async () => {
      await setFocus(ROOT_FOCUS_KEY)
    })
    expect(getCurrentFocusKey()).toBe('category-channel-row-0')
    expect(container.querySelector('.info-name')?.textContent).toBe('CH0')
  })
})

describe('Back from a Channels subview returns to the button that opened it', () => {
  it('lands on the Favorites button, not on a country or a channel', async () => {
    render(<Cascade entryIntent={{ kind: 'toolbar', target: 'favorites' }} />)
    await act(async () => {})
    expect(getCurrentFocusKey()).toBe(CHANNELS_TOOLBAR_FOCUS_KEYS.favorites)
  })

  it('lands on the Recently Watched button', async () => {
    render(<Cascade entryIntent={{ kind: 'toolbar', target: 'recent' }} />)
    await act(async () => {})
    expect(getCurrentFocusKey()).toBe(CHANNELS_TOOLBAR_FOCUS_KEYS.recent)
  })

  it('lands on the Channel Visibility button when returning from Settings', async () => {
    render(<Cascade entryIntent={{ kind: 'toolbar', target: 'filters' }} />)
    await act(async () => {})
    expect(getCurrentFocusKey()).toBe(CHANNELS_TOOLBAR_FOCUS_KEYS.filters)
  })

  // The intent OUTRANKS the cascade's own state restoration — that is the
  // whole point. Left to itself, level 'channel' would focus the channel
  // column, which is where the viewer was before they pressed Favorites,
  // and not where they just came back from.
  it('outranks the cascade level the viewer left behind', async () => {
    render(<Cascade entryIntent={{ kind: 'toolbar', target: 'favorites' }} level="channel" />)
    await act(async () => {})
    expect(getCurrentFocusKey()).toBe(CHANNELS_TOOLBAR_FOCUS_KEYS.favorites)
  })

  it('reports the intent spent so it cannot be applied to a later entry', async () => {
    const consumed = vi.fn()
    render(<Cascade entryIntent={{ kind: 'toolbar', target: 'favorites' }} onEntryIntentConsumed={consumed} />)
    await act(async () => {})
    expect(consumed).toHaveBeenCalledTimes(1)
  })

  it('restores the cascade normally when there is no intent', async () => {
    render(<Cascade level="channel" />)
    await act(async () => {})
    expect(getCurrentFocusKey()).toBe('cascade-channel-row-0')
  })
})

describe('the Channels toolbar', () => {
  it('offers Channel Visibility rather than a filter popup of its own', async () => {
    const { container } = render(<Cascade />)
    await act(async () => {})
    const labels = [...container.querySelectorAll('.filter-btn')].map((b) => b.textContent)
    expect(labels).toEqual(['Channel Visibility', 'Recently Watched', 'Favorites'])
  })

  it('asks App to open Settings instead of opening anything itself', async () => {
    const onOpenChannelVisibility = vi.fn()
    const { container } = render(<Cascade onOpenChannelVisibility={onOpenChannelVisibility} />)
    await act(async () => {})

    await act(async () => {
      ;(container.querySelector('.filter-btn') as HTMLElement).click()
    })
    expect(onOpenChannelVisibility).toHaveBeenCalledTimes(1)
    // Nothing opened on top of Channels — the popup is gone, not hidden.
    expect(document.querySelector('.filter-overlay')).toBeNull()
  })
})

// The category star and everything behind it was removed on 2026-08-31.
// Channel favorites are a separate, untouched feature — see ChannelRow.
describe('category rows carry no favorite star', () => {
  it('renders no star in the category column', async () => {
    const { container } = render(<Cascade level="category" />)
    await act(async () => {})
    expect(container.querySelector('.cascade-col.category')).toBeTruthy()
    expect(container.querySelectorAll('.list-row-favorite')).toHaveLength(0)
  })

  it('keeps the channel rows own favorite stars', async () => {
    const { container } = render(<Cascade />)
    await act(async () => {})
    expect(container.querySelectorAll('.ch-row-favorite').length).toBeGreaterThan(0)
  })
})
