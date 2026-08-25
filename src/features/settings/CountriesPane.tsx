// "Which countries should Ninety prioritize?"
//
// Edits SportPreferences.favoriteCountries — an ORDERED list where index 0
// is the primary market and everything in it boosts stream ranking (see
// buildEventStreamOptions.ts and viewerMarket.ts). There is no separate
// persisted primary field to drift out of sync; primary IS first.
//
// What Settings adds over onboarding's "first pick wins" is a way to change
// that first pick without deselecting and reselecting countries in the right
// order — which is both tedious and easy to get silently wrong.
import { useEffect, useState } from 'react'
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { MAX_PREFERRED_COUNTRIES } from '../../data/preferences'
import { flagSrc } from '../../data/countryCodes'
import { SettingsAction, SettingsColumnHeader, SettingsPaneHeader, SettingsRow } from './settingsPrimitives'
import { PANE_ENTRY_FOCUS_KEY } from './useSettingsFocusable'

const MAKE_PRIMARY_FOCUS_KEY = 'settings-country-make-primary'
const REMOVE_FOCUS_KEY = 'settings-country-remove'

export interface CountryOption {
  name: string
  code: string | null
  count: number
}

// Same reason as the Playlists pane: the preferred list and the action bar
// beneath it form one vertical chain, and geometry across two columns of
// different heights is not reliable enough to leave it implicit.
function selectedFocusKey(name: string, index: number): string {
  return index === 0 ? PANE_ENTRY_FOCUS_KEY : `settings-country-selected-${name}`
}
function availableFocusKey(name: string): string {
  return `settings-country-available-${name}`
}

export function CountriesPane({
  selected,
  available,
  onAdd,
  onRemove,
  onMakePrimary,
  onLeaveToRail,
}: {
  // In priority order — [0] is primary.
  selected: string[]
  // Every country the COMBINED channel set (all connected playlists) offers.
  available: CountryOption[]
  onAdd: (name: string) => void
  onRemove: (name: string) => void
  onMakePrimary: (name: string) => void
  onLeaveToRail: () => void
}) {
  const [highlighted, setHighlighted] = useState<string | null>(selected[0] ?? null)

  useEffect(() => {
    if (selected.length === 0) {
      setHighlighted(null)
      return
    }
    setHighlighted((current) => (current && selected.includes(current) ? current : selected[0]))
  }, [selected])

  const atCap = selected.length >= MAX_PREFERRED_COUNTRIES
  const unselected = available.filter((country) => !selected.includes(country.name))
  const byName = new Map(available.map((country) => [country.name, country]))
  const isPrimary = highlighted != null && selected[0] === highlighted
  const firstAvailableKey = unselected[0] ? availableFocusKey(unselected[0].name) : PANE_ENTRY_FOCUS_KEY
  const lastSelectedKey =
    selected.length > 0 ? selectedFocusKey(selected[selected.length - 1], selected.length - 1) : MAKE_PRIMARY_FOCUS_KEY

  return (
    <>
      <SettingsPaneHeader
        title="Countries"
        meta={`${selected.length} / ${MAX_PREFERRED_COUNTRIES}`}
        hint="Preferred countries rank streams higher. Your primary country ranks highest. Nothing is ever hidden by this."
      />

      <div className="settings-columns countries">
        <div className="settings-column">
          <SettingsColumnHeader title="Preferred" />
          <div className="settings-list">
            {selected.length === 0 && <p className="settings-pane-hint">No preferred countries yet — add one from the right.</p>}
            {selected.map((name, index) => (
              <SettingsRow
                // Entry-ness is part of the React key so a "Make primary"
                // reorder remounts the new first row under
                // PANE_ENTRY_FOCUS_KEY — the spatial-navigation library
                // captures a focusable's key at REGISTRATION and ignores
                // later changes to it.
                key={`${name}-${index === 0 ? 'entry' : 'row'}`}
                // The first preferred country is the pane entry when there is
                // one; otherwise the available list takes over, so "Right
                // from the rail" always lands on something real.
                focusKey={selectedFocusKey(name, index)}
                label={name}
                sublabel={index === 0 ? 'Primary' : undefined}
                value={<CountryFlag code={byName.get(name)?.code ?? null} />}
                selected={name === highlighted}
                onFocus={() => setHighlighted(name)}
                // Enter moves to the actions rather than guessing between
                // "remove" and "make primary" — the same list-then-actions
                // shape the Playlists pane uses.
                onEnter={() => void setFocus(MAKE_PRIMARY_FOCUS_KEY)}
                onLeft={onLeaveToRail}
                onRight={() => void setFocus(firstAvailableKey)}
                onUp={index === 0 ? () => {} : () => void setFocus(selectedFocusKey(selected[index - 1], index - 1))}
                onDown={() =>
                  void setFocus(
                    index + 1 < selected.length ? selectedFocusKey(selected[index + 1], index + 1) : MAKE_PRIMARY_FOCUS_KEY,
                  )
                }
              />
            ))}
          </div>

          <div className="settings-inline-actions">
            <SettingsAction
              focusKey={MAKE_PRIMARY_FOCUS_KEY}
              label={isPrimary ? 'Already primary' : 'Make primary'}
              onEnter={() => {
                if (highlighted && !isPrimary) onMakePrimary(highlighted)
              }}
              onLeft={onLeaveToRail}
              onRight={() => void setFocus(REMOVE_FOCUS_KEY)}
              onUp={() => void setFocus(lastSelectedKey)}
              onDown={() => {}}
            />
            <SettingsAction
              focusKey={REMOVE_FOCUS_KEY}
              label="Remove"
              onEnter={() => highlighted && onRemove(highlighted)}
              onLeft={() => void setFocus(MAKE_PRIMARY_FOCUS_KEY)}
              onRight={() => void setFocus(firstAvailableKey)}
              onUp={() => void setFocus(lastSelectedKey)}
              onDown={() => {}}
            />
          </div>
        </div>

        <div className="settings-column">
          <SettingsColumnHeader title="Available" meta={atCap ? `Limit reached (${MAX_PREFERRED_COUNTRIES})` : undefined} />
          <div className="settings-list">
            {unselected.length === 0 && (
              <p className="settings-pane-hint">
                Connect a playlist to choose from the countries it carries.
              </p>
            )}
            {unselected.map((country, index) => (
              <SettingsRow
                key={`${country.name}-${selected.length === 0 && index === 0 ? 'entry' : 'row'}`}
                focusKey={selected.length === 0 && index === 0 ? PANE_ENTRY_FOCUS_KEY : availableFocusKey(country.name)}
                label={country.name}
                value={`${country.count.toLocaleString()} channels`}
                // Dimmed but still reachable at the cap: the row explains
                // itself, and silently dropping one of the user's existing
                // choices to make room would be worse than doing nothing.
                muted={atCap}
                onEnter={() => {
                  if (!atCap) onAdd(country.name)
                }}
                onLeft={() => void setFocus(selected[0] ? PANE_ENTRY_FOCUS_KEY : MAKE_PRIMARY_FOCUS_KEY)}
                onRight={() => {}}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function CountryFlag({ code }: { code: string | null }) {
  const src = code ? flagSrc(code) : null
  if (!src) return null
  return <img className="settings-flag" src={src} alt="" />
}
