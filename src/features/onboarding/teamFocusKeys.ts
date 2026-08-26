// Spatial-navigation focus keys for onboarding step 2's TEAM surfaces —
// the sibling of leagueFocusKeys.ts, and separate from it for the same
// reason: three files need to recognise these keys (the screen's
// focus-rescue effects, the card, the browser's rail), and the prefixes
// have to be distinguishable by a `startsWith` check.
//
// Keys are DERIVED from canonical ids, never written out: the team
// catalogue is fetched at runtime and changes without a release.

// One club tile. Shared by the suggestions row and the browser's grid,
// which is safe because groupTeamsByCompetition and suggestTeams are only
// ever rendered one at a time within a surface — see the screen's own
// dedupe of the two lists.
export const TEAM_FOCUS_PREFIX = 'team-'
export const teamFocusKey = (teamId: string) => `${TEAM_FOCUS_PREFIX}${teamId}`

// A competition row in the team browser's rail. Distinct from the league
// browser's `browse-` prefix so the two panels' rescue effects can't
// mistake one another's rows.
export const TEAM_GROUP_FOCUS_PREFIX = 'teamgroup-'
export const teamGroupFocusKey = (competitionId: string) => `${TEAM_GROUP_FOCUS_PREFIX}${competitionId || 'other'}`
