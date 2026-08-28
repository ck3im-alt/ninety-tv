import { describe, expect, it } from 'vitest'
import { HOME_HERO_COMPETITION_IDS, MATCH_HERO_COMPETITION_IDS, competitionHomeHero, competitionMatchHero } from './competitionArtwork'

// Every competition that has curated Match View artwork, and the file it must
// resolve to. Spelled out rather than derived from the module's own map, so a
// typo'd path or a competition wired to the wrong league's banner fails here
// instead of shipping.
const EXPECTED: Array<[id: string, file: string]> = [
  ['football_premier_league', 'Match_hero/Premier_League.jpg'],
  ['football_la_liga', 'Match_hero/La_liga.jpg'],
  ['football_serie_a', 'Match_hero/Serie_A.jpg'],
  ['football_bundesliga', 'Match_hero/Bundesliga.jpg'],
  ['football_ligue_1', 'Match_hero/Ligue_1.jpg'],
  ['football_champions_league', 'Match_hero/Champions_League.jpg'],
  ['football_europa_league', 'Match_hero/Europa_League.jpg'],
  ['norway-eliteserien', 'Match_hero/Eliteserien.jpg'],
  ['sweden-allsvenskan', 'Match_hero/Allsvenskan.jpg'],
  ['denmark-superliga', 'Match_hero/Superliga_DK.jpg'],
]

describe('competitionMatchHero', () => {
  it.each(EXPECTED)('maps %s to its own banner', (id, file) => {
    expect(competitionMatchHero(id)).toContain(file)
  })

  it('covers exactly the competitions listed above — nothing silently added or dropped', () => {
    expect([...MATCH_HERO_COMPETITION_IDS].sort()).toEqual(EXPECTED.map(([id]) => id).sort())
  })

  it('gives each competition a DIFFERENT image (no accidental shared entry)', () => {
    const urls = MATCH_HERO_COMPETITION_IDS.map((id) => competitionMatchHero(id)!)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('resolves paths against the app base so the Tizen widget and subpath deploys both work', () => {
    // import.meta.env.BASE_URL always ends in '/', so a correctly-joined URL
    // never contains a doubled or missing separator.
    for (const id of MATCH_HERO_COMPETITION_IDS) {
      const url = competitionMatchHero(id)!
      expect(url).toMatch(/backgrounds\/Match_hero\//)
      expect(url).not.toMatch(/[^:]\/\//)
    }
  })
})

describe('competitionMatchHero — competitions with no curated artwork', () => {
  // Absence is the normal case for most of the 50-competition catalog, and it
  // must stay a clean null so the header falls back to its generic
  // gradient-and-arcs treatment rather than a broken image.
  it('returns null rather than a placeholder', () => {
    expect(competitionMatchHero('england-championship')).toBeNull()
    expect(competitionMatchHero('usa-usl-championship')).toBeNull()
  })

  it('returns null for a missing/undefined leagueId', () => {
    expect(competitionMatchHero(undefined)).toBeNull()
    expect(competitionMatchHero('')).toBeNull()
  })
})

// The whole reason this is keyed on the canonical id rather than the
// competition NAME. Each of these is a real entry in ninety-api's catalog
// whose name collides with, or contains, the name of a competition that DOES
// have artwork — so a name or substring match would mis-assign it.
describe('competitionMatchHero — name collisions must not leak artwork', () => {
  it("does not give Austria's Bundesliga the German Bundesliga's banner", () => {
    expect(competitionMatchHero('football_bundesliga')).toContain('Bundesliga.jpg')
    expect(competitionMatchHero('austria-bundesliga')).toBeNull()
  })

  it("does not give Brazil's Serie A the Italian Serie A's banner", () => {
    expect(competitionMatchHero('football_serie_a')).toContain('Serie_A.jpg')
    expect(competitionMatchHero('brazil-serie-a')).toBeNull()
  })

  it("does not give Canada's Premier League the English Premier League's banner", () => {
    expect(competitionMatchHero('football_premier_league')).toContain('Premier_League.jpg')
    expect(competitionMatchHero('canada-canadian-premier-league')).toBeNull()
  })

  it('is keyed by canonical ids, not display names', () => {
    expect(competitionMatchHero('Premier League')).toBeNull()
    expect(competitionMatchHero('La Liga')).toBeNull()
    expect(competitionMatchHero('UEFA Champions League')).toBeNull()
  })
})

// Same treatment for Home's hero family. Spelled out for the same reason:
// the failure this catches is a competition silently wearing another
// league's stadium, which no type check can see.
const EXPECTED_HOME: Array<[id: string, file: string]> = [
  ['football_premier_league', 'League_main_hero/Premier_League.jpg'],
  ['football_la_liga', 'League_main_hero/La_liga.jpg'],
  ['football_serie_a', 'League_main_hero/Serie_A.jpg'],
  ['football_bundesliga', 'League_main_hero/Bundesliga.jpg'],
  ['football_ligue_1', 'League_main_hero/Ligue_1.jpg'],
  ['football_champions_league', 'League_main_hero/Champions_League.jpg'],
  ['football_europa_league', 'League_main_hero/Europa_League.jpg'],
  ['norway-eliteserien', 'League_main_hero/Eliteserien.jpg'],
  ['sweden-allsvenskan', 'League_main_hero/Allsvenskan.jpg'],
]

describe('competitionHomeHero', () => {
  it.each(EXPECTED_HOME)('maps %s to its own hero', (id, file) => {
    expect(competitionHomeHero(id)).toContain(file)
  })

  it('covers exactly the competitions listed above — nothing silently added or dropped', () => {
    expect([...HOME_HERO_COMPETITION_IDS].sort()).toEqual(EXPECTED_HOME.map(([id]) => id).sort())
  })

  it('gives each competition a DIFFERENT image (no accidental shared entry)', () => {
    const urls = HOME_HERO_COMPETITION_IDS.map((id) => competitionHomeHero(id)!)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('resolves paths against the app base so the Tizen widget and subpath deploys both work', () => {
    for (const id of HOME_HERO_COMPETITION_IDS) {
      const url = competitionHomeHero(id)!
      expect(url).toMatch(/backgrounds\/League_main_hero\//)
      expect(url).not.toMatch(/[^:]\/\//)
    }
  })

  // The two families are separate directories on purpose (see the module's
  // own comment): Match View is lit at both edges for the crests-and-VS
  // layout, Home is dark on the left under its title text. Reusing one for
  // the other is a real regression, so assert they never converge.
  it('never serves a Match View banner as a Home hero', () => {
    for (const id of HOME_HERO_COMPETITION_IDS) {
      expect(competitionHomeHero(id)).not.toBe(competitionMatchHero(id))
      expect(competitionHomeHero(id)).not.toContain('Match_hero/')
    }
  })

  // Denmark has a Match View banner but no Home hero yet — the one
  // competition where the two maps legitimately disagree, and the case that
  // proves an uncovered competition returns null instead of borrowing.
  it('returns null for a competition with Match View artwork but no Home hero', () => {
    expect(competitionMatchHero('denmark-superliga')).toContain('Superliga_DK.jpg')
    expect(competitionHomeHero('denmark-superliga')).toBeNull()
  })

  it('returns null rather than a placeholder for an uncovered competition', () => {
    expect(competitionHomeHero('england-championship')).toBeNull()
    expect(competitionHomeHero('austria-bundesliga')).toBeNull()
    expect(competitionHomeHero('brazil-serie-a')).toBeNull()
    expect(competitionHomeHero('canada-canadian-premier-league')).toBeNull()
  })

  it('returns null for a missing/undefined leagueId', () => {
    expect(competitionHomeHero(undefined)).toBeNull()
    expect(competitionHomeHero('')).toBeNull()
  })
})
