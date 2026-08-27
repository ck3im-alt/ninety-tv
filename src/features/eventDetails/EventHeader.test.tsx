// @vitest-environment jsdom
//
// Coverage for the 2026-08-26 matchup-row fix. The away side used to carry a
// `row-reverse` class, which flipped its three elements and made the whole
// row read "[home crest] Home — [away crest] Away": both crests on the same
// side of their names, both scores on the outside. What's asserted here is
// the visual reading order itself, as flat DOM order — the thing that
// regressed, and the thing a CSS-only change could silently break again.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FootballEventHeader, GenericEventHeader } from './EventHeader'
import type { SportEvent } from '../../data/sports/types'

afterEach(() => {
  cleanup()
})

function event(overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    id: 'e1',
    sportKey: 'football',
    sportLabel: 'FOOTBALL',
    league: 'Premier League',
    leagueId: 'football_premier_league',
    title: 'Arsenal vs Liverpool',
    homeTeam: 'Arsenal',
    awayTeam: 'Liverpool',
    homeBadge: 'arsenal.png',
    awayBadge: 'liverpool.png',
    dateTimeUtc: '2026-08-26T18:00:00Z',
    timeLabel: '',
    isLive: false,
    ...overrides,
  }
}

// The matchup row flattened to a left-to-right reading order, one token per
// meaningful element. Crests become their file name so a badge's SIDE is
// visible in the assertion.
function matchupOrder(): string[] {
  const cells = [...document.querySelectorAll('.event-header-cell-left, .event-header-cell-center, .event-header-cell-right')]
  // The first left/center/right triple in the grid IS the matchup row (the
  // competition line above it is a full-span row, not a cell).
  return cells.slice(0, 3).flatMap((cell) =>
    [...cell.querySelectorAll('.event-header-team-badge, .event-header-team-name, .event-header-score, .event-header-vs')].map((el) =>
      el.tagName === 'IMG' ? (el as HTMLImageElement).getAttribute('src')! : (el.textContent ?? ''),
    ),
  )
}

describe('FootballEventHeader — matchup reading order', () => {
  it('reads [home crest] Home VS Away [away crest] for an upcoming fixture', () => {
    render(<FootballEventHeader event={event()} />)
    expect(matchupOrder()).toEqual(['arsenal.png', 'Arsenal', 'VS', 'Liverpool', 'liverpool.png'])
  })

  it('puts each score innermost, against the center, when the match has one', () => {
    render(<FootballEventHeader event={event({ isLive: true, status: 'live', homeScore: '2', awayScore: '1' })} />)
    expect(matchupOrder()).toEqual(['arsenal.png', 'Arsenal', '2', 'VS', '1', 'Liverpool', 'liverpool.png'])
  })

  it('keeps the same order for a completed match', () => {
    render(<FootballEventHeader event={event({ status: 'complete', homeScore: '0', awayScore: '3' })} />)
    expect(matchupOrder()).toEqual(['arsenal.png', 'Arsenal', '0', 'VS', '3', 'Liverpool', 'liverpool.png'])
  })

  it('never flex-reverses either side (the reversal was the bug)', () => {
    render(<FootballEventHeader event={event()} />)
    expect(document.querySelector('.event-header-team-reverse')).toBeNull()
    expect(document.querySelector('.event-header-team-away')).toBeTruthy()
  })

  it('shows VS, not a dash, and draws no divider element', () => {
    render(<FootballEventHeader event={event()} />)
    expect(screen.getByText('VS')).toBeTruthy()
    expect(document.querySelector('.event-header-score-dash')).toBeNull()
    expect(screen.queryByText('—')).toBeNull()
  })
})

describe('FootballEventHeader — venue', () => {
  it('renders the venue with a stadium mark (two ellipses), not a map pin', () => {
    render(<FootballEventHeader event={event({ venue: 'Estadio Santiago Bernabéu' })} />)
    const meta = [...document.querySelectorAll('.event-header-meta')].find((el) => el.textContent?.includes('Estadio'))!
    expect(meta.textContent).toContain('Estadio Santiago Bernabéu')
    const icon = meta.querySelector('.event-header-meta-icon')!
    expect(icon.querySelectorAll('ellipse')).toHaveLength(2)
    expect(icon.querySelector('path')).toBeNull()
  })

  it('leaves the clock icon alone', () => {
    render(<FootballEventHeader event={event({ venue: 'Emirates Stadium' })} />)
    const kickoff = [...document.querySelectorAll('.event-header-meta')].find((el) => el.textContent?.includes('Kick-off'))!
    expect(kickoff.querySelector('circle')).toBeTruthy()
    expect(kickoff.querySelector('ellipse')).toBeNull()
  })
})

describe('GenericEventHeader — shares the venue mark', () => {
  it('uses the same stadium icon for single-entrant events', () => {
    render(<GenericEventHeader event={event({ sportKey: 'f1', title: 'Monza Grand Prix', venue: 'Autodromo Nazionale Monza' })} />)
    const meta = document.querySelector('.event-header-meta')!
    expect(meta.querySelectorAll('.event-header-meta-icon ellipse').length).toBeGreaterThanOrEqual(2)
  })
})

// Curated per-competition Match View artwork (2026-08-26). Which competition
// maps to which banner is covered in data/sports/competitionArtwork.test.ts;
// what matters here is that the header actually applies it, that a
// competition without artwork still gets the generic arcs treatment rather
// than a broken image, and that the fade has no hard bottom edge.
describe('FootballEventHeader — competition artwork', () => {
  const backdrop = () => document.querySelector('.event-header-backdrop') as HTMLElement

  it('paints the Premier League banner for a Premier League fixture', () => {
    render(<FootballEventHeader event={event({ leagueId: 'football_premier_league' })} />)
    expect(backdrop().className).toContain('event-header-backdrop-photo')
    expect(backdrop().style.backgroundImage).toContain('Match_hero/Premier_League.jpg')
  })

  it('paints the La Liga banner for a La Liga fixture', () => {
    render(<FootballEventHeader event={event({ leagueId: 'football_la_liga' })} />)
    expect(backdrop().style.backgroundImage).toContain('Match_hero/La_liga.jpg')
  })

  it('paints the Champions League banner from the matched set', () => {
    render(<FootballEventHeader event={event({ leagueId: 'football_champions_league' })} />)
    expect(backdrop().style.backgroundImage).toContain('Match_hero/Champions_League.jpg')
  })

  // Selection is by canonical competition id, so the display name is
  // irrelevant — a Canadian Premier League fixture must not inherit the
  // English one's artwork just because its name contains "Premier League".
  it('does not paint Premier League artwork for a same-named different competition', () => {
    render(<FootballEventHeader event={event({ leagueId: 'canada-canadian-premier-league', league: 'Canadian Premier League' })} />)
    expect(backdrop().style.backgroundImage).toBe('')
    expect(backdrop().className).not.toContain('event-header-backdrop-photo')
  })

  it('falls back to the generic gradient + arcs for a competition with no curated artwork', () => {
    render(<FootballEventHeader event={event({ leagueId: 'england-championship', league: 'Championship' })} />)
    expect(backdrop().className).not.toContain('event-header-backdrop-photo')
    expect(backdrop().style.backgroundImage).toBe('')
    expect(document.querySelector('.event-header-backdrop-arcs')).toBeTruthy()
  })

  // The artwork is meant to bleed down toward the stream list and dissolve,
  // not stop at a line. Reaching --bg-primary only AT the box edge left the
  // image faintly visible on the last few pixels and then cut, which read as
  // a hard border; finishing the interpolation early and holding the
  // background colour to the edge is what removes it. (The bleed DISTANCE is
  // .event-header's bottom padding — CSS, and geometric, so it is verified by
  // measurement in a real browser rather than in jsdom, which has no layout.)
  it('finishes the fade to the page background BEFORE the box edge, so there is no hard border', () => {
    render(<FootballEventHeader event={event({ leagueId: 'football_la_liga' })} />)
    const gradient = backdrop().style.backgroundImage.split('url(')[0]
    const lastStop = Number(gradient.match(/var\(--bg-primary\)\s+(\d+)%/)![1])
    expect(lastStop).toBeLessThan(100)
    // ...and the background colour is then held all the way to the edge.
    expect(gradient).toMatch(/var\(--bg-primary\)\s+100%/)
  })

  it('drops the decorative arcs when a photo is shown (they would clutter it)', () => {
    render(<FootballEventHeader event={event({ leagueId: 'football_la_liga' })} />)
    expect(document.querySelector('.event-header-backdrop-arcs')).toBeNull()
  })
})
