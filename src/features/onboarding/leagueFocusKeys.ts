// Every spatial-navigation focus key on onboarding step 2's league
// surfaces, in one place.
//
// Kept out of the components that use them because three different files
// need to recognise these keys — the screen (to rescue focus when a surface
// unmounts), the card, and the browser's scope tabs — and because the
// naming rule matters: keys are DERIVED from catalog ids and scope names,
// never written out. Nothing in this app may hardcode `league-premier-
// league`; the catalog is fetched at runtime and changes without a release.
//
// The two prefixes are distinct so a `startsWith` check can tell "focus is
// on a competition card" from "focus is on the browser's own chrome" —
// which is exactly what the screen's focus-rescue effects need after a
// surface disappears.

// A competition tile. Shared by the pinned recommendations row and the
// browser's grid, which is safe because buildBrowseCatalogue excludes every
// recommended id from the browsable lists: one competition, one card, one
// key. (The browser also mounts only ONE page at a time, so the same id
// cannot be live twice within the grid either.)
export const LEAGUE_FOCUS_PREFIX = 'league-'
export const leagueFocusKey = (competitionId: string) => `${LEAGUE_FOCUS_PREFIX}${competitionId}`

// A scope tab in the browser's header — Domestic / International. Takes a
// BrowseScope, which is a closed two-value union, so these keys are stable
// and cannot collide with a catalog id.
//
// This replaced the region rail's `browse-<region key>` keys when the rail
// was removed (2026-08-28); the prefix keeps the `browse-` stem so the
// screen's "focus is somewhere inside the league browser" check reads the
// same as it always did.
export const SCOPE_FOCUS_PREFIX = 'browse-scope-'
export const scopeFocusKey = (scope: string) => `${SCOPE_FOCUS_PREFIX}${scope}`
