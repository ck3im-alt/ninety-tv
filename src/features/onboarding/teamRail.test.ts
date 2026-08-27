import { describe, expect, it } from 'vitest'
import { orderTeamRail } from './teamRail'
import type { LeagueDef } from '../../data/sports/leagues'

function league(id: string, name: string, extra: Partial<LeagueDef> = {}): LeagueDef {
  return { id, name, region: 'Nowhere', type: 'league', tier: 1, ...extra } as LeagueDef
}

const CATALOG = [
  league('eredivisie', 'Eredivisie', { region: 'Netherlands' }),
  league('fa_cup', 'FA Cup', { region: 'England', type: 'cup' }),
  league('eliteserien', 'Eliteserien', { region: 'Norway' }),
  league('championship', 'Championship', { region: 'England', tier: 2 }),
  league('premier_league', 'Premier League', { region: 'England' }),
]

describe('orderTeamRail', () => {
  it('puts the followed competitions first', () => {
    const ordered = orderTeamRail(CATALOG, new Set(['eliteserien']))
    expect(ordered[0].id).toBe('eliteserien')
  })

  // THE RULE. League selection prioritizes clubs; it must never restrict
  // which clubs a viewer can reach. Someone who follows only Eliteserien can
  // still walk down the rail to La Liga and follow Real Madrid.
  it('keeps every competition in the rail, followed or not', () => {
    const ordered = orderTeamRail(CATALOG, new Set(['eliteserien']))
    expect(ordered.map((l) => l.id).sort()).toEqual(CATALOG.map((l) => l.id).sort())
  })

  it('orders both halves by tier, then leagues ahead of cups, then name', () => {
    const ordered = orderTeamRail(CATALOG, new Set())
    expect(ordered.map((l) => l.name)).toEqual([
      // Tier 1 leagues alphabetically...
      'Eliteserien',
      'Eredivisie',
      'Premier League',
      // ...then the tier-1 cup (a club is found under its LEAGUE)...
      'FA Cup',
      // ...then tier 2.
      'Championship',
    ])
  })

  it('sorts inside each half rather than preserving catalogue order across the split', () => {
    const ordered = orderTeamRail(CATALOG, new Set(['championship', 'fa_cup']))
    // Both followed, and ordered against each other by the same rule.
    expect(ordered.slice(0, 2).map((l) => l.name)).toEqual(['FA Cup', 'Championship'])
    expect(ordered.slice(2).map((l) => l.name)).toEqual(['Eliteserien', 'Eredivisie', 'Premier League'])
  })

  it('never emits the same competition twice, even from a catalogue that repeats one', () => {
    const ordered = orderTeamRail([...CATALOG, league('fa_cup', 'FA Cup', { type: 'cup' })], new Set())
    expect(ordered.filter((l) => l.id === 'fa_cup')).toHaveLength(1)
  })

  it('is empty for an empty catalogue rather than throwing', () => {
    expect(orderTeamRail([], new Set(['anything']))).toEqual([])
  })
})
