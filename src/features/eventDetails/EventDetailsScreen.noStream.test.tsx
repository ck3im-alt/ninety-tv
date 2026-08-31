// @vitest-environment jsdom
//
// MATCH VIEW WHEN THERE IS NOTHING TO PLAY.
//
// Six situations reach this screen and used to share one line of grey text
// ("No TV channel has been reported for this event yet."), which was
// actively wrong in two of them. Each is asserted here, along with the rule
// that matters most: an AMBIGUOUS resolver result is INFORMATION and must
// never become a playable stream.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { destroy, getCurrentFocusKey, init, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { EventDetailsScreen } from './EventDetailsScreen'
import type { BroadcastStationInfo, ChannelMatch } from '../../data/sports/channelMatch'
import type { BroadcastAvailability } from '../../data/sports/broadcastAvailability'
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

const EVENT: SportEvent = {
  id: 'evt-1',
  sportKey: 'football',
  sportLabel: 'Football',
  league: 'Premier League',
  leagueId: 'football_premier_league',
  title: 'Arsenal vs Chelsea',
  homeTeam: 'Arsenal',
  awayTeam: 'Chelsea',
  dateTimeUtc: '2026-08-27T18:00:00Z',
  timeLabel: '20:00',
  isLive: false,
  status: 'scheduled',
}

const XTREAM = { forChannel: () => null, forSource: () => null } as unknown as XtreamCredentialResolver

const station = (over: Partial<BroadcastStationInfo> = {}): BroadcastStationInfo => ({
  name: 'TNT Sports 1',
  country: 'GB',
  logicalChannelId: 'gb_tnt_sports_1',
  ...over,
})

function trustedMatch(id: string, name: string, sources: ChannelSource[]): ChannelMatch {
  const channel: Channel = { id, name, groupTitle: 'GB| Sport', sources }
  return {
    channel,
    source: 'ninety',
    label: name,
    isExactMatch: true,
    identityClassification: 'CONFIRMED',
    logicalChannelId: `logical_${id}`,
  }
}

function Screen({
  event = EVENT,
  resyncableCount = 1,
  lastRefreshedAt = null,
  refresh = async () => {},
  onBrowseChannels = () => {},
  generation = 'gen-1',
}: {
  event?: SportEvent
  resyncableCount?: number
  lastRefreshedAt?: number | null
  refresh?: () => Promise<void>
  onBrowseChannels?: () => void
  generation?: string
}) {
  return (
    <EventDetailsScreen
      event={event}
      channels={[]}
      playlistGenerationId={generation}
      xtream={XTREAM}
      identityIndex={null}
      favoriteChannels={new Set()}
      onToggleFavoriteChannels={() => {}}
      onWatch={() => {}}
      onBack={() => {}}
      onBrowseChannels={onBrowseChannels}
      playlistRefresh={{ resyncableCount, lastRefreshedAt, refresh }}
    />
  )
}

const resolveWith = (matches: ChannelMatch[], apiStations: BroadcastStationInfo[] = []) =>
  matchChannelsForEventMock.mockResolvedValue({ matches, apiHasData: apiStations.length > 0, apiStations })

const settle = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const text = () => document.body.textContent ?? ''
const actionLabels = () => [...document.querySelectorAll('.no-stream-action')].map((b) => b.textContent)

const eventWith = (over: Partial<SportEvent>): SportEvent => ({ ...EVENT, ...over })
const withAvailability = (availability: BroadcastAvailability, reason?: string) =>
  eventWith({ broadcastAvailability: availability, broadcastAvailabilityReason: reason })

afterEach(() => {
  cleanup()
  destroy()
  init({ debug: false, visualDebug: false })
  matchChannelsForEventMock.mockReset()
})
beforeEach(() => {
  init({ debug: false, visualDebug: false })
})

// ---------------------------------------------------------------- STATE 1
describe('1. a trusted match exists', () => {
  it('shows the normal stream UI and no empty state at all', async () => {
    resolveWith([trustedMatch('c1', 'TNT Sports 1', [{ label: 'HD', url: 'http://x/1' }])])
    const { container } = render(<Screen />)
    await settle()

    expect(container.querySelectorAll('.stream-row').length).toBeGreaterThan(0)
    expect(container.querySelector('.no-stream')).toBeNull()
  })
})

// ---------------------------------------------------------------- STATE 2
describe('2. Ninety knows the broadcaster but nothing matched the playlist', () => {
  it('says so, rather than claiming nothing has been reported', async () => {
    resolveWith([], [station({ identityClassification: 'NONE' })])
    const { container } = render(<Screen />)
    await settle()

    expect(container.querySelector('.no-stream-known-broadcasters')).toBeTruthy()
    expect(text()).toContain('No matching channel found')
    expect(text()).toContain("couldn't confidently match those channels to your playlist")
    // The old copy claimed the opposite of what is true here.
    expect(text()).not.toContain('No TV channel has been reported')
  })

  it('lists the canonical broadcasters under "Available on TV"', async () => {
    resolveWith(
      [],
      [station(), station({ name: 'Sky Sport Bundesliga', country: 'DE', logicalChannelId: 'de_sky_bundesliga' })],
    )
    const { container } = render(<Screen />)
    await settle()

    expect(text()).toContain('Available on TV')
    const names = [...container.querySelectorAll('.no-stream-station-name')].map((n) => n.textContent)
    expect(names).toEqual(['TNT Sports 1', 'Sky Sport Bundesliga'])
  })

  it('shows each station its real country, with the existing flag treatment', async () => {
    resolveWith([], [station()])
    const { container } = render(<Screen />)
    await settle()

    expect(container.querySelector('.no-stream-station-country')?.textContent).toContain('United Kingdom')
    expect(container.querySelector('.no-stream-station-flag')?.getAttribute('src')).toContain('/GB.svg')
  })

  it('invents nothing for a station with no country', async () => {
    resolveWith([], [station({ country: null })])
    const { container } = render(<Screen />)
    await settle()
    expect(container.querySelector('.no-stream-station-country')).toBeNull()
  })
})

// ---------------------------------------------------------------- STATE 3
describe('3. ambiguous playlist names stay information, never streams', () => {
  const AMBIGUOUS = station({
    identityClassification: 'AMBIGUOUS',
    ambiguousPlaylistChannelNames: ['TNT SPORTS 1 HD', 'TNT SPORT ONE'],
  })

  it('offers them as possible matches, worded as a possibility', async () => {
    resolveWith([], [AMBIGUOUS])
    const { container } = render(<Screen />)
    await settle()

    const hint = container.querySelector('.no-stream-station-hint')?.textContent ?? ''
    expect(hint).toContain('Possible matches in your playlist')
    expect(hint).toContain('TNT SPORTS 1 HD')
    expect(hint).toContain('TNT SPORT ONE')
  })

  // THE SAFETY RULE. An AMBIGUOUS result means Ninety found several playlist
  // channels that could be this broadcaster and could not choose. Promoting
  // one to a Watch button would put the wrong channel behind it.
  it('never turns them into a playable stream row', async () => {
    resolveWith([], [AMBIGUOUS])
    const { container } = render(<Screen />)
    await settle()

    expect(container.querySelectorAll('.stream-row')).toHaveLength(0)
    expect(container.querySelector('.no-stream')).toBeTruthy()
  })

  it('never marks them recommended or a top pick', async () => {
    resolveWith([], [AMBIGUOUS])
    const { container } = render(<Screen />)
    await settle()

    expect(container.querySelector('.top-pick')).toBeNull()
    expect(text()).not.toContain('Recommended')
    expect(text()).not.toContain('Top pick')
  })

  // The hints are prose, not controls: nothing here may become a focus stop
  // that does nothing when pressed.
  it('registers no focusable for a possible match', async () => {
    resolveWith([], [AMBIGUOUS])
    const { container } = render(<Screen />)
    await settle()

    expect(container.querySelectorAll('.no-stream-station button')).toHaveLength(0)
  })

  it('shows no hint for a station Ninety simply could not find', async () => {
    resolveWith([], [station({ identityClassification: 'NONE' })])
    const { container } = render(<Screen />)
    await settle()
    expect(container.querySelector('.no-stream-station-hint')).toBeNull()
  })
})

// ---------------------------------------------------------------- STATE 4
describe('4. no broadcaster reported at all', () => {
  it('says the channel was not found, and that it may still appear', async () => {
    resolveWith([], [])
    const { container } = render(<Screen />)
    await settle()

    expect(container.querySelector('.no-stream-unknown')).toBeTruthy()
    expect(text()).toContain('No TV channel found for this event')
    expect(text()).toContain('Channels often appear closer to the event')
  })

  it('offers both actions, balanced', async () => {
    resolveWith([], [])
    render(<Screen />)
    await settle()
    expect(actionLabels()).toEqual(['Refresh playlist', 'Check channels manually'])
  })

  it('pluralises the refresh for several connected playlists', async () => {
    resolveWith([], [])
    render(<Screen resyncableCount={3} />)
    await settle()
    expect(actionLabels()).toEqual(['Refresh playlists', 'Check channels manually'])
  })

  it('hides the refresh entirely when there is nothing that can be refreshed', async () => {
    resolveWith([], [])
    render(<Screen resyncableCount={0} />)
    await settle()
    expect(actionLabels()).toEqual(['Check channels manually'])
  })

  // A first pass carried three lines of possible causes under the actions.
  // Reviewed on the TV they read as a wall of hedging under a screen that
  // had already said the useful part, and none of them changed what the
  // viewer would do next.
  it('carries no "why this happens" explainer', async () => {
    resolveWith([], [])
    const { container } = render(<Screen />)
    await settle()

    expect(container.querySelector('.no-stream-reasons')).toBeNull()
    expect(text()).not.toContain('may not be published yet')
  })

  it('lands focus on an action rather than on Back', async () => {
    resolveWith([], [])
    render(<Screen />)
    await settle()
    await act(async () => {
      await setFocus('event-details-screen')
    })
    expect(getCurrentFocusKey()).toBe('event-details-refresh-playlist')
  })

  it('lands on manual browsing when refreshing is not on offer', async () => {
    resolveWith([], [])
    render(<Screen resyncableCount={0} />)
    await settle()
    await act(async () => {
      await setFocus('event-details-screen')
    })
    expect(getCurrentFocusKey()).toBe('event-details-browse-channels')
  })

  // THE REAL ARRIVAL, which the two tests above deliberately do not model.
  // App focuses this screen the instant `screen` changes — while matching is
  // still in flight, when Back is genuinely the only resolvable target — and
  // preferredChildFocusKey never retroactively moves focus that has already
  // settled. So the container's preference cannot land the viewer on an
  // action on its own; the screen's own post-resolution effect has to, which
  // is what these two pin.
  const renderWhileMatching = (element: React.ReactElement) => {
    let resolveMatch: (result: { matches: ChannelMatch[]; apiHasData: boolean; apiStations: BroadcastStationInfo[] }) => void =
      () => {}
    matchChannelsForEventMock.mockReturnValue(
      new Promise((resolve) => {
        resolveMatch = resolve
      }),
    )
    render(element)
    return async () => {
      await act(async () => {
        resolveMatch({ matches: [], apiHasData: false, apiStations: [] })
      })
      await settle()
    }
  }

  it('moves focus off Back when the no-stream result arrives after the screen was focused', async () => {
    const finishMatching = renderWhileMatching(<Screen />)
    await act(async () => {
      await setFocus('event-details-screen')
    })
    // Exactly where App leaves it: nothing but Back exists yet.
    expect(getCurrentFocusKey()).toBe('event-details-back')

    await finishMatching()
    expect(getCurrentFocusKey()).toBe('event-details-refresh-playlist')
  })

  it('moves focus to manual browsing instead when refreshing is not on offer', async () => {
    const finishMatching = renderWhileMatching(<Screen resyncableCount={0} />)
    await act(async () => {
      await setFocus('event-details-screen')
    })
    expect(getCurrentFocusKey()).toBe('event-details-back')

    await finishMatching()
    expect(getCurrentFocusKey()).toBe('event-details-browse-channels')
  })
})

// ---------------------------------------------------------------- STATE 5
describe('5. the backend says it is not expected on TV', () => {
  it('says so truthfully instead of promising channels will appear', async () => {
    resolveWith([], [])
    const { container } = render(<Screen event={withAvailability('CONFIRMED_NOT_BROADCAST')} />)
    await settle()

    expect(container.querySelector('.no-stream-not-broadcast')).toBeTruthy()
    expect(text()).toContain('Not expected on TV')
    expect(text()).not.toContain('Channels often appear closer to the event')
  })

  // Refreshing cannot conjure a broadcast that is not happening.
  it('does not offer to refresh the playlist', async () => {
    resolveWith([], [])
    render(<Screen event={withAvailability('LIKELY_NOT_BROADCAST')} />)
    await settle()
    expect(actionLabels()).toEqual(['Check channels manually'])
  })

  it('keeps manual browsing available all the same', async () => {
    resolveWith([], [])
    const onBrowseChannels = vi.fn()
    const { container } = render(
      <Screen event={withAvailability('CONFIRMED_NOT_BROADCAST')} onBrowseChannels={onBrowseChannels} />,
    )
    await settle()

    await act(async () => {
      ;(container.querySelector('.no-stream-action') as HTMLElement).click()
    })
    expect(onBrowseChannels).toHaveBeenCalledTimes(1)
  })

  it('uses the backend reason only when it reads as product copy', async () => {
    resolveWith([], [])
    const { unmount } = render(
      <Screen event={withAvailability('CONFIRMED_NOT_BROADCAST', 'No broadcaster holds rights in your region.')} />,
    )
    await settle()
    expect(text()).toContain('No broadcaster holds rights in your region.')
    unmount()

    render(<Screen event={withAvailability('CONFIRMED_NOT_BROADCAST', 'COMPETITION_POLICY_NO_COVERAGE')} />)
    await settle()
    expect(text()).not.toContain('COMPETITION_POLICY_NO_COVERAGE')
    expect(text()).toContain('Ninety has no TV coverage on record')
  })

  // An empty broadcasts array says NOTHING about whether a fixture is
  // televised — the array is narrowed to the viewer's markets and EPG
  // coverage is incomplete everywhere.
  it('never reaches this state from missing data alone', async () => {
    resolveWith([], [])
    const { container } = render(<Screen event={withAvailability('CONFIRMED_BROADCAST')} />)
    await settle()
    expect(container.querySelector('.no-stream-not-broadcast')).toBeNull()
    expect(container.querySelector('.no-stream-unknown')).toBeTruthy()
  })
})

// ---------------------------------------------------------------- STATE 6
describe('6. refreshing the playlist re-evaluates matching', () => {
  it('uses the playlist library rather than any refresh of its own', async () => {
    resolveWith([], [])
    const refresh = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<Screen refresh={refresh} />)
    await settle()

    await act(async () => {
      ;(container.querySelector('.no-stream-action.primary') as HTMLElement).click()
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shows a busy state and refuses a second activation while it runs', async () => {
    resolveWith([], [])
    let release = () => {}
    const refresh = vi.fn().mockImplementation(() => new Promise<void>((r) => (release = r)))
    const { container } = render(<Screen refresh={refresh} />)
    await settle()

    const button = () => container.querySelector('.no-stream-action.primary') as HTMLElement
    await act(async () => button().click())
    expect(button().textContent).toBe('Refreshing…')

    await act(async () => button().click())
    await act(async () => button().click())
    expect(refresh).toHaveBeenCalledTimes(1)

    await act(async () => {
      release()
      await Promise.resolve()
    })
    expect(button().textContent).toBe('Refresh playlist')
  })

  // The viewer stays where they are, and the control they are standing on
  // stays in the spatial-nav tree — a button that vanishes under a finger is
  // the failure this codebase keeps having to fix.
  it('keeps the viewer on Event Details with focus intact', async () => {
    resolveWith([], [])
    let release = () => {}
    const { container } = render(<Screen refresh={() => new Promise<void>((r) => (release = r))} />)
    await settle()
    await act(async () => {
      await setFocus('event-details-refresh-playlist')
    })

    await act(async () => (container.querySelector('.no-stream-action.primary') as HTMLElement).click())
    expect(getCurrentFocusKey()).toBe('event-details-refresh-playlist')
    expect(container.querySelector('.event-details')).toBeTruthy()

    await act(async () => {
      release()
      await Promise.resolve()
    })
    expect(getCurrentFocusKey()).toBe('event-details-refresh-playlist')
  })

  // The new generation is what re-runs matching (the screen is keyed on it,
  // exactly as a background refresh is) — nothing here re-matches by hand.
  it('replaces the empty state with real streams once the channel turns up', async () => {
    resolveWith([], [])
    const { container, rerender } = render(<Screen generation="gen-1" />)
    await settle()
    expect(container.querySelector('.no-stream')).toBeTruthy()

    resolveWith([trustedMatch('c1', 'TNT Sports 1', [{ label: 'HD', url: 'http://x/1' }])])
    await act(async () => {
      rerender(<Screen generation="gen-2" />)
    })
    await settle()

    expect(container.querySelector('.no-stream')).toBeNull()
    expect(container.querySelectorAll('.stream-row').length).toBeGreaterThan(0)
  })

  it('stays in the explanatory state when the refresh finds nothing new', async () => {
    resolveWith([], [station({ identityClassification: 'NONE' })])
    const { container, rerender } = render(<Screen generation="gen-1" />)
    await settle()

    await act(async () => {
      rerender(<Screen generation="gen-2" />)
    })
    await settle()

    expect(container.querySelector('.no-stream-known-broadcasters')).toBeTruthy()
    expect(container.querySelectorAll('.stream-row')).toHaveLength(0)
  })

  it('does not throw the viewer out when the refresh fails', async () => {
    resolveWith([], [])
    const { container } = render(<Screen refresh={() => Promise.reject(new Error('provider down'))} />)
    await settle()

    await act(async () => {
      ;(container.querySelector('.no-stream-action.primary') as HTMLElement).click()
      await Promise.resolve()
    })
    await settle()

    expect(container.querySelector('.event-details')).toBeTruthy()
    expect(container.querySelector('.no-stream')).toBeTruthy()
    // And the action is usable again rather than stuck busy.
    expect((container.querySelector('.no-stream-action.primary') as HTMLElement).textContent).toBe('Refresh playlist')
  })
})

// PRESSING REFRESH HAS TO LOOK LIKE IT DID SOMETHING. The common outcome is
// that nothing on screen changes — the channel still is not there — so
// without a timestamp the viewer cannot tell a refresh that ran from one
// that silently did nothing, and presses again.
describe('the last-refreshed receipt', () => {
  const refreshedLine = () => document.querySelector('.no-stream-refreshed')?.textContent

  it('sits under the refresh button', async () => {
    resolveWith([], [])
    const { container } = render(<Screen lastRefreshedAt={Date.now() - 5 * 60_000} />)
    await settle()

    const group = container.querySelector('.no-stream-action-group')
    expect(group?.querySelector('.no-stream-action')).toBeTruthy()
    expect(group?.querySelector('.no-stream-refreshed')).toBeTruthy()
  })

  it('says "Refreshed" plus when, in Ninety\'s 24-hour clock', async () => {
    resolveWith([], [])
    const at = new Date()
    at.setHours(9, 5, 0, 0)
    render(<Screen lastRefreshedAt={at.getTime()} />)
    await settle()
    expect(refreshedLine()).toBe('Refreshed 09:05')
  })

  it('reads "Refreshed just now" straight after a refresh lands', async () => {
    resolveWith([], [])
    const { rerender } = render(<Screen lastRefreshedAt={Date.now() - 60 * 60_000} />)
    await settle()
    expect(refreshedLine()).not.toContain('just now')

    // What the playlist library does on a successful sync: a new
    // lastSyncedAt reaches the screen as a new prop.
    await act(async () => {
      rerender(<Screen lastRefreshedAt={Date.now()} />)
    })
    expect(refreshedLine()).toBe('Refreshed just now')
  })

  it('says so plainly when nothing has ever been refreshed', async () => {
    resolveWith([], [])
    render(<Screen lastRefreshedAt={null} />)
    await settle()
    expect(refreshedLine()).toBe('Never refreshed')
  })

  // A failed sync leaves lastSyncedAt untouched, so the line must keep
  // showing the older time rather than claiming a success that never
  // happened.
  it('is absent when there is nothing to refresh at all', async () => {
    resolveWith([], [])
    render(<Screen resyncableCount={0} />)
    await settle()
    expect(refreshedLine()).toBeUndefined()
  })
})

describe('checking channels manually', () => {
  it('hands off to the existing Channels browser', async () => {
    resolveWith([], [])
    const onBrowseChannels = vi.fn()
    const { container } = render(<Screen onBrowseChannels={onBrowseChannels} />)
    await settle()

    const manual = [...container.querySelectorAll('.no-stream-action')].find((b) => b.textContent === 'Check channels manually')
    await act(async () => (manual as HTMLElement).click())
    expect(onBrowseChannels).toHaveBeenCalledTimes(1)
  })
})
