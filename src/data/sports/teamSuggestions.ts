// Which clubs to put in front of someone who has just picked their leagues.
//
// Pure and separate from both pickers because "what should we suggest" is a
// product rule with real edge cases (a viewer following four leagues must
// not be shown four Premier League clubs), and it needs to behave
// identically in onboarding and in Settings.
//
// THE TV CONSTRAINT drives the whole shape. This is a remote control, not a
// keyboard: typing a club name is the worst possible first interaction, so
// the default state has to be a short, obviously-relevant list a viewer can
// reach in three or four presses. Search exists in the expanded picker for
// the club that isn't in it — it is the fallback, not the mechanism.
import type { TeamDef } from './teamCatalog'

// One row of the onboarding grid. Small enough to stay one row on a 1920px
// screen, large enough to contain a real answer for someone following two
// or three leagues.
export const SUGGESTED_TEAM_LIMIT = 8

function byProminenceThenName(a: TeamDef, b: TeamDef): number {
  const byProminence = b.prominence - a.prominence
  if (byProminence !== 0) return byProminence
  // Deterministic, so a catalogue with no prominence data at all (an older
  // backend) still produces a stable list rather than reshuffling on every
  // render.
  return a.name.localeCompare(b.name)
}

export interface SuggestTeamsInput {
  // Every team the picker currently has loaded.
  teams: readonly TeamDef[]
  // The viewer's followed competitions, IN THEIR OWN ORDER — the first
  // entry gets the first suggestion slot, which is what makes the list feel
  // like it is about their leagues rather than about football in general.
  competitionIds: readonly string[]
  // Already-followed teams. Always kept, always first: a suggestion list
  // that can silently drop a club the viewer picked a moment ago (because a
  // more prominent one exists) reads as the app forgetting the choice.
  selectedTeamIds: readonly string[]
  limit?: number
}

// Selected teams first, then the most prominent unselected club from each
// followed competition IN TURN, and only then second choices — so following
// the Premier League and Eliteserien produces a mix, not eight English
// clubs. Deterministic throughout.
export function suggestTeams({ teams, competitionIds, selectedTeamIds, limit = SUGGESTED_TEAM_LIMIT }: SuggestTeamsInput): TeamDef[] {
  const byId = new Map(teams.map((team) => [team.id, team]))
  const chosen: TeamDef[] = []
  const taken = new Set<string>()

  for (const id of selectedTeamIds) {
    const team = byId.get(id)
    if (team && !taken.has(id)) {
      taken.add(id)
      chosen.push(team)
    }
  }

  // A queue per followed competition, most prominent first, plus one for
  // everything the followed competitions don't cover (which is what a
  // viewer with no leagues selected, or a catalogue with no domestic
  // competition ids, falls back to).
  const queues: TeamDef[][] = competitionIds.map((competitionId) =>
    teams.filter((team) => team.domesticCompetitionId === competitionId && !taken.has(team.id)).sort(byProminenceThenName),
  )
  const followed = new Set(competitionIds)
  queues.push(
    teams
      .filter((team) => !taken.has(team.id) && !(team.domesticCompetitionId != null && followed.has(team.domesticCompetitionId)))
      .sort(byProminenceThenName),
  )

  // Round-robin: one club from each league, then the next from each, until
  // the list is full or every queue is empty.
  let progressed = true
  while (chosen.length < limit && progressed) {
    progressed = false
    for (const queue of queues) {
      if (chosen.length >= limit) break
      const next = queue.shift()
      if (!next) continue
      if (taken.has(next.id)) continue
      taken.add(next.id)
      chosen.push(next)
      progressed = true
    }
  }

  return chosen
}

export interface TeamGroup {
  // A competition id, or '' for the "everything else" group.
  competitionId: string
  label: string
  teams: TeamDef[]
}

// The expanded picker's master/detail structure: one group per competition,
// followed competitions first (in the viewer's own order), then the rest
// alphabetically. Empty groups are dropped — a rail row that opens onto
// nothing is a dead end with a remote.
export function groupTeamsByCompetition(
  teams: readonly TeamDef[],
  competitionNames: ReadonlyMap<string, string>,
  followedCompetitionIds: readonly string[] = [],
): TeamGroup[] {
  const groups = new Map<string, TeamGroup>()
  for (const team of teams) {
    const competitionId = team.domesticCompetitionId ?? ''
    let group = groups.get(competitionId)
    if (!group) {
      group = {
        competitionId,
        // `competitionNames` only covers the viewer's followed leagues, so a
        // club from anywhere else falls back to the league name the
        // catalogue itself reports (GET /v1/teams'
        // domestic_competition_name) before the catch-all heading.
        label: competitionId
          ? (competitionNames.get(competitionId) ?? team.domesticCompetitionName ?? 'Other competitions')
          : 'Other teams',
        teams: [],
      }
      groups.set(competitionId, group)
    }
    group.teams.push(team)
  }

  const followedRank = new Map(followedCompetitionIds.map((id, index) => [id, index]))
  return [...groups.values()]
    .map((group) => ({ ...group, teams: [...group.teams].sort(byProminenceThenName) }))
    .sort((a, b) => {
      const rankA = followedRank.get(a.competitionId) ?? Number.MAX_SAFE_INTEGER
      const rankB = followedRank.get(b.competitionId) ?? Number.MAX_SAFE_INTEGER
      if (rankA !== rankB) return rankA - rankB
      // The catch-all group last, whatever else happens.
      if ((a.competitionId === '') !== (b.competitionId === '')) return a.competitionId === '' ? 1 : -1
      return a.label.localeCompare(b.label)
    })
}
