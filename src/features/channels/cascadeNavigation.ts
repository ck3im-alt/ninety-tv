import type { CascadeLevel } from './BrowseCascadeScreen'

// Pure decision logic for what a Back press does in the channel cascade
// (Country → Category → Channel → Preview) — pulled out of
// BrowseCascadeScreen's useBackHandler callback so the actual drill-up
// sequence can be unit tested without simulating spatial-nav focus/DOM.
// Search mode is handled by the caller BEFORE calling this (clearing the
// query takes priority over any cascade level) — see BrowseCascadeScreen's
// own back handler.
export type CascadeBackResult = { level: CascadeLevel } | { exit: true }

export function previousCascadeStep(level: CascadeLevel): CascadeBackResult {
  if (level === 'preview') return { level: 'channel' }
  if (level === 'channel') return { level: 'category' }
  if (level === 'category') return { level: 'country' }
  return { exit: true }
}
