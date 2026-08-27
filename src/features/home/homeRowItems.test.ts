import { describe, expect, it } from 'vitest'
import { cardTimeText, eventCardStatus, rowItemsExcludingHero, startingSoonLabel } from './homeRowItems'
import type { SportEvent } from '../../data/sports/types'

function event(overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    id: 'e1',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    league: 'Test League',
    leagueId: 'test',
    title: 'Home vs Away',
    dateTimeUtc: '2026-08-26T19:00:00Z',
    timeLabel: 'Today 21:00',
    isLive: false,
    ...overrides,
  }
}

describe('cardTimeText', () => {
  it('drops the redundant "Today" prefix — every card in the row is today', () => {
    expect(cardTimeText(event({ timeLabel: 'Today 21:00' }))).toBe('21:00')
  })

  it('keeps a weekday prefix, which is the one case the day is NOT obvious', () => {
    expect(cardTimeText(event({ timeLabel: 'Sat 21:00' }))).toBe('Sat 21:00')
  })
})

describe('eventCardStatus', () => {
  it('reports a live card as live, carrying the real match clock', () => {
    expect(eventCardStatus(event({ isLive: true, liveClock: 'HT' }), 'live')).toEqual({ kind: 'live', clock: 'HT' })
  })

  // A heuristically-live event has no real live feed behind it (see
  // SportEvent.isLiveHeuristic) — it must never be shown a clock it doesn't
  // actually have.
  it('never carries a clock for a heuristically-live event', () => {
    expect(eventCardStatus(event({ isLive: true, isLiveHeuristic: true, liveClock: 'HT' }), 'live')).toEqual({
      kind: 'live',
      clock: undefined,
    })
  })

  it('reports a starting-soon card as its own state, with the kickoff time', () => {
    expect(eventCardStatus(event(), 'starting-soon')).toEqual({ kind: 'starting-soon', time: '21:00' })
  })

  // The product rule this file exists to enforce: a match that has not
  // kicked off is never labelled LIVE, however close it is.
  it('never reports a not-yet-started match as live', () => {
    expect(eventCardStatus(event(), 'starting-soon').kind).not.toBe('live')
    expect(eventCardStatus(event(), 'coming-up').kind).not.toBe('live')
  })

  it('reports a later card as a plain kickoff time', () => {
    expect(eventCardStatus(event(), 'coming-up')).toEqual({ kind: 'time', time: '21:00' })
  })
})

describe('startingSoonLabel', () => {
  it('reads as one uppercase badge with the kickoff time', () => {
    expect(startingSoonLabel({ kind: 'starting-soon', time: '21:00' })).toBe('STARTING SOON · 21:00')
  })

  it('degrades to the bare state when an event has no usable time label', () => {
    expect(startingSoonLabel({ kind: 'starting-soon', time: '' })).toBe('STARTING SOON')
  })
})

// Home showed the same fixture twice: once as the full-bleed hero, and again
// as the first or second card in the row directly beneath it — the screen's
// two most prominent slots spent on one match.
describe('rowItemsExcludingHero', () => {
  const item = (id: string, group: 'live' | 'starting-soon' | 'coming-up' = 'live') => ({
    event: event({ id }),
    group,
  })

  it('removes the hero from the row', () => {
    const items = [item('a'), item('b'), item('c')]
    expect(rowItemsExcludingHero(items, event({ id: 'b' })).map((i) => i.event.id)).toEqual(['a', 'c'])
  })

  it('changes nothing else about the order', () => {
    const items = [item('a'), item('b', 'starting-soon'), item('c', 'coming-up')]
    const rows = rowItemsExcludingHero(items, event({ id: 'a' }))
    expect(rows.map((i) => [i.event.id, i.group])).toEqual([
      ['b', 'starting-soon'],
      ['c', 'coming-up'],
    ])
  })

  it('excludes nothing when there is no hero', () => {
    const items = [item('a'), item('b')]
    expect(rowItemsExcludingHero(items, null).map((i) => i.event.id)).toEqual(['a', 'b'])
  })

  it('leaves the row untouched when the hero is not in it at all', () => {
    // Legitimate and common: the hero ranks over the full candidate pool
    // including live matches with no playable stream, which the row filters
    // out (see useHomeFeed).
    const items = [item('a'), item('b')]
    expect(rowItemsExcludingHero(items, event({ id: 'unplayable' })).map((i) => i.event.id)).toEqual(['a', 'b'])
  })

  // Two providers spell the same fixture differently, so a title match would
  // both miss real duplicates and remove genuinely different matches.
  it('matches on id, never on title', () => {
    const items = [
      { event: event({ id: 'a', title: 'Manchester United vs Liverpool' }), group: 'live' as const },
      { event: event({ id: 'b', title: 'Manchester United vs Liverpool' }), group: 'live' as const },
    ]
    expect(rowItemsExcludingHero(items, event({ id: 'a', title: 'Man Utd - Liverpool' })).map((i) => i.event.id)).toEqual(['b'])
  })

  it('does not mutate its input', () => {
    const items = [item('a'), item('b')]
    rowItemsExcludingHero(items, event({ id: 'a' }))
    expect(items).toHaveLength(2)
  })
})
