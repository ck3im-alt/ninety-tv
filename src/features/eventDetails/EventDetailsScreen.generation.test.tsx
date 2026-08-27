// @vitest-environment jsdom
//
// H3 — Match View's reaction to a background playlist generation.
//
// Two opposing requirements meet on this screen, and both have to hold at
// once:
//
//   1. A provider adding a PPV feed twenty minutes before kickoff must
//      become discoverable HERE, without the viewer backing out and coming
//      back in. So a new generation genuinely does re-run matching.
//   2. That re-match must be invisible: no "Finding the best streams…"
//      flash, no reordering under the remote, and no focus jump back to
//      row 1 while someone is reading row 5.
//
// Which is why the trigger is the generation id and not the `channels`
// array — the array's reference changes for reasons that are not a playlist
// change at all, and reacting to it was what made the screen flash.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCurrentFocusKey, init, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { EventDetailsScreen } from './EventDetailsScreen'
import { buildEventStreamOptions, partitionStreamOptions, rankEventStreamOptions } from './buildEventStreamOptions'
import type { ChannelMatch } from '../../data/sports/channelMatch'
import type { Channel, ChannelSource } from '../../data/channel'
import type { SportEvent } from '../../data/sports/types'
import type { XtreamCredentialResolver } from '../../data/playlists/xtreamResolver'

init({ debug: false, visualDebug: false })
Element.prototype.scrollIntoView = () => {}

const { matchChannelsForEventMock } = vi.hoisted(() => ({ matchChannelsForEventMock: vi.fn() }))
vi.mock('../../data/sports/channelMatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/sports/channelMatch')>()),
  matchChannelsForEvent: matchChannelsForEventMock,
}))

function match(id: string, name: string, sources: ChannelSource[]): ChannelMatch {
  const channel: Channel = { id, name, groupTitle: 'NO| Sport', sources }
  return { channel, source: 'ninety', label: name, isExactMatch: true, identityClassification: 'CONFIRMED', logicalChannelId: `logical_${id}` }
}

const BASE: ChannelMatch[] = [
  match('c1', 'TV 2 Sport 1', [{ label: 'FHD', url: 'http://x/1' }]),
  match('c2', 'Viaplay Sport 1', [{ label: 'HD', url: 'http://x/2' }]),
  match('c3', 'Canal+ Sport', [{ label: 'HD', url: 'http://x/3' }]),
]

// What the provider adds mid-build-up — the scenario the whole feature exists
// for.
const NEW_PPV = match('ppv1', 'PPV 9 Rosenborg - Molde', [{ label: 'UHD', url: 'http://x/ppv' }])

const EVENT: SportEvent = {
  id: 'evt-1',
  sportKey: 'football',
  sportLabel: 'Football',
  league: 'Eliteserien',
  leagueId: 'no_eliteserien',
  title: 'Rosenborg vs Molde',
  homeTeam: 'Rosenborg',
  awayTeam: 'Molde',
  dateTimeUtc: '2026-08-27T18:00:00Z',
  timeLabel: '20:00',
  isLive: false,
  status: 'scheduled',
}

const XTREAM = { forChannel: () => null, forSource: () => null } as unknown as XtreamCredentialResolver

function rowKeys(matches: ChannelMatch[]): string[] {
  const options = buildEventStreamOptions(matches, new Set<string>(), {
    homeTeam: EVENT.homeTeam,
    awayTeam: EVENT.awayTeam,
    eventTitle: EVENT.title,
    dateTimeUtc: EVENT.dateTimeUtc,
  })
  const { trusted } = partitionStreamOptions(rankEventStreamOptions(options, { favoriteCountries: [], streamType: 'auto' }))
  return trusted.map((o) => o.key)
}

function resolveWith(matches: ChannelMatch[]) {
  matchChannelsForEventMock.mockResolvedValue({ matches, apiHasData: true, apiStations: [] })
}

function Screen({ generation, channels }: { generation: string; channels: Channel[] }) {
  return (
    <EventDetailsScreen
      event={EVENT}
      channels={channels}
      playlistGenerationId={generation}
      xtream={XTREAM}
      identityIndex={null}
      favoriteChannels={new Set<string>()}
      onToggleFavoriteChannels={() => {}}
      onWatch={() => {}}
      onBack={() => {}}
      onBrowseChannels={() => {}}
    />
  )
}

async function settle() {
  for (let i = 0; i < 4; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve()
    })
  }
}

function rowNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.stream-row-name')].map((n) => n.textContent ?? '')
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('a new playlist generation while Match View is open', () => {
  it('discovers a newly added PPV stream without the viewer leaving the screen', async () => {
    resolveWith(BASE)
    const channels = BASE.map((m) => m.channel)
    const { container, rerender } = render(<Screen generation="gen-1" channels={channels} />)
    await settle()
    expect(container.querySelectorAll('.stream-row')).toHaveLength(3)

    // The background sync installs a generation carrying the new PPV feed.
    resolveWith([...BASE, NEW_PPV])
    await act(async () => {
      rerender(<Screen generation="gen-2" channels={[...channels, NEW_PPV.channel]} />)
    })
    await settle()

    expect(container.querySelectorAll('.stream-row')).toHaveLength(4)
    expect(rowNames(container).join(' | ')).toContain('PPV 9')
  })

  it('never flashes back to the loading state while revalidating', async () => {
    resolveWith(BASE)
    const channels = BASE.map((m) => m.channel)
    const { container, rerender } = render(<Screen generation="gen-1" channels={channels} />)
    await settle()
    expect(container.querySelector('.stream-area-loading')).toBeNull()

    // Hold the re-match open so the revalidation window is observable.
    let release!: (value: unknown) => void
    matchChannelsForEventMock.mockReturnValue(new Promise((resolve) => (release = resolve)))
    await act(async () => {
      rerender(<Screen generation="gen-2" channels={channels} />)
    })

    // Mid-revalidation: the previous results are still on screen, and the
    // skeleton is nowhere.
    expect(container.querySelector('.stream-area-loading')).toBeNull()
    expect(container.querySelectorAll('.stream-row')).toHaveLength(3)

    await act(async () => {
      release({ matches: [...BASE, NEW_PPV], apiHasData: true, apiStations: [] })
      await Promise.resolve()
    })
    await settle()
    expect(container.querySelectorAll('.stream-row')).toHaveLength(4)
  })

  it('leaves focus exactly where the viewer put it when their row survives', async () => {
    resolveWith(BASE)
    const channels = BASE.map((m) => m.channel)
    const { rerender } = render(<Screen generation="gen-1" channels={channels} />)
    await settle()

    const thirdRow = rowKeys(BASE)[2]
    await act(async () => {
      await setFocus(thirdRow)
    })
    expect(getCurrentFocusKey()).toBe(thirdRow)

    resolveWith([...BASE, NEW_PPV])
    await act(async () => {
      rerender(<Screen generation="gen-2" channels={[...channels, NEW_PPV.channel]} />)
    })
    await settle()

    // Same row, still focused — no jump back to the top pick even though a
    // new, higher-quality (UHD) stream arrived and the ranking changed.
    expect(getCurrentFocusKey()).toBe(thirdRow)
  })

  it('a NEW `channels` array on its own does not re-match at all', async () => {
    resolveWith(BASE)
    const { rerender } = render(<Screen generation="gen-1" channels={BASE.map((m) => m.channel)} />)
    await settle()
    expect(matchChannelsForEventMock).toHaveBeenCalledTimes(1)

    // Same generation, brand new array instance — which is what a Home score
    // tick or any unrelated App re-render produces.
    await act(async () => {
      rerender(<Screen generation="gen-1" channels={BASE.map((m) => m.channel)} />)
    })
    await settle()
    expect(matchChannelsForEventMock).toHaveBeenCalledTimes(1)
  })

  it('resolves the loading skeleton even when the FIRST results never arrive and a re-run then fails', async () => {
    // The nasty ordering: mount starts a match that never settles, the
    // identity index lands moments later and re-runs it, and THAT run fails.
    // Nothing else is left to finish the screen, so "Finding the best
    // streams…" would sit there forever if the failure were suppressed just
    // because the run was technically a revalidation.
    matchChannelsForEventMock.mockReturnValue(new Promise(() => {}))
    const channels = BASE.map((m) => m.channel)
    const { container, rerender } = render(<Screen generation="gen-1" channels={channels} />)
    await settle()
    expect(container.querySelector('.stream-area-loading')).not.toBeNull()

    matchChannelsForEventMock.mockRejectedValue(new Error('provider unreachable'))
    await act(async () => {
      rerender(<Screen generation="gen-2" channels={channels} />)
    })
    await settle()

    expect(container.querySelector('.stream-area-loading')).toBeNull()
    expect(container.querySelector('.stream-area-empty')).not.toBeNull()
  })

  it('keeps the streams already on screen when a revalidation fails outright', async () => {
    resolveWith(BASE)
    const channels = BASE.map((m) => m.channel)
    const { container, rerender } = render(<Screen generation="gen-1" channels={channels} />)
    await settle()

    matchChannelsForEventMock.mockRejectedValue(new Error('provider unreachable'))
    await act(async () => {
      rerender(<Screen generation="gen-2" channels={channels} />)
    })
    await settle()

    // Real, playable rows beat an empty state produced by one failed poll.
    expect(container.querySelectorAll('.stream-row')).toHaveLength(3)
    expect(container.querySelector('.stream-area-empty')).toBeNull()
  })
})
