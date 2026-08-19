import { useEffect, useMemo, useState } from 'react'
import { FocusContext, getCurrentFocusKey, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import type { ChannelIndex } from '../../data/channelIndex'
import { useBackHandler } from '../../core/platform'
import { categoryFavoriteKey } from './favorites'
import './FilterPopup.css'

const OTHER = 'Other'
const POPUP_FOCUS_KEY = 'filter-popup'

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
  label,
  checked,
  active,
  count,
  onToggle,
  onSelect,
}: {
  label: string
  checked: boolean
  active?: boolean
  count: number
  onToggle: () => void
  onSelect?: () => void
}) {
  const { ref, focused } = useFocusable({ onEnterPress: onSelect ?? onToggle })
  return (
    <div
      ref={ref}
      className={`filter-row ${focused ? 'focused' : ''} ${active ? 'active' : ''}`}
      onClick={onSelect ?? onToggle}
    >
      <span
        className={`filter-checkbox ${checked ? 'checked' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        {checked ? '✓' : ''}
      </span>
      <span className="filter-row-label">{label}</span>
      <span className="filter-row-count">{count}</span>
    </div>
  )
}

function ActionButton({ label, onSelect, tone = 'default' }: { label: string; onSelect: () => void; tone?: 'default' | 'primary' }) {
  const { ref, focused } = useFocusable({ onEnterPress: onSelect })
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

  const { ref: closeRef, focused: closeFocused } = useFocusable({ onEnterPress: onClose })

  // The screen underneath stays mounted (and keeps its own focused row)
  // while this overlay is open — without explicitly moving focus in here,
  // arrow presses keep driving that now-hidden background list instead of
  // the popup, which reads as "the popup's arrows don't work" even though
  // its rows are perfectly navigable once focus is actually inside them.
  // isFocusBoundary keeps focus from wandering back out once it's in.
  const { ref: popupRef, focusKey: popupFocusKey } = useFocusable({
    focusKey: POPUP_FOCUS_KEY,
    trackChildren: true,
    isFocusBoundary: true,
  })

  useEffect(() => {
    // The screen underneath stays mounted, so its previously-focused row is
    // still a valid target — remember it and hand focus back on close
    // instead of leaving nothing focused (which would silently break arrow
    // keys again, same as never focusing the popup in the first place).
    const previousFocusKey = getCurrentFocusKey()
    void setFocus(POPUP_FOCUS_KEY)
    return () => {
      void setFocus(previousFocusKey)
    }
  }, [])

  // Without this, Back/Escape falls through to whatever handler the
  // (still-mounted, just hidden) screen behind this overlay registered —
  // closing the popup with the X button worked, but the remote's Back
  // button silently did something to the invisible screen underneath.
  useBackHandler(() => {
    onClose()
    return true
  })

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
                <ActionButton label="Select all" onSelect={selectAllCountries} />
                <ActionButton label="Deselect all" onSelect={deselectAllCountries} />
              </div>
            </div>
            <div className="filter-list">
              {countries.map((country) => (
                <FilterRow
                  key={country.name}
                  label={country.name}
                  count={country.count}
                  checked={!draftHiddenCountries.has(country.name)}
                  active={country.name === activeCountry}
                  onToggle={() => toggleCountry(country.name)}
                  onSelect={() => setActiveCountry(country.name)}
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
                <ActionButton label="Select all" onSelect={selectAllCategories} />
                <ActionButton label="Deselect all" onSelect={deselectAllCategories} />
              </div>
            </div>
            <div className="filter-list">
              {categoriesForActiveCountry.map((category) => (
                <FilterRow
                  key={category.label || '(general)'}
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
          <ActionButton label="Clear filters" onSelect={handleClear} />
          <ActionButton label="Apply filters" onSelect={handleApply} tone="primary" />
          <ActionButton label="Cancel" onSelect={onClose} />
        </div>
      </div>
      </FocusContext.Provider>
    </div>
  )
}
