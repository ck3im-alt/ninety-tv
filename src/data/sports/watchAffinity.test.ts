import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeLocalStorage } from '../../core/storage/testFakeLocalStorage'
import { clearWatchAffinity, loadWatchAffinity, recordEventOpened, recordEventWatched } from './watchAffinity'
import type { SportEvent } from './types'

const NOW = Date.parse('2026-08-26T20:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function event(overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    id: 'e1',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    league: 'Premier League',
    leagueId: 'football_premier_league',
    title: 'Home vs Away',
    homeTeamId: 'team_home',
    awayTeamId: 'team_away',
    dateTimeUtc: '2026-08-26T20:00:00Z',
    timeLabel: '',
    isLive: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
})

describe('recording signals', () => {
  it('records nothing for a viewer who has watched nothing', () => {
    const snapshot = loadWatchAffinity(NOW)
    expect(snapshot.teams.size).toBe(0)
    expect(snapshot.competitions.size).toBe(0)
    expect(snapshot.continuityEventId).toBeNull()
  })

  it('records both sides and the competition when an event is opened', () => {
    recordEventOpened(event(), NOW)
    const snapshot = loadWatchAffinity(NOW)
    expect(snapshot.teams.get('team_home')).toBeGreaterThan(0)
    expect(snapshot.teams.get('team_away')).toBeGreaterThan(0)
    expect(snapshot.competitions.get('football_premier_league')).toBeGreaterThan(0)
  })

  it('weighs actually watching an event above merely opening it', () => {
    recordEventOpened(event({ homeTeamId: 'opened', awayTeamId: undefined }), NOW)
    recordEventWatched(event({ id: 'e2', homeTeamId: 'watched', awayTeamId: undefined }), NOW)
    const snapshot = loadWatchAffinity(NOW)
    expect(snapshot.teams.get('watched')!).toBeGreaterThan(snapshot.teams.get('opened')!)
  })

  it('accumulates repeat viewing, with diminishing returns and never reaching 1', () => {
    recordEventWatched(event(), NOW)
    const once = loadWatchAffinity(NOW).teams.get('team_home')!
    recordEventWatched(event(), NOW)
    const twice = loadWatchAffinity(NOW).teams.get('team_home')!
    expect(twice).toBeGreaterThan(once)
    expect(twice - once).toBeLessThan(once)
    expect(twice).toBeLessThan(1)
  })

  // An event from a backend that doesn't send team ids yet still says
  // something about which competition the viewer cares about.
  it('records the competition even when the payload carries no team ids', () => {
    recordEventWatched(event({ homeTeamId: undefined, awayTeamId: undefined }), NOW)
    const snapshot = loadWatchAffinity(NOW)
    expect(snapshot.teams.size).toBe(0)
    expect(snapshot.competitions.get('football_premier_league')).toBeGreaterThan(0)
  })

  // The very first write used to mutate a shared module-level constant.
  it('does not leak state between reads', () => {
    expect(loadWatchAffinity(NOW).teams.size).toBe(0)
    recordEventWatched(event(), NOW)
    clearWatchAffinity()
    expect(loadWatchAffinity(NOW).teams.size).toBe(0)
  })
})

describe('decay', () => {
  it('halves a signal after the half-life', () => {
    recordEventWatched(event(), NOW)
    const fresh = loadWatchAffinity(NOW).teams.get('team_home')!
    const aged = loadWatchAffinity(NOW + 14 * DAY).teams.get('team_home')
    expect(aged).toBeDefined()
    expect(aged!).toBeLessThan(fresh)
  })

  it('forgets a signal entirely once it decays into noise', () => {
    recordEventOpened(event(), NOW)
    expect(loadWatchAffinity(NOW + 365 * DAY).teams.size).toBe(0)
  })

  // Two signals a month apart must not sum as if they were simultaneous.
  it('applies decay when folding a new signal into an old one', () => {
    recordEventWatched(event(), NOW)
    recordEventWatched(event(), NOW + 60 * DAY)
    const afterGap = loadWatchAffinity(NOW + 60 * DAY).teams.get('team_home')!

    clearWatchAffinity()
    recordEventWatched(event(), NOW + 60 * DAY)
    recordEventWatched(event(), NOW + 60 * DAY)
    const backToBack = loadWatchAffinity(NOW + 60 * DAY).teams.get('team_home')!

    expect(afterGap).toBeLessThan(backToBack)
  })
})

describe('continuity — "you were just watching this"', () => {
  it('reports the event a stream was started for, within the window', () => {
    recordEventWatched(event({ id: 'live-match' }), NOW)
    expect(loadWatchAffinity(NOW + 5 * 60_000).continuityEventId).toBe('live-match')
  })

  it('stops reporting it once the window has passed', () => {
    recordEventWatched(event({ id: 'live-match' }), NOW)
    expect(loadWatchAffinity(NOW + 60 * 60_000).continuityEventId).toBeNull()
  })

  // Opening an event's details is not "watching" it.
  it('is not armed by merely opening an event', () => {
    recordEventOpened(event({ id: 'browsed' }), NOW)
    expect(loadWatchAffinity(NOW).continuityEventId).toBeNull()
  })

  it('tracks only the most recent watch', () => {
    recordEventWatched(event({ id: 'first' }), NOW)
    recordEventWatched(event({ id: 'second' }), NOW + 60_000)
    expect(loadWatchAffinity(NOW + 2 * 60_000).continuityEventId).toBe('second')
  })
})

describe('resilience', () => {
  it('ignores a stored payload from an unrecognised schema version', () => {
    localStorage.setItem('ninety.watchAffinity', JSON.stringify({ version: 99, teams: { a: { strength: 5, lastAt: NOW } } }))
    expect(loadWatchAffinity(NOW).teams.size).toBe(0)
  })

  it('ignores malformed entries rather than letting them reach scoring', () => {
    localStorage.setItem(
      'ninety.watchAffinity',
      JSON.stringify({
        version: 1,
        teams: { good: { strength: 5, lastAt: NOW }, bad: 'nonsense', worse: { strength: 'x', lastAt: NOW } },
        competitions: {},
      }),
    )
    const snapshot = loadWatchAffinity(NOW)
    expect([...snapshot.teams.keys()]).toEqual(['good'])
  })

  it('survives unparseable storage entirely', () => {
    localStorage.setItem('ninety.watchAffinity', '{{{not json')
    expect(() => loadWatchAffinity(NOW)).not.toThrow()
    expect(loadWatchAffinity(NOW).teams.size).toBe(0)
  })

  it('produces only finite 0..1 values', () => {
    for (let i = 0; i < 50; i++) recordEventWatched(event(), NOW + i * 60_000)
    const value = loadWatchAffinity(NOW + 50 * 60_000).teams.get('team_home')!
    expect(Number.isFinite(value)).toBe(true)
    expect(value).toBeGreaterThan(0)
    expect(value).toBeLessThan(1)
  })
})
