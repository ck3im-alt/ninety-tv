import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadFootballCompetitions, __resetFootballCompetitionsCacheForTests } from './competitionsCatalog'
import type { NinetyCompetition } from './ninetyApiClient'

const getCompetitions = vi.fn()
vi.mock('./ninetyApiClient', () => ({
  getCompetitions: (...args: unknown[]) => getCompetitions(...args),
}))

function competition(overrides: Partial<NinetyCompetition> = {}): NinetyCompetition {
  return {
    id: 'football_premier_league',
    name: 'Premier League',
    country_code: 'GB',
    region: 'England',
    type: 'league',
    tier: 1,
    badge_url: 'https://footballdata.io/img/league/england-premier-league.png',
    footballdata_league_id: 15,
    ...overrides,
  }
}

beforeEach(() => {
  __resetFootballCompetitionsCacheForTests()
  getCompetitions.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('loadFootballCompetitions', () => {
  it('converts a NinetyCompetition into a football LeagueDef', async () => {
    getCompetitions.mockResolvedValue({ competitions: [competition()] })
    const leagues = await loadFootballCompetitions()
    expect(leagues).toEqual([
      {
        id: 'football_premier_league',
        sportKey: 'football',
        sportLabel: 'FOOTBALL',
        tsdbSport: 'Soccer',
        name: 'Premier League',
        region: 'England',
        countryCode: 'GB',
        tier: 1,
        badge: 'https://footballdata.io/img/league/england-premier-league.png',
        ninetyCompetitionId: 'football_premier_league',
      },
    ])
  })

  it('caches the result -- a second call does not refetch', async () => {
    getCompetitions.mockResolvedValue({ competitions: [competition()] })
    await loadFootballCompetitions()
    await loadFootballCompetitions()
    expect(getCompetitions).toHaveBeenCalledTimes(1)
  })

  it('de-duplicates concurrent callers into a single in-flight request', async () => {
    let resolveFetch: (v: { competitions: NinetyCompetition[] }) => void
    getCompetitions.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )

    const first = loadFootballCompetitions()
    const second = loadFootballCompetitions()
    resolveFetch!({ competitions: [competition()] })

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(getCompetitions).toHaveBeenCalledTimes(1)
    expect(firstResult).toEqual(secondResult)
  })

  it('does not cache a failure -- a later call can retry successfully', async () => {
    getCompetitions.mockRejectedValueOnce(new Error('network down'))
    await expect(loadFootballCompetitions()).rejects.toThrow('network down')

    getCompetitions.mockResolvedValueOnce({ competitions: [competition()] })
    const leagues = await loadFootballCompetitions()
    expect(leagues).toHaveLength(1)
    expect(getCompetitions).toHaveBeenCalledTimes(2)
  })

  it('maps multiple competitions in the order the API returns them', async () => {
    getCompetitions.mockResolvedValue({
      competitions: [
        competition({ id: 'football_premier_league' }),
        competition({ id: 'norway-eliteserien', name: 'Eliteserien', region: 'Norway', country_code: 'NO', tier: 2 }),
      ],
    })
    const leagues = await loadFootballCompetitions()
    expect(leagues.map((l) => l.id)).toEqual(['football_premier_league', 'norway-eliteserien'])
  })
})
