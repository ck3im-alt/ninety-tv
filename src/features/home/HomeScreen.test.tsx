// @vitest-environment jsdom
//
// Rendering coverage for the 2026-08-26 Home pass: Live Now and Coming Up
// became ONE horizontally scrollable row, and Your Favorite Channels is now
// always present (with a quiet, non-focusable empty state) instead of
// vanishing when the user has no favorites.
//
// Deliberately a rendering test, not a focus test — jsdom reports every
// element as 0x0, so norigin's geometric directional search can't be
// meaningfully exercised in it (same reasoning as
// OnboardingSportsScreen.test.tsx). What matters here is what a user would
// see and in what order, which is exactly what is asserted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { init } from '@noriginmedia/norigin-spatial-navigation'
import type { HomeFeedState } from '../../data/sports/useHomeFeed'
import type { EventTiming, HomeFeedItem } from '../../data/sports/homeRanking'
import type { SportEvent } from '../../data/sports/types'
import type { Channel } from '../../data/channel'
import { NO_XTREAM_CREDENTIALS } from '../../data/playlists/xtreamResolver'

// The only network boundary this screen has of its own: the favorites hook
// asks each favorited channel's Xtream panel what's on right now. Stubbed so
// these tests never touch the network — its real behaviour is a straight
// pass-through of the channels it's given.
const nowPlaying = { current: [] as { channel: Channel; title: string | null }[] }
vi.mock('./useFavoriteChannelsNowPlaying', () => ({
  useFavoriteChannelsNowPlaying: () => nowPlaying.current,
}))

const { HomeScreen } = await import('./HomeScreen')

init({ debug: false, visualDebug: false })
Element.prototype.scrollIntoView = () => {}

function event(id: string, isLive: boolean, timeLabel = 'Today 20:00'): SportEvent {
  return {
    id,
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    league: 'Test League',
    leagueId: 'test',
    title: id,
    homeTeam: `${id} Home`,
    awayTeam: `${id} Away`,
    dateTimeUtc: '2026-08-26T18:00:00Z',
    timeLabel,
    isLive,
  }
}

function channel(id: string, name: string): Channel {
  return { id, name, sources: [{ url: `http://example.test/${id}`, playlistId: 'p1', sourceLabel: 'P1' }] } as unknown as Channel
}

// Home renders `feed.items` — already ranked and grouped by
// data/sports/homeRanking.ts. These tests state the ORDER AND GROUPS
// directly rather than re-deriving them, which is what keeps this a
// rendering test: what the ranking decides is covered by homeRanking's own
// (pure, clock-injected) tests.
function feedState(items: HomeFeedItem[], hero: SportEvent | null = null, heroTiming: EventTiming = 'unknown'): HomeFeedState {
  return {
    status: 'ready',
    feed: {
      hero,
      heroIsWatchableNow: heroTiming === 'live' || heroTiming === 'starting-soon',
      heroTiming,
      items,
      liveNow: items.filter((item) => item.group === 'live').map((item) => item.event),
      tonight: items.filter((item) => item.group !== 'live').map((item) => item.event),
    },
    eventsById: new Map(),
    refresh: () => {},
  }
}

const live = (event: SportEvent): HomeFeedItem => ({ event, group: 'live' })
const soon = (event: SportEvent): HomeFeedItem => ({ event, group: 'starting-soon' })
const later = (event: SportEvent): HomeFeedItem => ({ event, group: 'coming-up' })

function renderHome(state: HomeFeedState, favoriteChannels: Channel[] = []) {
  return render(
    <HomeScreen
      feedState={state}
      xtream={NO_XTREAM_CREDENTIALS}
      favoriteChannels={favoriteChannels}
      onSelectEvent={() => {}}
      onWatchChannel={() => {}}
    />,
  )
}

// Section titles in document order — the row layout of the page.
const sectionTitles = () => [...document.querySelectorAll('.row-title')].map((el) => el.textContent)
// The cards inside a given section, in order, tagged by which card type
// rendered them (a LIVE badge is what distinguishes a live card).
const cardsIn = (title: string) => {
  const section = [...document.querySelectorAll('.row')].find((row) => row.querySelector('.row-title')?.textContent === title)
  return [...(section?.querySelectorAll('.event-card') ?? [])].map((card) => ({
    live: card.querySelector('.live-badge') != null,
    text: card.textContent ?? '',
  }))
}

beforeEach(() => {
  nowPlaying.current = []
})

afterEach(() => {
  cleanup()
})

describe('Home — combined "Live now & coming up" row', () => {
  it('renders ONE row for both, not separate Live Now and Coming Up sections', () => {
    renderHome(feedState([live(event('live-1', true)), later(event('next-1', false))]))
    expect(sectionTitles()).toEqual(['Live now & coming up', 'Your Favorite Channels'])
  })

  it('orders every live event before every upcoming one, in one row', () => {
    renderHome(feedState([live(event('live-1', true)), live(event('live-2', true)), later(event('next-1', false)), later(event('next-2', false))]))
    const cards = cardsIn('Live now & coming up')
    expect(cards.map((c) => c.live)).toEqual([true, true, false, false])
    expect(cards[0].text).toContain('live-1 Home')
    expect(cards[2].text).toContain('next-1 Home')
  })

  it('renders live cards normally when nothing is upcoming', () => {
    renderHome(feedState([live(event('live-1', true))]))
    expect(cardsIn('Live now & coming up').map((c) => c.live)).toEqual([true])
  })

  it('renders upcoming cards normally when nothing is live', () => {
    renderHome(feedState([later(event('next-1', false))]))
    expect(cardsIn('Live now & coming up').map((c) => c.live)).toEqual([false])
  })

  it('shows ONE restrained empty state when both are empty, not two', () => {
    renderHome(feedState([]))
    expect(cardsIn('Live now & coming up')).toHaveLength(0)
    expect(screen.getByText('Nothing live or coming up right now.')).toBeTruthy()
  })
})

// The 2026-08-26 personalization pass added a THIRD card state between LIVE
// and a plain kickoff time. The product rule it enforces: a match that has
// not kicked off is never labelled LIVE, however close it is.
describe('Home — the STARTING SOON state', () => {
  const badges = () =>
    [...document.querySelectorAll('.event-card')].map(
      (card) => card.querySelector('.live-badge, .starting-soon-badge, .event-card-time')?.className ?? '',
    )

  it('labels a starting-soon card with its own badge and kickoff time', () => {
    renderHome(feedState([soon(event('next-1', false, 'Today 21:00'))]))
    expect(screen.getByText('STARTING SOON · 21:00')).toBeTruthy()
  })

  it('never gives a starting-soon card the LIVE treatment', () => {
    renderHome(feedState([soon(event('next-1', false))]))
    expect(document.querySelector('.live-badge')).toBeNull()
    expect(screen.queryByText(/^LIVE/)).toBeNull()
  })

  it('renders all three states distinctly in one row', () => {
    renderHome(
      feedState([live(event('l', true)), soon(event('s', false, 'Today 21:00')), later(event('c', false, 'Today 22:30'))]),
    )
    expect(badges()).toEqual(['live-badge', 'starting-soon-badge', 'event-card-time'])
  })

  it('shows a plain kickoff time for a later card, with no badge', () => {
    renderHome(feedState([later(event('c', false, 'Today 22:30'))]))
    expect(screen.getByText('22:30')).toBeTruthy()
    expect(document.querySelector('.starting-soon-badge')).toBeNull()
  })
})

describe('Home — hero state', () => {
  it('offers Watch Now for a hero that is starting soon, badged as such rather than as live', () => {
    const hero = event('hero', false, 'Today 21:00')
    renderHome(feedState([soon(hero)], hero, 'starting-soon'))
    expect(document.querySelector('.hero-starting-soon-badge')?.textContent).toBe('STARTING SOON · 21:00')
    expect(document.querySelector('.hero-live-badge')).toBeNull()
    expect(screen.getByText(/Watch Now/)).toBeTruthy()
  })

  // "Watch Now" must never lead nowhere — see selectHero's playability
  // preference in homeRanking.ts.
  it('falls back to Event Preview when the hero is not actually watchable', () => {
    const hero = event('hero', false, 'Today 23:30')
    renderHome(feedState([later(hero)], hero, 'upcoming'))
    expect(screen.getByText('Event Preview')).toBeTruthy()
    expect(screen.queryByText(/Watch Now/)).toBeNull()
    expect(document.querySelector('.hero-starting-soon-badge')).toBeNull()
  })
})

describe('Home — Your Favorite Channels', () => {
  it('is always rendered, directly beneath the combined row, even with no favorites', () => {
    renderHome(feedState([live(event('live-1', true))]))
    expect(sectionTitles()).toEqual(['Live now & coming up', 'Your Favorite Channels'])
  })

  it('shows the quiet empty state when the user has no favorite channels', () => {
    renderHome(feedState([]))
    expect(screen.getByText('Your favorite channels will appear here.')).toBeTruthy()
  })

  // The empty state must never become something the remote can land on with
  // nothing to do — no card, no button, no focusable wrapper.
  it('renders the empty state as plain text, with no focus target of its own', () => {
    renderHome(feedState([]))
    const section = [...document.querySelectorAll('.row')].find((row) => row.querySelector('.row-title')?.textContent === 'Your Favorite Channels')!
    expect(section.querySelectorAll('.event-card')).toHaveLength(0)
    expect(section.querySelectorAll('button')).toHaveLength(0)
  })

  it('renders real favorite channels as cards with their EPG subtitle', () => {
    nowPlaying.current = [
      { channel: channel('c1', 'TV 2 Sport'), title: 'Premier League: Arsenal v Liverpool' },
      { channel: channel('c2', 'Viasport 1'), title: null },
    ]
    renderHome(feedState([]), [channel('c1', 'TV 2 Sport'), channel('c2', 'Viasport 1')])
    const cards = cardsIn('Your Favorite Channels')
    expect(cards).toHaveLength(2)
    expect(cards[0].text).toContain('TV 2 Sport')
    expect(cards[0].text).toContain('Premier League: Arsenal v Liverpool')
    // No programme info is stated honestly, never guessed.
    expect(cards[1].text).toContain('No programme info available')
    expect(screen.queryByText('Your favorite channels will appear here.')).toBeNull()
  })
})
