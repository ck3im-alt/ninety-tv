// "What channels do I want to see while browsing?"
//
// This edits the SAME hiddenCountries/hiddenCategories the Channels filter
// popup does — one source of truth, one storage key pair (see session.ts's
// loadFilters/saveFilters), one meaning for a composite
// `${country}::${category}` key (see favorites.ts's categoryFavoriteKey).
// There is deliberately no settingsHiddenCountries, no second vocabulary and
// no second set of semantics.
//
// Countries on the left, categories for the focused country on the right,
// contained in the pane rather than shown as a modal: the user is already
// inside a Settings screen, so a popup on top of it would be a second layer
// for no reason. Changes apply immediately (no draft/Apply step), matching
// every other preference on this screen.
//
// THIS IS NOW THE ONLY EDITOR FOR THESE PREFERENCES. Channels used to carry
// a FilterPopup of its own — the same two columns over the same two sets,
// behind a staged draft and an "Apply filters" button. It was deleted on
// 2026-08-31 and its toolbar action deep-links here instead (see
// BrowseCascadeScreen's onOpenChannelVisibility): one setting with two
// editors is a divergence waiting to happen, and this was the better half.
import { useEffect, useMemo, useState } from 'react'
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useFocusRecovery } from '../../core/platform'
import { categoryFavoriteKey } from '../channels/favorites'
import { SettingsAction, SettingsColumnHeader, SettingsPaneHeader, SettingsRow } from './settingsPrimitives'
import { PANE_ENTRY_FOCUS_KEY } from './useSettingsFocusable'
import type { ChannelIndex } from '../../data/channelIndex'

const OTHER = 'Other'
const CLEAR_RECENT_FOCUS_KEY = 'settings-clear-recent'

function countryFocusKey(name: string): string {
  return `settings-visibility-country-${name}`
}
// Deliberately NOT scoped by country. Only one country's categories are
// rendered at a time, so the label alone is unique — and more importantly,
// the spatial-navigation library captures a focusable's key at REGISTRATION
// and ignores later changes to it. React reuses these rows across a country
// switch (their React key is the label, which doesn't change), so a
// country-scoped focus key would leave every row registered under the
// PREVIOUS country's key while the code tried to focus the new one: Right
// from the country column silently focused nothing.
function categoryFocusKey(label: string): string {
  return `settings-visibility-category-${label || '(general)'}`
}

export function ChannelVisibilityPane({
  channelIndex,
  hiddenCountries,
  hiddenCategories,
  onChange,
  recentlyWatchedCount,
  onRequestClearRecentlyWatched,
  onLeaveToRail,
}: {
  channelIndex: ChannelIndex
  hiddenCountries: Set<string>
  hiddenCategories: Set<string>
  onChange: (hiddenCountries: Set<string>, hiddenCategories: Set<string>) => void
  recentlyWatchedCount: number
  // Opens the shell's confirmation dialog — clearing history is not
  // undoable, so it is never a single unconfirmed press.
  onRequestClearRecentlyWatched: () => void
  onLeaveToRail: () => void
}) {
  // Reads the prepared index (O(number of countries)) rather than rescanning
  // the combined ~30,000-channel array, rather than a second full scan.
  const countries = useMemo(
    () => channelIndex.getCountries().sort((a, b) => (a.name === OTHER ? 1 : b.name === OTHER ? -1 : b.count - a.count)),
    [channelIndex],
  )
  const [activeCountry, setActiveCountry] = useState<string>(() => countries[0]?.name ?? '')

  useEffect(() => {
    if (countries.length === 0) return
    setActiveCountry((current) => (countries.some((country) => country.name === current) ? current : countries[0].name))
  }, [countries])

  const categories = useMemo(
    () => channelIndex.getCategoriesForCountry(activeCountry).sort((a, b) => b.count - a.count),
    [channelIndex, activeCountry],
  )

  // Toggling visibility never unmounts a row here — both columns render
  // every country/category with a checkmark, so a hidden one stays right
  // where it was. What DOES change them is the channel set itself: a
  // background resync installs a new generation, `channelIndex` changes,
  // and a country or category the user is standing on can simply stop
  // existing mid-press. Same recovery as the other panes rather than the
  // library's "focus my parent", which resolves back through the rail.
  const countryEntries = useMemo(
    () => countries.map((country, index) => ({ id: country.name, focusKey: index === 0 ? PANE_ENTRY_FOCUS_KEY : countryFocusKey(country.name) })),
    [countries],
  )
  const categoryEntries = useMemo(
    () => categories.map((category) => ({ id: category.label, focusKey: categoryFocusKey(category.label) })),
    [categories],
  )
  // PANE_ENTRY_FOCUS_KEY belongs to the first country row while there are
  // any, and to the empty state's own action once there are none — so it is
  // the one anchor that survives either way.
  useFocusRecovery({ items: countryEntries, anchorFocusKey: PANE_ENTRY_FOCUS_KEY })
  useFocusRecovery({ items: categoryEntries, anchorFocusKey: CLEAR_RECENT_FOCUS_KEY })

  function toggleCountry(name: string) {
    const next = new Set(hiddenCountries)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    onChange(next, hiddenCategories)
  }

  function toggleCategory(country: string, label: string) {
    const key = categoryFavoriteKey(country, label)
    const next = new Set(hiddenCategories)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(hiddenCountries, next)
  }

  if (countries.length === 0) {
    return (
      <>
        <SettingsPaneHeader title="Channel visibility" />
        <div className="settings-empty">
          <p className="settings-empty-title">Nothing to hide yet</p>
          <p className="settings-empty-body">Connect a playlist and its countries and categories will show up here.</p>
          <SettingsAction focusKey={PANE_ENTRY_FOCUS_KEY} label="Back to sections" onEnter={onLeaveToRail} onLeft={onLeaveToRail} />
        </div>
      </>
    )
  }

  const firstCategoryKey = categories[0] ? categoryFocusKey(categories[0].label) : undefined

  return (
    <>
      <SettingsPaneHeader title="Channel visibility" hint="Ticked countries and categories appear while browsing Channels." />

      <div className="settings-columns visibility">
        <div className="settings-column">
          <SettingsColumnHeader title="Countries" />
          <div className="settings-list">
            {countries.map((country, index) => (
              <SettingsRow
                // The entry-ness is part of the React key so that if the
                // country list ever changes shape, whichever row is first
                // REMOUNTS and re-registers under PANE_ENTRY_FOCUS_KEY —
                // see the note on categoryFocusKey above for why a changed
                // focusKey alone would not take effect.
                key={`${country.name}-${index === 0 ? 'entry' : 'row'}`}
                focusKey={index === 0 ? PANE_ENTRY_FOCUS_KEY : countryFocusKey(country.name)}
                label={country.name}
                value={country.count.toLocaleString()}
                mark="check"
                selected={!hiddenCountries.has(country.name)}
                onFocus={() => setActiveCountry(country.name)}
                onEnter={() => toggleCountry(country.name)}
                onLeft={onLeaveToRail}
                onRight={() => firstCategoryKey && void setFocus(firstCategoryKey)}
              />
            ))}
          </div>
        </div>

        <div className="settings-column">
          <SettingsColumnHeader title={`Categories in ${activeCountry || '—'}`} />
          <div className="settings-list">
            {categories.length === 0 && <p className="settings-pane-hint">This country has no categories.</p>}
            {categories.map((category, index) => (
              <SettingsRow
                key={category.label || '(general)'}
                focusKey={categoryFocusKey(category.label)}
                label={category.label || 'General'}
                value={category.count.toLocaleString()}
                mark="check"
                // Category visibility is scoped per country — the same label
                // can mean very different things in two lineups, which is why
                // the stored key is composite.
                selected={!hiddenCategories.has(categoryFavoriteKey(activeCountry, category.label))}
                onEnter={() => toggleCategory(activeCountry, category.label)}
                onLeft={() => void setFocus(PANE_ENTRY_FOCUS_KEY)}
                onRight={() => {}}
                // Stated for the same reason as the other panes' lists: the
                // subdued action below this column is short, and geometry
                // across two columns of different heights picked the wrong
                // neighbour on a real 1920x1080 render.
                onUp={index === 0 ? () => {} : () => void setFocus(categoryFocusKey(categories[index - 1].label))}
                onDown={() =>
                  void setFocus(
                    index + 1 < categories.length ? categoryFocusKey(categories[index + 1].label) : CLEAR_RECENT_FOCUS_KEY,
                  )
                }
              />
            ))}
          </div>
          <SettingsAction
            focusKey={CLEAR_RECENT_FOCUS_KEY}
            label={recentlyWatchedCount > 0 ? `Clear recently watched (${recentlyWatchedCount})` : 'Clear recently watched'}
            onEnter={() => {
              if (recentlyWatchedCount > 0) onRequestClearRecentlyWatched()
            }}
            onLeft={() => void setFocus(PANE_ENTRY_FOCUS_KEY)}
            onRight={() => {}}
            onUp={() => categories.length > 0 && void setFocus(categoryFocusKey(categories[categories.length - 1].label))}
            onDown={() => {}}
          />
        </div>
      </div>
    </>
  )
}
