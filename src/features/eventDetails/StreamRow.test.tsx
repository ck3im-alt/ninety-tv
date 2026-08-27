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
    expect(container.querySelectorAll('.stream-row-quality-col')).toHaveLength(1)
  })

  it('does not change the displayed quality when arrow keys are pressed', () => {
    const { container } = render(
      <StreamRow option={mergedOption()} variant="default" favoriteChannels={new Set()} onToggleFavoriteChannels={() => {}} onWatch={() => {}} />,
    )
    const value = () => container.querySelector('.stream-row-quality-col')?.textContent
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
    const values = [...container.querySelectorAll('.stream-row-quality-col')].map((n) => n.textContent)
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

// ---------------------------------------------------------------------------
// Row metadata (2026-08-26)
// ---------------------------------------------------------------------------
// Country used to be stated ONLY as a section heading, which works for the
// viewer's preferred markets (one heading each) and left the flat "Other
// countries" bucket saying nothing at all — so a Danish feed recommended to
// a Norwegian viewer looked like any other row until the commentary started.
describe('StreamRow metadata', () => {
  function optionFrom(groupTitle: string, sources: ChannelSource[]): RankedEventStreamOption {
    const channel: Channel = { id: 'c1', name: 'TV 2 Sport 1', groupTitle, sources }
    const match: ChannelMatch = {
      channel,
      source: 'ninety',
      label: 'TV 2 Sport 1',
      isExactMatch: true,
      identityClassification: 'CONFIRMED',
      logicalChannelId: 'dk_tv2_sport_1',
    }
    return rankEventStreamOptions(buildEventStreamOptions([match], new Set<string>()), {
      favoriteCountries: [],
      streamType: 'auto',
    })[0]
  }

  const render1 = (option: RankedEventStreamOption, showCountry?: boolean) =>
    render(
      <StreamRow
        option={option}
        variant="default"
        showCountry={showCountry}
        favoriteChannels={new Set()}
        onToggleFavoriteChannels={() => {}}
        onWatch={() => {}}
      />,
    )

  it('names the country on a row that asks for it', () => {
    const { container } = render1(optionFrom('DK| Sport', [{ label: 'FHD', url: 'http://x/1' }]), true)
    const tag = container.querySelector('.stream-row-country')
    expect(tag).toBeTruthy()
    // The ISO code on screen, the full name in the tooltip/label — "United
    // Kingdom" spelled out would be wider than the type and quality tags
    // put together.
    expect(tag?.querySelector('.stream-row-country-code')?.textContent).toBe('DK')
    expect(tag?.getAttribute('title')).toBe('Denmark')
    expect(tag?.querySelector('.stream-row-country-flag')).toBeTruthy()
  })

  it('says nothing about country on a row whose section heading already does', () => {
    const { container } = render1(optionFrom('DK| Sport', [{ label: 'FHD', url: 'http://x/1' }]))
    expect(container.querySelector('.stream-row-country')).toBeNull()
  })

  it('shows no country tag at all when the origin is genuinely unknown', () => {
    // No recognizable country in the group title — better to say nothing
    // than to render a placeholder that looks like a broken flag.
    const { container } = render1(optionFrom('Sports', [{ label: 'FHD', url: 'http://x/1' }]), true)
    expect(container.querySelector('.stream-row-country')).toBeNull()
  })

  it('gives UHD and above one step more emphasis, and nothing else a status colour', () => {
    const { container: uhd } = render1(optionFrom('DK| Sport', [{ label: 'UHD', url: 'http://x/1' }]))
    expect(uhd.querySelector('.stream-row-quality-col')?.className).toContain('high')

    // HD is not a warning state and must not be styled as one — it is
    // simply the ordinary quality treatment.
    const { container: hd } = render1(optionFrom('DK| Sport', [{ label: 'HD', url: 'http://x/2' }]))
    const hdClass = hd.querySelector('.stream-row-quality-col')?.className ?? ''
    expect(hdClass).not.toContain('high')
    expect(hdClass).not.toContain('unknown')
  })

  it('drops the quality treatment entirely when quality is unknown', () => {
    // No quality tag anywhere in the source label — the one case where
    // Ninety genuinely does not know.
    const { container } = render1(optionFrom('DK| Sport', [{ label: '', url: 'http://x/1' }]))
    const badge = container.querySelector('.stream-row-quality-col')
    expect(badge?.className).toContain('unknown')
    expect(badge?.textContent).toBe('—')
  })

  it('keeps every tag inside the one fixed-width group that aligns the Watch column', () => {
    const { container } = render1(optionFrom('DK| Sport', [{ label: 'FHD', url: 'http://x/1' }]), true)
    const meta = container.querySelector('.stream-row-meta')
    expect(meta).toBeTruthy()
    // Country, type and quality — and no tag loose outside the group, which
    // is what would break the alignment down a long list.
    expect(meta?.querySelectorAll('.stream-row-badge')).toHaveLength(3)
    expect(container.querySelectorAll('.stream-row-badge')).toHaveLength(3)
  })
})
