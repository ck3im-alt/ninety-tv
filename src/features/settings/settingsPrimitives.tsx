// Settings' own focusable building blocks.
//
// Deliberately NOT the onboarding card/grid components. Onboarding is a
// full-bleed, one-decision-per-screen wizard; Settings is a dense control
// panel where the same 1920x1080 canvas has to hold a section rail, a
// working area, and a list you can actually scan from a sofa. Reusing
// onboarding's 8-column 150px card grid here is what produced the
// 3000px-tall scrolling page this rebuild replaces.
//
// The two features do share their DATA semantics where it matters — see
// data/sports/competitionGrouping.ts — just not their components.
import { useSettingsFocusable, type SettingsFocusableOptions } from './useSettingsFocusable'
import type { ReactNode } from 'react'

// One row in the left section rail.
export function SettingsRailItem({
  label,
  active,
  focusKey,
  onEnter,
  onFocus,
  onRight,
  onUp,
  onDown,
}: {
  label: string
  active: boolean
  focusKey: string
  onEnter: () => void
  onFocus: () => void
  onRight: () => void
  onUp?: () => void
  onDown?: () => void
}) {
  const { ref, focused } = useSettingsFocusable({
    focusKey,
    onEnter,
    onFocus,
    onRight,
    onUp,
    onDown,
    // Left is the page edge here. Answered explicitly rather than letting
    // the library escape to the screen root, which draws no focus ring at
    // all and reads as "the remote stopped working".
    onLeft: () => {},
  })
  return (
    <button
      ref={ref}
      className={`settings-rail-item ${active ? 'active' : ''} ${focused ? 'focused' : ''}`}
      // A pointer click has to do BOTH halves of what a remote does in two
      // steps — select the section (which a D-pad move does via onFocus) and
      // then enter it. With only onEnter here, clicking a rail row on a
      // touch/mouse build would jump focus into a pane showing the previous
      // section.
      onClick={() => {
        onFocus()
        onEnter()
      }}
    >
      {label}
    </button>
  )
}

// The generic list row: a label, an optional second line, and an optional
// right-hand value. Used for playlists, countries, categories and toggles —
// one shape, so the whole screen scans as one thing from across a room.
export function SettingsRow({
  label,
  sublabel,
  value,
  mark,
  selected,
  muted,
  ...focusOptions
}: SettingsFocusableOptions & {
  label: string
  sublabel?: ReactNode
  value?: ReactNode
  // A leading marker: 'check' for on/off state, 'radio' for one-of-many,
  // undefined for a plain row.
  mark?: 'check' | 'radio'
  selected?: boolean
  // Dimmed, still focusable — an available country at the 5/5 cap, say.
  // Never used to hide a control the user can't reach any other way.
  muted?: boolean
}) {
  const { ref, focused } = useSettingsFocusable(focusOptions)
  return (
    <div
      ref={ref}
      className={`settings-row ${focused ? 'focused' : ''} ${selected ? 'selected' : ''} ${muted ? 'muted' : ''}`}
      // A pointer click does in one gesture what a remote does in two:
      // several rows here drive a preview or a highlighted-item action from
      // onFocus, so activating without focusing first would act on whatever
      // was previously highlighted.
      onClick={() => {
        focusOptions.onFocus?.()
        focusOptions.onEnter?.()
      }}
    >
      {mark && <span className={`settings-mark ${mark} ${selected ? 'on' : ''}`} />}
      <span className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {sublabel && <span className="settings-row-sublabel">{sublabel}</span>}
      </span>
      {value != null && <span className="settings-row-value">{value}</span>}
    </div>
  )
}

export function SettingsAction({
  label,
  tone = 'default',
  ...focusOptions
}: SettingsFocusableOptions & { label: ReactNode; tone?: 'default' | 'primary' | 'danger' }) {
  const { ref, focused } = useSettingsFocusable(focusOptions)
  return (
    <button
      ref={ref}
      className={`settings-action ${tone} ${focused ? 'focused' : ''} ${focusOptions.focusable === false ? 'disabled' : ''}`}
      onClick={focusOptions.onEnter}
    >
      {label}
    </button>
  )
}

export function SettingsPaneHeader({ title, meta, hint }: { title: string; meta?: ReactNode; hint?: string }) {
  return (
    <header className="settings-pane-header">
      <h2 className="settings-pane-title">
        {title}
        {meta != null && <span className="settings-pane-meta">{meta}</span>}
      </h2>
      {hint && <p className="settings-pane-hint">{hint}</p>}
    </header>
  )
}

export function SettingsColumnHeader({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <h3 className="settings-column-title">
      {title}
      {meta != null && <span className="settings-column-meta">{meta}</span>}
    </h3>
  )
}
