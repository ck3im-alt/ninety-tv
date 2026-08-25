// Every spatial-navigation focus key on onboarding step 2's league
// surfaces, in one place.
//
// Kept out of the components that use them because three different files
// need to recognise these keys — the screen (to rescue focus when a surface
// unmounts), the card, and the browser's region rail — and because the
// naming rule matters: keys are DERIVED from catalog ids and group keys,
// never written out. Nothing in this app may hardcode `league-premier-
// league`; the catalog is fetched at runtime and changes without a release.
//
// The two prefixes are distinct so a `startsWith` check can tell "focus is
// on a competition card" from "focus is on a region row" — which is exactly
// what the screen's focus-rescue effects need after a surface disappears.

// A competition tile. Shared by the pinned recommendations row and the
// browser's grid, which is safe because groupExpandedLeagues excludes every
// recommended id from the groups: one competition, one card, one key.
export const LEAGUE_FOCUS_PREFIX = 'league-'
export const leagueFocusKey = (competitionId: string) => `${LEAGUE_FOCUS_PREFIX}${competitionId}`

// A region row in the browser's rail. Takes a LeagueGroup's own `key`
// (`region:England`, `international`), which is already unique and stable.
export const REGION_FOCUS_PREFIX = 'browse-'
export const regionFocusKey = (groupKey: string) => `${REGION_FOCUS_PREFIX}${groupKey}`
