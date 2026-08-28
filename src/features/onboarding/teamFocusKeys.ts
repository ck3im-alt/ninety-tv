// Spatial-navigation focus keys for onboarding step 2's TEAM surfaces —
// the sibling of leagueFocusKeys.ts, and separate from it for the same
// reason: three files need to recognise these keys (the screen's
// focus-rescue effects, the card, the browser's rail), and the prefixes
// have to be distinguishable by a `startsWith` check.
//
// Keys are DERIVED from canonical ids, never written out: the team
// catalogue is fetched at runtime and changes without a release.

// One club tile in the BROWSER's grid.
export const TEAM_FOCUS_PREFIX = 'team-'
export const teamFocusKey = (teamId: string) => `${TEAM_FOCUS_PREFIX}${teamId}`

// The same club, in the SUGGESTIONS row above the browser — and a
// deliberately different key space.
//
// The two surfaces genuinely can show the same club at the same time, and
// should: the suggestions are a shortcut into the very catalogue the panel
// browses, so following Manchester United from the suggestions must show it
// ticked in the Premier League grid too. Sharing one key made those two
// tiles two focusables registered under one name, and norigin resolves that
// by keeping whichever it saw last — which is how pressing OK on a club in
// the grid threw focus back to the rail, and why the press sometimes did
// not register at all.
//
// The leagues step never hit this because buildBrowseCatalogue removes every
// recommended competition from the browsable lists, so one id really does
// mean one card there. Teams cannot do the same: hiding the eight suggested
// clubs from their own league's grid would leave a Premier League page
// mysteriously missing Arsenal.
export const SUGGESTED_TEAM_FOCUS_PREFIX = 'suggested-team-'
export const suggestedTeamFocusKey = (teamId: string) => `${SUGGESTED_TEAM_FOCUS_PREFIX}${teamId}`

// A competition row in the team browser's rail. Distinct from the league
// browser's `browse-scope-` prefix so the two panels' rescue effects can't
// mistake one another's chrome.
export const TEAM_GROUP_FOCUS_PREFIX = 'teamgroup-'
export const teamGroupFocusKey = (competitionId: string) => `${TEAM_GROUP_FOCUS_PREFIX}${competitionId || 'other'}`
