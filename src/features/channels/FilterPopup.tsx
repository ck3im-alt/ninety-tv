import { useMemo, useState } from 'react'
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import type { ChannelIndex } from '../../data/channelIndex'
import { useFocusScrollIntoView, useModalFocusScope } from '../../core/platform'
import { categoryFavoriteKey } from './favorites'
import './FilterPopup.css'

const OTHER = 'Other'
const POPUP_FOCUS_KEY = 'filter-popup'
const CLOSE_FOCUS_KEY = 'filter-close'

interface Props {
  // Prepared/indexed view of the playlist (see data/channelIndex.ts) —
  // deliberately UNfiltered by hiddenCountries/hiddenCategories (unlike
  // BrowseCascadeScreen's own consumption of it): this popup must show
  // every country/category, including currently-hidden ones, so the user
  // can re-enable them.
  channelIndex: ChannelIndex
  hiddenCountries: Set<string>
  // Composite `${country}::${category}` keys (see categoryFavoriteKey) —
  // categories are scoped per-country here, not hidden globally, since the
  // same category label can mean very different things from one country's
  // lineup to another's.
  hiddenCategories: Set<string>
  onApply: (hiddenCountries: Set<string>, hiddenCategories: Set<string>) => void
  onClose: () => void
}

function FilterRow({
  focusKey,
  label,
  checked,
  active,
  count,
  onToggle,
  // Countries only — moving focus onto a country row (arrow-scrolling, not
  // just Enter) switches which country's categories the right-hand column
  // shows, same live-preview-on-focus pattern as the main Browse Cascade
  // screen. Enter always toggles visibility now (see the header comment
  // below for why that used to be broken).
  onFocusRow,
}: {
  focusKey?: string
  label: string
  checked: boolean
  active?: boolean
  count: number
  onToggle: () => void
  onFocusRow?: () => void
}) {
  const { ref, focused } = useFocusable({ focusKey, onEnterPress: onToggle, onFocus: onFocusRow })
  useFocusScrollIntoView(ref, focused)
  return (
    <div ref={ref} className={`filter-row ${focused ? 'focused' : ''} ${active ? 'active' : ''}`} onClick={onToggle}>
      <span className={`filter-checkbox ${checked ? 'checked' : ''}`}>{checked ? '✓' : ''}</span>
      <span className="filter-row-label">{label}</span>
      <span className="filter-row-count">{count}</span>
    </div>
  )
}

function ActionButton({
  focusKey,
  label,
  onSelect,
  tone = 'default',
}: {
  focusKey?: string
  label: string
  onSelect: () => void
  tone?: 'default' | 'primary'
}) {
  const { ref, focused } = useFocusable({ focusKey, onEnterPress: onSelect })
  useFocusScrollIntoView(ref, focused)
  return (
    <button ref={ref} className={`filter-action ${tone} ${focused ? 'focused' : ''}`} onClick={onSelect}>
      {label}
    </button>
  )
}

// Two-step-styled (Countries → Categories) filter: pick which countries show
// up while browsing at all, then — per selected country, since the same
// category label can mean different things in different lineups — which of
// that country's categories show. Changes are a local draft until "Apply
// filters"; "Cancel" discards them.
export function FilterPopup({ channelIndex, hiddenCountries, hiddenCategories, onApply, onClose }: Props) {
  const [draftHiddenCountries, setDraftHiddenCountries] = useState(() => new Set(hiddenCountries))
  const [draftHiddenCategories, setDraftHiddenCategories] = useState(() => new Set(hiddenCategories))

  // Reads from the prepared ChannelIndex (O(k), k = country/category count)
  // instead of rescanning the full playlist and re-parseCategory-ing every
  // channel every time the active country changes.
  const countries = useMemo(() => {
    return channelIndex
      .getCountries()
      .sort((a, b) => (a.name === OTHER ? 1 : b.name === OTHER ? -1 : b.count - a.count))
  }, [channelIndex])

  const [activeCountry, setActiveCountry] = useState<string>(() => countries[0]?.name ?? '')

  const categoriesForActiveCountry = useMemo(() => {
    return channelIndex.getCategoriesForCountry(activeCountry).sort((a, b) => b.count - a.count)
  }, [channelIndex, activeCountry])

  const firstCountryFocusKey = countries[0] ? `filter-country-${countries[0].name}` : CLOSE_FOCUS_KEY

  // Captures the opener, becomes the sole Back target, restores the opener
  // on close (isFocusBoundary keeps focus from wandering back out to the
  // still-mounted screen underneath) — see useModalFocusScope's own header
  // for why this used to be reimplemented ad hoc per overlay. Lands on the
  // first country row deterministically (not just "the popup container",
  // which would fall back to geometry) — same first-focus fix as every
  // other screen in this pass.
  const { ref: popupRef, focusKey: popupFocusKey } = useModalFocusScope({
    focusKey: POPUP_FOCUS_KEY,
    onClose,
    preferredChildFocusKey: firstCountryFocusKey,
  })

  const { ref: closeRef, focused: closeFocused } = useFocusable({ focusKey: CLOSE_FOCUS_KEY, onEnterPress: onClose })
  useFocusScrollIntoView(closeRef, closeFocused)

  function toggleCountry(name: string) {
    setDraftHiddenCountries((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function toggleCategory(country: string, label: string) {
    const key = categoryFavoriteKey(country, label)
    setDraftHiddenCategories((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectAllCountries() {
    setDraftHiddenCountries(new Set())
  }
  function deselectAllCountries() {
    setDraftHiddenCountries(new Set(countries.map((c) => c.name)))
  }
  function selectAllCategories() {
    setDraftHiddenCategories((prev) => {
      const next = new Set(prev)
      for (const c of categoriesForActiveCountry) next.delete(categoryFavoriteKey(activeCountry, c.label))
      return next
    })
  }
  function deselectAllCategories() {
    setDraftHiddenCategories((prev) => {
      const next = new Set(prev)
      for (const c of categoriesForActiveCountry) next.add(categoryFavoriteKey(activeCountry, c.label))
      return next
    })
  }

  function handleApply() {
    onApply(draftHiddenCountries, draftHiddenCategories)
    onClose()
  }

  function handleClear() {
    setDraftHiddenCountries(new Set())
    setDraftHiddenCategories(new Set())
  }

  return (
    <div className="filter-overlay" onClick={onClose}>
      <FocusContext.Provider value={popupFocusKey}>
      <div ref={popupRef} className="filter-popup" onClick={(e) => e.stopPropagation()}>
        <div className="filter-header">
          <div>
            <h2 className="filter-title">Filter Channels</h2>
            <p className="filter-note">Choose countries first, then categories for the selected country.</p>
          </div>
          <button ref={closeRef} className={`filter-close ${closeFocused ? 'focused' : ''}`} onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="filter-steps">
          <span className="filter-step active">1. Countries</span>
          <span className="filter-step-track">
            <span className="filter-step-dot" />
          </span>
          <span className="filter-step">2. Categories</span>
        </div>

        <div className="filter-columns">
          <div className="filter-column">
            <div className="filter-column-header">
              <h3 className="filter-column-title">Countries</h3>
              <div className="filter-column-actions">
                <ActionButton focusKey="filter-countries-select-all" label="Select all" onSelect={selectAllCountries} />
                <ActionButton focusKey="filter-countries-deselect-all" label="Deselect all" onSelect={deselectAllCountries} />
              </div>
            </div>
            <div className="filter-list">
              {countries.map((country) => (
                <FilterRow
                  key={country.name}
                  focusKey={`filter-country-${country.name}`}
                  label={country.name}
                  count={country.count}
                  active={country.name === activeCountry}
                  checked={!draftHiddenCountries.has(country.name)}
                  onToggle={() => toggleCountry(country.name)}
                  onFocusRow={() => setActiveCountry(country.name)}
                />
              ))}
            </div>
          </div>

          <div className="filter-column">
            <div className="filter-column-header">
              <h3 className="filter-column-title">
                Categories <span className="filter-column-title-scope">({activeCountry || '—'})</span>
              </h3>
              <div className="filter-column-actions">
                <ActionButton focusKey="filter-categories-select-all" label="Select all" onSelect={selectAllCategories} />
                <ActionButton focusKey="filter-categories-deselect-all" label="Deselect all" onSelect={deselectAllCategories} />
              </div>
            </div>
            <div className="filter-list">
              {categoriesForActiveCountry.map((category) => (
                <FilterRow
                  key={category.label || '(general)'}
                  focusKey={`filter-category-${activeCountry}-${category.label || '(general)'}`}
                  label={category.label || 'General'}
                  count={category.count}
                  checked={!draftHiddenCategories.has(categoryFavoriteKey(activeCountry, category.label))}
                  onToggle={() => toggleCategory(activeCountry, category.label)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="filter-actions">
          <ActionButton focusKey="filter-clear" label="Clear filters" onSelect={handleClear} />
          <ActionButton focusKey="filter-apply" label="Apply filters" onSelect={handleApply} tone="primary" />
          <ActionButton focusKey="filter-cancel" label="Cancel" onSelect={onClose} />
        </div>
      </div>
      </FocusContext.Provider>
    </div>
  )
}
