// The Settings section model — pure, so the rail's contents, its initial
// selection and its wrap-free Up/Down behaviour are testable without
// mounting a focus tree.
//
// Five sections, deliberately. They are the five questions Settings exists
// to answer: where does my TV content come from, what do I follow, which
// countries matter to me, what should Ninety recommend and how should it
// rank streams, and what do I want to see while browsing. Anything that
// doesn't answer one of those belongs somewhere else (or nowhere).
//
// 'playback' became 'personalisation' on 2026-08-28. That section had
// exactly one control (stream-type ranking) and was named after a
// mechanism; it now also owns Home's content-breadth mode, which is not a
// playback concept at all. Renamed rather than joined by a sixth rail
// destination — five is already the most a vertical rail should ask a
// D-pad to walk — and renamed in full, id included, because keeping an
// internal route name that no longer describes its own contents is how a
// codebase starts lying about itself.
export type SettingsSectionId = 'playlists' | 'sports' | 'countries' | 'personalisation' | 'visibility'

export interface SettingsSection {
  id: SettingsSectionId
  label: string
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'playlists', label: 'Playlists' },
  { id: 'sports', label: 'Sports & leagues' },
  { id: 'countries', label: 'Countries' },
  { id: 'personalisation', label: 'Personalisation' },
  { id: 'visibility', label: 'Channel visibility' },
]

// Playlists, not the first preference the old screen happened to render.
// It is the most concrete and most actionable section — "where does my TV
// content come from" — and it's the one a user opening Settings after
// something went wrong is looking for.
export const INITIAL_SETTINGS_SECTION: SettingsSectionId = 'playlists'

export function railFocusKey(id: SettingsSectionId): string {
  return `settings-rail-${id}`
}

export function isRailFocusKey(focusKey: string | null | undefined): boolean {
  return typeof focusKey === 'string' && focusKey.startsWith('settings-rail-')
}

// Deliberately clamped, not wrapping: on a five-item vertical rail, wrapping
// from the last item back to the first is disorienting with a D-pad — the
// highlight appears to jump the length of the screen for a single press.
export function adjacentSection(id: SettingsSectionId, delta: 1 | -1): SettingsSectionId {
  const index = SETTINGS_SECTIONS.findIndex((section) => section.id === id)
  if (index === -1) return id
  const next = index + delta
  if (next < 0 || next >= SETTINGS_SECTIONS.length) return id
  return SETTINGS_SECTIONS[next].id
}
