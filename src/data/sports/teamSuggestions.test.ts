import { describe, expect, it } from 'vitest'
import { SUGGESTED_TEAM_LIMIT, groupTeamsByCompetition, suggestTeams } from './teamSuggestions'
import type { TeamDef } from './teamCatalog'

const PL = 'football_premier_league'
const ELITESERIEN = 'norway_eliteserien'
const SERIE_A = 'italy_serie_a'

function team(id: string, name: string, domesticCompetitionId: string | null, prominence: number): TeamDef {
  return { id, name, domesticCompetitionId, prominence }
}

const CITY = team('t_city', 'Manchester City', PL, 0.95)
const UNITED = team('t_united', 'Manchester United', PL, 0.93)
const ARSENAL = team('t_arsenal', 'Arsenal', PL, 0.9)
const GLIMT = team('t_glimt', 'Bodø/Glimt', ELITESERIEN, 0.4)
const ROSENBORG = team('t_rosenborg', 'Rosenborg', ELITESERIEN, 0.38)
const INTER = team('t_inter', 'Inter', SERIE_A, 0.88)

describe('suggestTeams', () => {
  it('orders one league by prominence, biggest first', () => {
    const result = suggestTeams({ teams: [ARSENAL, CITY, UNITED], competitionIds: [PL], selectedTeamIds: [] })
    expect(result.map((t) => t.name)).toEqual(['Manchester City', 'Manchester United', 'Arsenal'])
  })

  // The rule that stops "I follow four leagues" from becoming "here are
  // four English clubs".
  it('round-robins across followed leagues rather than emptying the first one', () => {
    const result = suggestTeams({
      teams: [CITY, UNITED, ARSENAL, GLIMT, ROSENBORG],
      competitionIds: [PL, ELITESERIEN],
      selectedTeamIds: [],
    })
    expect(result.map((t) => t.name)).toEqual([
      'Manchester City',
      'Bodø/Glimt',
      'Manchester United',
      'Rosenborg',
      'Arsenal',
    ])
  })

  it('gives the first followed league the first slot', () => {
    const plFirst = suggestTeams({ teams: [CITY, GLIMT], competitionIds: [PL, ELITESERIEN], selectedTeamIds: [] })
    const norwayFirst = suggestTeams({ teams: [CITY, GLIMT], competitionIds: [ELITESERIEN, PL], selectedTeamIds: [] })
    expect(plFirst[0].name).toBe('Manchester City')
    expect(norwayFirst[0].name).toBe('Bodø/Glimt')
  })

  // A suggestion list that can drop a club the viewer just picked reads as
  // the app forgetting the choice.
  it('always keeps already-followed teams, first, however small they are', () => {
    const result = suggestTeams({
      teams: [CITY, UNITED, ARSENAL, INTER, GLIMT],
      competitionIds: [PL],
      selectedTeamIds: [GLIMT.id],
      limit: 2,
    })
    expect(result.map((t) => t.name)).toEqual(['Bodø/Glimt', 'Manchester City'])
  })

  it('never lists the same club twice, even when it is both selected and suggestible', () => {
    const result = suggestTeams({ teams: [CITY, UNITED], competitionIds: [PL], selectedTeamIds: [CITY.id] })
    expect(result.filter((t) => t.id === CITY.id)).toHaveLength(1)
  })

  it('respects the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => team(`t${i}`, `Team ${i}`, PL, 1 - i / 100))
    expect(suggestTeams({ teams: many, competitionIds: [PL], selectedTeamIds: [] })).toHaveLength(SUGGESTED_TEAM_LIMIT)
  })

  // With no leagues picked there is nothing to scope to — showing the
  // biggest clubs Ninety knows is a better answer than showing nothing.
  it('falls back to the most prominent clubs when no league is followed', () => {
    const result = suggestTeams({ teams: [GLIMT, CITY, INTER], competitionIds: [], selectedTeamIds: [] })
    expect(result.map((t) => t.name)).toEqual(['Manchester City', 'Inter', 'Bodø/Glimt'])
  })

  it('still suggests clubs whose domestic competition the catalogue does not know', () => {
    const orphan = team('t_orphan', 'Unknown FC', null, 0.5)
    const result = suggestTeams({ teams: [orphan], competitionIds: [PL], selectedTeamIds: [] })
    expect(result.map((t) => t.name)).toEqual(['Unknown FC'])
  })

  // A catalogue from a backend with no prominence data at all still has to
  // produce a stable list rather than reshuffling between renders.
  it('is deterministic when every club scores the same', () => {
    const flat = [team('b', 'Beta', PL, 0.5), team('a', 'Alpha', PL, 0.5)]
    expect(suggestTeams({ teams: flat, competitionIds: [PL], selectedTeamIds: [] }).map((t) => t.name)).toEqual([
      'Alpha',
      'Beta',
    ])
  })

  it('returns nothing when there are no teams at all', () => {
    expect(suggestTeams({ teams: [], competitionIds: [PL], selectedTeamIds: ['t_gone'] })).toEqual([])
  })
})

describe('groupTeamsByCompetition', () => {
  const names = new Map([
    [PL, 'Premier League'],
    [ELITESERIEN, 'Eliteserien'],
    [SERIE_A, 'Serie A'],
  ])

  it('puts followed competitions first, in the viewer’s own order', () => {
    const groups = groupTeamsByCompetition([CITY, GLIMT, INTER], names, [ELITESERIEN, PL])
    expect(groups.map((g) => g.label)).toEqual(['Eliteserien', 'Premier League', 'Serie A'])
  })

  it('sorts each group by prominence', () => {
    const groups = groupTeamsByCompetition([ARSENAL, CITY, UNITED], names, [PL])
    expect(groups[0].teams.map((t) => t.name)).toEqual(['Manchester City', 'Manchester United', 'Arsenal'])
  })

  it('collects clubs with no known competition into one catch-all group, last', () => {
    const orphan = team('t_orphan', 'Unknown FC', null, 0.5)
    const groups = groupTeamsByCompetition([orphan, CITY], names, [PL])
    expect(groups.map((g) => g.label)).toEqual(['Premier League', 'Other teams'])
  })

  // A rail row that opens onto nothing is a dead end with a remote.
  it('produces no empty groups', () => {
    const groups = groupTeamsByCompetition([CITY], names, [PL, ELITESERIEN, SERIE_A])
    expect(groups).toHaveLength(1)
  })

  it('labels a competition the catalogue does not name, rather than showing a raw id', () => {
    const mystery = team('t_x', 'Mystery FC', 'unlisted_league', 0.5)
    const groups = groupTeamsByCompetition([mystery], names, [])
    expect(groups[0].label).toBe('Other competitions')
  })

  it('returns nothing for an empty catalogue', () => {
    expect(groupTeamsByCompetition([], names, [PL])).toEqual([])
  })
})
