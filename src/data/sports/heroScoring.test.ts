// The app's one editorial judgement about competition and stage
// importance, and in particular the round parser — which carried a real bug
// until 2026-08-26: "semi-final" CONTAINS "final", and a priority-ordered
// substring scan resolved every semifinal (and every quarter-final) as a
// final.
import { describe, expect, it } from 'vitest'
import { competitionPrestige, parseRoundStage, roundSignificance } from './heroScoring'

describe('parseRoundStage', () => {
  // THE REGRESSION. All three must resolve DISTINCTLY.
  it('resolves final, semi-final and quarter-final as three different stages', () => {
    expect(parseRoundStage('Final')).toBe('final')
    expect(parseRoundStage('Semi-final')).toBe('semi-final')
    expect(parseRoundStage('Quarter-final')).toBe('quarter-final')
  })

  it('never resolves a semi-final or a quarter-final as a final', () => {
    expect(parseRoundStage('Semi-final')).not.toBe('final')
    expect(parseRoundStage('Semi-finals')).not.toBe('final')
    expect(parseRoundStage('Quarter-final')).not.toBe('final')
    expect(parseRoundStage('Quarter-finals')).not.toBe('final')
  })

  // The round text comes from a third-party feed and is not a controlled
  // vocabulary, so every plausible spelling has to land on one stage.
  it.each(['semi-final', 'Semi Final', 'semifinal', 'Semifinals', 'SEMI-FINALS'])('reads %s as a semi-final', (round) => {
    expect(parseRoundStage(round)).toBe('semi-final')
  })

  it.each(['quarter-final', 'Quarter Final', 'quarterfinal', 'Quarter-finals'])('reads %s as a quarter-final', (round) => {
    expect(parseRoundStage(round)).toBe('quarter-final')
  })

  it.each(['Round of 16', 'Last 16', 'R16'])('reads %s as the round of 16', (round) => {
    expect(parseRoundStage(round)).toBe('round-of-16')
  })

  it('reads the other stages it knows about', () => {
    expect(parseRoundStage('3rd Qualifying Round')).toBe('qualifying')
    expect(parseRoundStage('Group Stage')).toBe('group')
    expect(parseRoundStage('Play-offs')).toBe('play-off')
    expect(parseRoundStage('Regular Season')).toBe('regular-season')
    expect(parseRoundStage('Matchweek 12')).toBe('regular-season')
  })

  // TheSportsDB's rounds are bare numbers and match nothing here, which is
  // correct — an unknown round is not a knockout tie.
  it('returns null for a round it does not recognise, rather than guessing', () => {
    expect(parseRoundStage('12')).toBeNull()
    expect(parseRoundStage('')).toBeNull()
    expect(parseRoundStage(undefined)).toBeNull()
    expect(parseRoundStage(null)).toBeNull()
    expect(parseRoundStage('---')).toBeNull()
  })
})

describe('roundSignificance', () => {
  it('ranks the knockout ladder in order', () => {
    expect(roundSignificance('Final')).toBeGreaterThan(roundSignificance('Semi-finals'))
    expect(roundSignificance('Semi-finals')).toBeGreaterThan(roundSignificance('Quarter-finals'))
    expect(roundSignificance('Quarter-finals')).toBeGreaterThan(roundSignificance('Round of 16'))
  })

  it('ranks a knockout round above qualifying', () => {
    expect(roundSignificance('Round of 16')).toBeGreaterThan(roundSignificance('2nd Qualifying Round'))
  })

  it('falls back to a neutral weight for an unknown round', () => {
    expect(roundSignificance('12')).toBe(roundSignificance(undefined))
  })
})

describe('competitionPrestige', () => {
  it('puts the Champions League above every tier-1 league', () => {
    expect(competitionPrestige({ leagueId: 'football_champions_league', leagueTier: 1 })).toBeGreaterThan(
      competitionPrestige({ leagueId: 'football_premier_league', leagueTier: 1 }),
    )
  })

  it('ranks the tiers in order', () => {
    expect(competitionPrestige({ leagueId: 'a', leagueTier: 1 })).toBeGreaterThan(competitionPrestige({ leagueId: 'b', leagueTier: 2 }))
    expect(competitionPrestige({ leagueId: 'b', leagueTier: 2 })).toBeGreaterThan(competitionPrestige({ leagueId: 'c', leagueTier: 3 }))
  })

  it('gives a competition with no tier a neutral, finite value', () => {
    const untiered = competitionPrestige({ leagueId: 'unknown' })
    expect(Number.isFinite(untiered)).toBe(true)
    expect(untiered).toBeGreaterThan(0)
  })
})
