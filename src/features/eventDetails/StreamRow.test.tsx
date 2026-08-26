// @vitest-environment jsdom
//
// Event Details rows must not ask the user to choose a quality before
// they've seen the stream (stream-dedupe task, Part 3): one logical
// broadcaster = one row, showing the BEST available variant, and Watch now
// hands the WHOLE group to playback (Part 4) rather than the single source
// the row happened to display.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { init } from '@noriginmedia/norigin-spatial-navigation'
import { StreamRow } from './StreamRow'
import { buildEventStreamOptions, rankEventStreamOptions } from './buildEventStreamOptions'
import type { RankedEventStreamOption } from './buildEventStreamOptions'
import type { EventPlaybackGroup } from './eventPlaybackGroup'
import type { ChannelMatch } from '../../data/sports/channelMatch'
import type { Channel, ChannelSource } from '../../data/channel'

// Same one-time setup main.tsx does before rendering <App/>; without it
// every useFocusable() registration throws an unhandled measureLayout
// rejection in jsdom.
init({ debug: false, visualDebug: false })
Element.prototype.scrollIntoView = () => {}

afterEach(cleanup)

function resolvedMatch(id: string, name: string, sources: ChannelSource[]): ChannelMatch {
  const channel: Channel = { id, name, groupTitle: 'NO| Sports', sources }
  return {
    channel,
    source: 'ninety',
    label: 'TV 2 Sport 1',
    isExactMatch: true,
    identityClassification: 'CONFIRMED',
    logicalChannelId: 'no_tv2_sport_1',
  }
}

// One logical Norwegian broadcaster spread across two playlist channels and
// four quality variants — the shape the reported duplicate-row case
// produces once identity grouping collapses it.
function mergedOption(): RankedEventStreamOption {
  const matches = [
    resolvedMatch('p1', 'TV2 SPORT 1', [
      { label: 'HD', url: 'http://x/hd' },
      { label: '8K', url: 'http://x/8k' },
    ]),
    resolvedMatch('p2', 'TV 2 SPORT 1', [
      { label: 'UHD', url: 'http://x/uhd' },
      { label: 'SD', url: 'http://x/sd' },
    ]),
  ]
  const options = buildEventStreamOptions(matches, new Set<string>())
  expect(options).toHaveLength(1)
  return rankEventStreamOptions(options, { favoriteCountries: [], streamType: 'auto' })[0]
}

function renderRow(overrides: { option?: RankedEventStreamOption; favorites?: Set<string> } = {}) {
  const option = overrides.option ?? mergedOption()
  const onWatch = vi.fn<(group: EventPlaybackGroup) => void>()
  const onToggleFavoriteChannels = vi.fn<(channelIds: string[]) => void>()
  render(
    <StreamRow
      option={option}
      variant="default"
      favoriteChannels={overrides.favorites ?? new Set<string>()}
      onToggleFavoriteChannels={onToggleFavoriteChannels}
      onWatch={onWatch}
    />,
  )
  return { option, onWatch, onToggleFavoriteChannels }
}

describe('StreamRow quality presentation', () => {
  it('shows the best available quality across every merged variant', () => {
    renderRow()
    expect(screen.getByText('8K')).toBeTruthy()
  })

  it('renders no quality-cycling affordance at all', () => {
    const { container } = render(
      <StreamRow option={mergedOption()} variant="default" favoriteChannels={new Set()} onToggleFavoriteChannels={() => {}} onWatch={() => {}} />,
    )
    expect(container.querySelectorAll('.stream-row-quality-cue')).toHaveLength(0)
    // Exactly one quality value in the row — not a selectable list.
    expect(container.querySelectorAll('.stream-row-quality-value')).toHaveLength(1)
  })

  it('does not change the displayed quality when arrow keys are pressed', () => {
    const { container } = render(
      <StreamRow option={mergedOption()} variant="default" favoriteChannels={new Set()} onToggleFavoriteChannels={() => {}} onWatch={() => {}} />,
    )
    const value = () => container.querySelector('.stream-row-quality-value')?.textContent
    expect(value()).toBe('8K')
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft']) {
      fireEvent.keyDown(window, { key, keyCode: key === 'ArrowRight' ? 39 : 37 })
    }
    expect(value()).toBe('8K')
  })
})

describe('StreamRow playback hand-off', () => {
  it('hands the whole logical group to playback, best-quality first', () => {
    const { option, onWatch } = renderRow()
    fireEvent.click(screen.getByText('TV 2 Sport 1'))

    expect(onWatch).toHaveBeenCalledTimes(1)
    const [group] = onWatch.mock.calls[0]
    expect(group.key).toBe(option.key)
    expect(group.variants.map((v) => v.qualityLabel)).toEqual(['8K', 'UHD', '720p', 'SD'])
    expect(group.variants[0].candidates[0].source.url).toBe('http://x/8k')
  })

  it('carries variants that belong to a DIFFERENT playlist channel than the one playing', () => {
    const { onWatch } = renderRow()
    fireEvent.click(screen.getByText('TV 2 Sport 1'))
    const [group] = onWatch.mock.calls[0]

    const channelIds = group.variants.flatMap((v) => v.candidates.map((c) => c.channel.id))
    expect(new Set(channelIds)).toEqual(new Set(['p1', 'p2']))
  })

  it('always starts the same best variant, however many times the row is pressed', () => {
    const { onWatch } = renderRow()
    const row = screen.getByText('TV 2 Sport 1')
    fireEvent.click(row)
    fireEvent.click(row)

    const urls = onWatch.mock.calls.map(([group]) => group.variants[0].candidates[0].source.url)
    expect(urls).toEqual(['http://x/8k', 'http://x/8k'])
  })
})

// Same-quality mirrors must stay invisible on this screen: they're
// failover material, not a viewing choice (see buildEventStreamOptions.ts's
// groupSourcesByTier).
describe('StreamRow with same-quality mirrors behind a tier', () => {
  function mirroredOption(): RankedEventStreamOption {
    const matches = [
      resolvedMatch('p1', 'TV2 SPORT 1', [
        { label: 'UHD', url: 'http://x/uhd-a' },
        { label: 'FHD', url: 'http://x/fhd-a' },
      ]),
      resolvedMatch('p2', 'TV 2 SPORT 1', [{ label: 'UHD', url: 'http://x/uhd-b' }]),
    ]
    const options = buildEventStreamOptions(matches, new Set<string>())
    return rankEventStreamOptions(options, { favoriteCountries: [], streamType: 'auto' })[0]
  }

  it('still renders exactly one row showing one quality', () => {
    const { container } = render(
      <StreamRow option={mirroredOption()} variant="default" favoriteChannels={new Set()} onToggleFavoriteChannels={() => {}} onWatch={() => {}} />,
    )
    expect(container.querySelectorAll('.stream-row')).toHaveLength(1)
    const values = [...container.querySelectorAll('.stream-row-quality-value')].map((n) => n.textContent)
    expect(values).toEqual(['UHD'])
  })

  it('hands both UHD candidates to playback behind the single UHD choice', () => {
    const { onWatch } = renderRow({ option: mirroredOption() })
    fireEvent.click(screen.getByText('TV 2 Sport 1'))
    const [group] = onWatch.mock.calls[0]

    expect(group.variants.map((v) => v.qualityLabel)).toEqual(['UHD', '1080p'])
    expect(group.variants[0].candidates.map((c) => c.source.url)).toEqual(['http://x/uhd-a', 'http://x/uhd-b'])
  })
})

describe('StreamRow favorite state for a merged row', () => {
  it('shows the row as favorited when ANY of its playlist channels is favorited', () => {
    renderRow({ favorites: new Set(['p2']) })
    expect(screen.getByLabelText('Remove from favorites')).toBeTruthy()
  })

  it('toggles every playlist channel behind the row at once', () => {
    const { onToggleFavoriteChannels } = renderRow()
    fireEvent.click(screen.getByLabelText('Add to favorites'))
    expect(onToggleFavoriteChannels).toHaveBeenCalledWith(['p1', 'p2'])
  })
})
