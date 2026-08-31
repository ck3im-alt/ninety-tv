// Turns "every football fixture Ninety knows about for one of the viewer's
// local days" into the order the Schedule screen renders it in: competition
// groups partitioned by whether the viewer follows the competition and then
// ranked by competition importance, each group's fixtures ordered by what's
// actually useful once you're already inside one competition.
//
// The single hard rule this file exists to keep honest: RANKING CHANGES
// ORDER ONLY. Nothing here filters. Every fixture handed in comes back out,
// in exactly one group — a smaller competition can be pushed down the page
// but can never be dropped off it. (Nothing narrows the day at all any
// more: the league-pill filter Schedule used to carry was removed with the
// 2026-08-31 redesign, because the whole day IS the browse surface now and
// favorites being pinned first makes a competition picker redundant.)
//
// Prestige and stage significance are NOT re-invented here: both come from
// heroScoring.ts, which is the app's one editorial judgement about how big a
// competition and how important a round are. A second table would drift.
import { competitionPrestige, roundSignificance } from './heroScoring'
import type { LeagueDef } from './leagues'
import type { SportEvent } from './types'

export interface ScheduleGroup {
  // SportEvent.leagueId — ninety-api's canonical competition id, the same
  // value SportPreferences.footballLeagueIds stores.
  competitionId: string
  competitionName: string
  competitionBadge?: string
  // The competition's own country/region, straight from ninety-api's
  // canonical registry (GET /v1/competitions via competitionsCatalog.ts) —
  // 'England', 'Norway', 'Europe', 'International'. NEVER inferred from the
  // competition's name, and never the viewer's own country. Undefined only
  // when the competition isn't in the fetched catalog at all.
  region?: string
  // ISO-3166-1 alpha-2, or null/undefined for a supranational competition
  // (UEFA/CONMEBOL/FIFA have no country of their own — see
  // competitionGrouping.ts). This is what decides whether the section header
  // can show a national flag; a supranational one shows its badge instead.
  countryCode?: string | null
  isFavorite: boolean
  fixtures: SportEvent[]
}

// FAVORITES ARE AN ABSOLUTE PARTITION, NOT A WEIGHT.
//
// Until 2026-08-31 a favorite competition got a +0.30 boost and could still
// be outranked by a big enough competition — a Champions League semifinal
// deliberately sat above a favorited tier-3 league. That calibration was
// right for a screen that answers "what's the biggest football on today"
// and wrong for this one. Schedule is where someone goes to look up THEIR
// competitions; making them hunt past two European ties for the league they
// explicitly ticked is the opposite of what the setting means. Home is
// unchanged and still weights favorites against prestige (see
// homePersonalization.ts/homeRanking.ts) — the two screens answer different
// questions and are allowed to order the same day differently.
//
// So: every favorite competition with a fixture precedes every non-favorite
// one, no exceptions. The score below then orders WITHIN each partition,
// where it is exactly the ranking it always was.
const WEIGHT_PRESTIGE = 0.55
const WEIGHT_SIGNIFICANCE = 0.15
// A group with something actually in progress gets a small nudge — enough
// to lift a live competition above an equal one that hasn't kicked off, and
// nowhere near enough to reach a knockout tie, which is the case the
// prestige/significance balance is actually about.
const WEIGHT_LIVE = 0.04

// A competition's own importance is the same for every one of its fixtures;
// its stage significance is not (a cup can run a quarter-final and a replay
// on the same day), so the group takes the MOST significant fixture it holds.
// Using the max, not an average, is deliberate: one semifinal is what makes a
// competition worth surfacing today, and averaging it against three
// group-stage games would hide exactly that.
//
// `isFavorite` is deliberately NOT an input. It is applied above this, as a
// partition — a term for it here would be a constant within each partition
// and could therefore only ever mislead a reader into thinking it still
// trades off against prestige.
export function scoreScheduleGroup(group: ScheduleGroup): number {
  const anchor = group.fixtures[0]
  const prestige = anchor ? competitionPrestige(anchor) : 0
  const significance = group.fixtures.reduce((best, ev) => Math.max(best, roundSignificance(ev.round)), 0)
  const hasLive = group.fixtures.some((ev) => ev.isLive)
  return WEIGHT_PRESTIGE * prestige + WEIGHT_SIGNIFICANCE * significance + WEIGHT_LIVE * (hasLive ? 1 : 0)
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

// Groups every fixture by competition and ranks the groups.
//
// `favoriteIds` is SportPreferences.footballLeagueIds — it decides the
// PARTITION (see above) and nothing else; it never affects which
// competitions or fixtures exist.
//
// `competitions` is the canonical registry entry for each competition
// present, as resolved by useScheduleDay — the source of the region/country
// a section header names and flags itself with. Optional: a caller with no
// catalog (or a competition missing from it) still gets a complete, ordered
// schedule, just without that metadata.
export function buildScheduleGroups(
  fixtures: readonly SportEvent[],
  favoriteIds: readonly string[],
  competitions?: ReadonlyMap<string, LeagueDef>,
): ScheduleGroup[] {
  const favorites = new Set(favoriteIds)
  const byCompetition = new Map<string, ScheduleGroup>()

  for (const fixture of fixtures) {
    // leagueId is always set at mapping time (mapEvent.ts); the fallback is
    // for a fixture whose competition the catalog doesn't know, which must
    // still appear rather than vanish into a missing key.
    const competitionId = fixture.leagueId || 'unknown'
    let group = byCompetition.get(competitionId)
    if (!group) {
      const league = competitions?.get(competitionId)
      group = {
        competitionId,
        competitionName: league?.name || fixture.league || 'Other fixtures',
        competitionBadge: league?.badge ?? fixture.leagueBadge,
        region: league?.region,
        countryCode: league?.countryCode,
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

  // Favorites first, absolutely. Then, within each partition: deterministic
  // all the way down — score, then the group's earliest kickoff, then name,
  // then id — so two competitions that genuinely tie still render in a
  // stable order across re-renders and refreshes rather than inheriting Map
  // insertion order (which follows whatever order the API happened to page
  // the events in).
  return groups.sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1
    const byScore = scoreScheduleGroup(b) - scoreScheduleGroup(a)
    if (byScore !== 0) return byScore
    const byTime = kickoffMs(a.fixtures[0]) - kickoffMs(b.fixtures[0])
    if (byTime !== 0) return byTime
    const byName = a.competitionName.localeCompare(b.competitionName)
    if (byName !== 0) return byName
    return a.competitionId.localeCompare(b.competitionId)
  })
}
