import { describe, expect, it } from 'vitest'
import { cardTimeText, eventCardStatus, startingSoonLabel } from './homeRowItems'
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
