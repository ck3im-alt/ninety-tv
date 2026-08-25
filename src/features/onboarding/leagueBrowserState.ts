// Pure state helpers for onboarding step 2's master/detail league browser.
//
// The browser shows ONE region at a time: a rail of region rows on the
// left, that region's competitions on the right. This module owns the two
// derived facts that drives — which region is active, and how much the user
// has picked inside each one — so the component stays a renderer and both
// rules are testable without a DOM.
//
// It deliberately does NOT re-group anything: groupExpandedLeagues.ts is
// still the single source of the grouping, its ordering and its
// recommended-id exclusion. This module only reads that result.
import type { LeagueGroup } from './groupExpandedLeagues'

// Which region the browser opens on.
//
// groupExpandedLeagues already sorts its output by exactly the priority
// this needs — the viewer's own region first (when it still has any
// competitions left after the recommended ones are removed), then the
// international competitions, then everything else alphabetically — so the
// default is simply the first group, NOT an alphabetical accident like
// Argentina for a Norwegian viewer. Stated as its own named function
// (rather than an inline `groups[0]`) because "the browser opens on the
// viewer's own region" is a product rule that deserves a test of its own;
// if the group ordering ever stops encoding it, that test fails here rather
// than silently degrading the browser.
export function defaultActiveRegionKey(groups: readonly LeagueGroup[]): string | null {
  return groups[0]?.key ?? null
}

// The group the browser should currently render, given whatever region the
// user last focused.
//
// Falls back to the default rather than rendering nothing when the stored
// key no longer exists — which genuinely happens: the catalog arrives
// asynchronously and the viewer's country resolves asynchronously, so the
// group list can change shape underneath a remembered key (and a region
// whose every competition is recommended disappears entirely).
export function resolveActiveGroup(groups: readonly LeagueGroup[], activeKey: string | null): LeagueGroup | null {
  const key = groups.some((group) => group.key === activeKey) ? activeKey : defaultActiveRegionKey(groups)
  return groups.find((group) => group.key === key) ?? null
}

// How many of a region's competitions the user has selected. Derived from
// the flow's own `selectedLeagues` set on every render — the rail never
// keeps a selection model of its own to fall out of sync.
export function selectedCountIn(group: LeagueGroup, selectedLeagues: ReadonlySet<string>): number {
  let count = 0
  for (const league of group.leagues) if (selectedLeagues.has(league.id)) count += 1
  return count
}
