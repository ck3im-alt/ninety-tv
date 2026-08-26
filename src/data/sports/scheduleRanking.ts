// Turns "every football fixture Ninety knows about for the viewer's local
// day" into the order the Schedule screen renders it in: competition groups
// ranked by a blend of personal relevance and competition importance, each
// group's fixtures ordered by what's actually useful once you're already
// inside one competition.
//
// The single hard rule this file exists to keep honest: RANKING CHANGES
// ORDER ONLY. Nothing here filters. Every fixture handed in comes back out,
// in exactly one group — a smaller competition can be pushed down the page
// but can never be dropped off it. (Filtering by competition is a separate,
// explicit user action — see the league pills in ScheduleScreen.tsx.)
//
// Prestige and stage significance are NOT re-invented here: both come from
// heroScoring.ts, which is the app's one editorial judgement about how big a
// competition and how important a round are. A second table would drift.
import { competitionPrestige, roundSignificance } from './heroScoring'
import type { SportEvent } from './types'

export interface ScheduleGroup {
  // SportEvent.leagueId — ninety-api's canonical competition id, the same
  // value SportPreferences.footballLeagueIds stores.
  competitionId: string
  competitionName: string
  competitionBadge?: string
  isFavorite: boolean
  fixtures: SportEvent[]
}

// Weights are an editorial judgement, same spirit as heroScoring's own — the
// point of writing them down as named constants is that they can be retuned
// without re-deriving the intent.
//
// The calibration target, stated as an inequality that must hold:
//
//   a Champions League fixture (prestige 1.0)  >  a tier-3 competition the
//   user happens to have ticked (prestige 0.45, favorite)
//
// which is what stops a favorite checkbox from becoming an absolute
// monopoly. Working it through with regular-season rounds on both sides:
//   CL, not favorited:      0.55*1.00 + 0.15*0.60 (group stage) = 0.640
//   tier 3, favorited:      0.30 + 0.55*0.45 + 0.15*0.50        = 0.623
// while a favorited tier-1 league still comfortably leads the page:
//   tier 1, favorited:      0.30 + 0.55*0.85 + 0.15*0.50        = 0.843
// and a favorited tier-2 still outranks an unfollowed tier-1:
//   tier 2, favorited:      0.30 + 0.55*0.65 + 0.15*0.50        = 0.733
//   tier 1, not favorited:        0.55*0.85 + 0.15*0.50         = 0.543
const WEIGHT_FAVORITE = 0.3
const WEIGHT_PRESTIGE = 0.55
const WEIGHT_SIGNIFICANCE = 0.15
// A group with something actually in progress gets a small nudge. Small
// deliberately: it's enough to lift a live competition above an equal one
// that hasn't kicked off, and enough that a live favorite can edge past a
// not-yet-started CL group game (0.663 vs 0.640 — a defensible outcome:
// something you follow is happening RIGHT NOW), but nowhere near enough to
// reach a CL knockout tie (0.678+), which is the case the calibration above
// is actually about.
const WEIGHT_LIVE = 0.04

// A competition's own importance is the same for every one of its fixtures;
// its stage significance is not (a cup can run a quarter-final and a replay
// on the same day), so the group takes the MOST significant fixture it holds.
// Using the max, not an average, is deliberate: one semifinal is what makes a
// competition worth surfacing today, and averaging it against three
// group-stage games would hide exactly that.
export function scoreScheduleGroup(group: ScheduleGroup): number {
  const anchor = group.fixtures[0]
  const prestige = anchor ? competitionPrestige(anchor) : 0
  const significance = group.fixtures.reduce((best, ev) => Math.max(best, roundSignificance(ev.round)), 0)
  const hasLive = group.fixtures.some((ev) => ev.isLive)
  return (
    WEIGHT_FAVORITE * (group.isFavorite ? 1 : 0) +
    WEIGHT_PRESTIGE * prestige +
    WEIGHT_SIGNIFICANCE * significance +
    WEIGHT_LIVE * (hasLive ? 1 : 0)
  )
}

function kickoffMs(event: SportEvent): number {
  if (!event.dateTimeUtc) return Number.MAX_SAFE_INTEGER
  const ms = new Date(event.dateTimeUtc).getTime()
  return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms
}

// Ordering INSIDE a competition group, which is a different question from
// ordering the groups themselves. Once the reader is already looking at one
// competition, time is the more useful organizing principle than importance
// — a 12:30 kickoff belongs above a 21:00 one, and no ranking score should
// ever reverse that.
//
// So: everything currently live rises to the top of its group (that's the
// one thing that beats the clock — it's watchable this second), and
// everything else — scheduled AND already-finished — sits in plain
// chronological order below it. A finished lunchtime match therefore stays
// exactly where the eye expects it, at the start of the day, carrying its
// final score, rather than being exiled to a separate section. Both sublists
// are themselves chronological, and ties break on event id, so the result is
// fully deterministic.
export function orderFixturesWithinGroup(fixtures: readonly SportEvent[]): SportEvent[] {
  return [...fixtures].sort((a, b) => {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1
    const byTime = kickoffMs(a) - kickoffMs(b)
    if (byTime !== 0) return byTime
    return a.id.localeCompare(b.id)
  })
}

// Groups every fixture by competition and ranks the groups. `favoriteIds` is
// SportPreferences.footballLeagueIds — it only ever affects ORDER here, never
// which competitions or fixtures exist (see this file's header).
export function buildScheduleGroups(fixtures: readonly SportEvent[], favoriteIds: readonly string[]): ScheduleGroup[] {
  const favorites = new Set(favoriteIds)
  const byCompetition = new Map<string, ScheduleGroup>()

  for (const fixture of fixtures) {
    // leagueId is always set at mapping time (mapEvent.ts); the fallback is
    // for a fixture whose competition the catalog doesn't know, which must
    // still appear rather than vanish into a missing key.
    const competitionId = fixture.leagueId || 'unknown'
    let group = byCompetition.get(competitionId)
    if (!group) {
      group = {
        competitionId,
        competitionName: fixture.league || 'Other fixtures',
        competitionBadge: fixture.leagueBadge,
        isFavorite: favorites.has(competitionId),
        fixtures: [],
      }
      byCompetition.set(competitionId, group)
    }
    group.fixtures.push(fixture)
  }

  const groups = [...byCompetition.values()].map((group) => ({
    ...group,
    fixtures: orderFixturesWithinGroup(group.fixtures),
  }))

  // Deterministic all the way down: score, then the group's earliest
  // kickoff, then name, then id — so two competitions that genuinely tie
  // still render in a stable order across re-renders and refreshes rather
  // than inheriting Map insertion order (which follows whatever order the
  // API happened to page the events in).
  return groups.sort((a, b) => {
    const byScore = scoreScheduleGroup(b) - scoreScheduleGroup(a)
    if (byScore !== 0) return byScore
    const byTime = kickoffMs(a.fixtures[0]) - kickoffMs(b.fixtures[0])
    if (byTime !== 0) return byTime
    const byName = a.competitionName.localeCompare(b.competitionName)
    if (byName !== 0) return byName
    return a.competitionId.localeCompare(b.competitionId)
  })
}

export interface ScheduleFilterOption {
  competitionId: string
  competitionName: string
  competitionBadge?: string
}

// The league pills, in the SAME order as the sections below them — the pill
// row then reads as a table of contents for the page rather than a second,
// differently-sorted list of the same competitions. Only competitions that
// actually have a fixture today appear, because buildScheduleGroups only
// produces groups for fixtures that exist.
export function scheduleFilterOptions(groups: readonly ScheduleGroup[]): ScheduleFilterOption[] {
  return groups.map((group) => ({
    competitionId: group.competitionId,
    competitionName: group.competitionName,
    competitionBadge: group.competitionBadge,
  }))
}

// `null` is the "All" pill — the default on entering Schedule, and the only
// state in which every competition is shown. Selecting a league is the one
// thing that narrows the day; nothing else in this file ever does.
export function applyScheduleFilter(groups: readonly ScheduleGroup[], competitionId: string | null): ScheduleGroup[] {
  if (competitionId == null) return [...groups]
  return groups.filter((group) => group.competitionId === competitionId)
}
