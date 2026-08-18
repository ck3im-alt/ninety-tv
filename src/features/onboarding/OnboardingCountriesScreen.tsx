import { useMemo } from 'react'
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import type { Channel } from '../../data/channel'
import { parseCategory } from '../channels/parseCategory'
import { flagSrc } from '../../data/countryCodes'
import { OnboardingTopBar } from './OnboardingStepper'
import { SelectableCard } from './OnboardingSportsScreen'
import { ArrowRightIcon, BackArrowIcon } from './sportIcons'
import './onboardingShared.css'
import './OnboardingCountriesScreen.css'

interface CountryOption {
  name: string
  code: string | null
  count: number
}

interface Props {
  channels: Channel[]
  selectedCountries: Set<string>
  onToggleCountry: (name: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onBack: () => void
  onContinue: () => void
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.5 10h15M10 2.5c2.2 2 3.3 4.9 3.3 7.5s-1.1 5.5-3.3 7.5c-2.2-2-3.3-4.9-3.3-7.5S7.8 4.5 10 2.5z" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function StarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 2.5l2.2 4.7 5.1.6-3.8 3.5.9 5.1L10 13.9l-4.4 2.5.9-5.1-3.8-3.5 5.1-.6L10 2.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TuneIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="7" cy="6" r="1.6" fill="currentColor" />
      <circle cx="13" cy="10" r="1.6" fill="currentColor" />
      <circle cx="9" cy="14" r="1.6" fill="currentColor" />
    </svg>
  )
}

export function OnboardingCountriesScreen({
  channels,
  selectedCountries,
  onToggleCountry,
  onSelectAll,
  onDeselectAll,
  onBack,
  onContinue,
}: Props) {
  const { ref, focusKey } = useFocusable({ focusKey: 'onboarding-countries', trackChildren: true })

  // Built from the playlist actually connected in step 1 — not a
  // hardcoded "popular countries" list, since the whole point is to
  // reflect what this user's own lineup actually contains.
  const countries = useMemo<CountryOption[]>(() => {
    const counts = new Map<string, { code: string | null; count: number }>()
    for (const channel of channels) {
      const { countryName, countryCode } = parseCategory(channel.groupTitle || '')
      if (!countryName) continue
      const existing = counts.get(countryName)
      counts.set(countryName, { code: countryCode, count: (existing?.count ?? 0) + 1 })
    }
    return [...counts.entries()]
      .map(([name, { code, count }]) => ({ name, code, count }))
      .sort((a, b) => b.count - a.count)
  }, [channels])

  const { ref: backRef, focused: backFocused } = useFocusable({ onEnterPress: onBack })
  const { ref: continueRef, focused: continueFocused } = useFocusable({ onEnterPress: onContinue })
  const { ref: selectAllRef, focused: selectAllFocused } = useFocusable({ onEnterPress: onSelectAll, forceFocus: true })
  const { ref: deselectAllRef, focused: deselectAllFocused } = useFocusable({ onEnterPress: onDeselectAll })

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} className="onboarding-screen">
        <OnboardingTopBar current={3} />

        <div className="onboarding-info">
          <h1 className="onboarding-headline">
            Choose your
            <br />
            <span className="accent">favorite</span> countries
          </h1>
          <p className="onboarding-description">
            Select the countries you want to follow. We'll show you more relevant channels and events.
          </p>

          <ul className="onboarding-features">
            <li>
              <GlobeIcon />
              <div>
                <p className="feature-title">Personalized channels</p>
                <p className="feature-desc">Get channels and content from your favorite countries.</p>
              </div>
            </li>
            <li>
              <StarIcon />
              <div>
                <p className="feature-title">Relevant matches</p>
                <p className="feature-desc">See more matches and events that matter to you.</p>
              </div>
            </li>
            <li>
              <TuneIcon />
              <div>
                <p className="feature-title">Easy to change</p>
                <p className="feature-desc">Update your preferences anytime in settings.</p>
              </div>
            </li>
          </ul>

          <div className="onboarding-footer-actions">
            <button ref={backRef} className={`back-button ${backFocused ? 'focused' : ''}`} onClick={onBack}>
              <BackArrowIcon /> Back
            </button>
          </div>
        </div>

        <div className="onboarding-picker">
          <div className="picker-section-header">
            <h2 className="picker-section-title">Popular countries</h2>
            <div className="picker-section-actions">
              <button
                ref={deselectAllRef}
                className={`picker-section-action ${deselectAllFocused ? 'focused' : ''}`}
                onClick={onDeselectAll}
              >
                Deselect all
              </button>
              <button
                ref={selectAllRef}
                className={`picker-section-action primary ${selectAllFocused ? 'focused' : ''}`}
                onClick={onSelectAll}
              >
                Select all
              </button>
            </div>
          </div>

          {countries.length === 0 ? (
            <p className="countries-empty">
              Couldn't detect any country names in your playlist's categories — you can still browse everything
              normally, this step just personalizes what's shown first.
            </p>
          ) : (
            <div className="countries-grid">
              {countries.map((country) => (
                <SelectableCard
                  key={country.name}
                  focusKey={`country-${country.name}`}
                  selected={selectedCountries.has(country.name)}
                  onToggle={() => onToggleCountry(country.name)}
                >
                  <div className="pick-card-icon round">
                    {country.code && flagSrc(country.code) && <img src={flagSrc(country.code)!} alt="" />}
                  </div>
                  <span className="pick-card-label">{country.name}</span>
                  <span className="pick-card-sublabel">{country.count} channels</span>
                </SelectableCard>
              ))}
            </div>
          )}

          <button ref={continueRef} className={`continue-button ${continueFocused ? 'focused' : ''}`} onClick={onContinue}>
            Continue <ArrowRightIcon />
          </button>
        </div>
      </main>
    </FocusContext.Provider>
  )
}
