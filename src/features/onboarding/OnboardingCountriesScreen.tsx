import { useCallback, useEffect, useMemo } from 'react'
import { FocusContext, useFocusable, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler } from '../../core/platform'
import { flagSrc } from '../../data/countryCodes'
import { MAX_PREFERRED_COUNTRIES } from '../../data/preferences'
import type { PlaylistCountry } from '../../data/viewerCountry'
import { buildRecommendedCountries, type RecommendedCountry } from './recommendedCountries'
import { chunkIntoRows, isRowEdge, lastRowEntry, verticalNeighbour, type FocusChain } from './focusChain'
import { OnboardingExpander } from './OnboardingExpander'
import { useOnboardingLanding } from './useOnboardingLanding'
import { OnboardingTopBar } from './OnboardingStepper'
import { BLOCK_ARROW, SelectableCard } from './SelectableCard'
import {
  ONBOARDING_BACK_FOCUS_KEY,
  ONBOARDING_PRIMARY_FOCUS_KEY,
  ONBOARDING_SECONDARY_FOCUS_KEY,
  OnboardingFooter,
} from './OnboardingActions'
import './onboardingShared.css'
import './OnboardingCountriesScreen.css'

const COUNTRIES_TOGGLE_FOCUS_KEY = 'countries-toggle'
// Matches .countries-grid's own `repeat(5, 1fr)` -- see
// OnboardingCountriesScreen.css. Five is also MAX_PREFERRED_COUNTRIES, so
// the recommended set is exactly one full row. Feeds the row model in
// focusChain.ts.
const GRID_COLUMNS = 5

const countryKey = (name: string) => `country-${name}`

interface Props {
  // Every country the connected playlist actually contains, biggest first
  // (data/viewerCountry.ts's playlistCountries). Empty when step 1 was
  // skipped -- the screen still works, it just recommends from the detected
  // home country and the global fallbacks instead.
  availableCountries: readonly PlaylistCountry[]
  // Canonical ISO2-ish code for the TV's own country, or null.
  viewerCountryCode: string | null
  // ORDERED, capped at MAX_PREFERRED_COUNTRIES by the owning flow (see
  // preferences.ts's withCountryToggled) -- the first entry is the primary
  // country, badged as such below.
  selectedCountries: readonly string[]
  showAllCountries: boolean
  onToggleShowAllCountries: () => void
  onToggleCountry: (name: string) => void
  onClearSelection: () => void
  onBack: () => void
  onFinish: () => void
}

export function OnboardingCountriesScreen({
  availableCountries,
  viewerCountryCode,
  selectedCountries,
  showAllCountries,
  onToggleShowAllCountries,
  onToggleCountry,
  onClearSelection,
  onBack,
  onFinish,
}: Props) {
  // PINNED, exactly like the league step's recommended row: the detected home
  // country, up to two neighbouring markets, the UK and the US -- filtered
  // to what the playlist actually carries and topped up from its biggest
  // remaining countries. See recommendedCountries.ts.
  const recommended = useMemo(
    () => buildRecommendedCountries({ homeCountryCode: viewerCountryCode, available: availableCountries }),
    [viewerCountryCode, availableCountries],
  )

  // The pinned row also keeps anything the user picked out of the appended
  // list. Without that, selecting (say) Germany from "More countries" and
  // closing again hides it while it still counts against the 5-country cap
  // -- visibly 5/5 selected with only four of them on screen, and no way to
  // deselect it without opening the list again.
  const pinned = useMemo<RecommendedCountry[]>(() => {
    const shown = new Set(recommended.map((c) => c.name))
    return [
      ...recommended,
      ...availableCountries.filter((c) => selectedCountries.includes(c.name) && !shown.has(c.name)),
    ]
  }, [recommended, availableCountries, selectedCountries])

  // APPENDED below the expander when open -- never a replacement for the
  // pinned row, and with every pinned name removed so no country renders
  // twice (which would also mean two focusables sharing one
  // `country-<name>` key).
  const rest = useMemo<RecommendedCountry[]>(() => {
    const shown = new Set(pinned.map((c) => c.name))
    return availableCountries.filter((c) => !shown.has(c.name))
  }, [pinned, availableCountries])

  const canShowAll = rest.length > 0
  const expanded = showAllCountries && canShowAll

  // Every focusable row of the picker surface, top to bottom, in render
  // order -- see focusChain.ts. The same row model every other onboarding
  // surface uses, so partial rows and the pinned/appended boundary need no
  // per-card special cases.
  const chain = useMemo<FocusChain>(() => {
    const rows: string[][] = [...chunkIntoRows(pinned.map((c) => countryKey(c.name)), GRID_COLUMNS)]
    if (canShowAll) rows.push([COUNTRIES_TOGGLE_FOCUS_KEY])
    if (expanded) rows.push(...chunkIntoRows(rest.map((c) => countryKey(c.name)), GRID_COLUMNS))
    return rows
  }, [pinned, canShowAll, expanded, rest])

  const arrowsFor = useCallback(
    (key: string) => ({
      onArrowUp: () => {
        const target = verticalNeighbour(chain, key, 'up')
        if (target) void setFocus(target)
      },
      onArrowDown: () => {
        void setFocus(verticalNeighbour(chain, key, 'down') ?? ONBOARDING_PRIMARY_FOCUS_KEY)
      },
      onArrowLeft: isRowEdge(chain, key, 'left') ? BLOCK_ARROW : undefined,
      onArrowRight: isRowEdge(chain, key, 'right') ? BLOCK_ARROW : undefined,
    }),
    [chain],
  )

  const firstCardFocusKey = pinned[0] ? countryKey(pinned[0].name) : undefined

  // Arriving here means pressing OK on the previous step's Continue, which
  // leaves focus on a footer key this step re-registers under the same name
  // — so nothing goes stale and preferredChildFocusKey below is never
  // re-resolved. Without this the step opened with "Finish setup" focused,
  // one OK press from completing onboarding without the viewer ever seeing
  // the countries. See useOnboardingLanding.
  useOnboardingLanding(firstCardFocusKey ?? null)

  // preferredChildFocusKey (not just the first card's forceFocus, which
  // only applies on mount): the flow re-focuses this screen's own root key
  // on every step change, including arriving back here after stepping back
  // to Teams -- see OnboardingFlow's STEP_FOCUS_KEYS. Falls back to the
  // primary action so a playlist-less, undetected-country viewer with no
  // cards at all can still reach Finish setup.
  const { ref, focusKey } = useFocusable({
    focusKey: 'onboarding-countries',
    trackChildren: true,
    preferredChildFocusKey: firstCardFocusKey ?? ONBOARDING_PRIMARY_FOCUS_KEY,
  })

  // "Clear selection" only exists while something IS selected, so clearing
  // via the remote unmounts the very button that was focused. Hand focus to
  // Back (its neighbour in the same footer group) rather than leaving it on
  // a removed component.
  useEffect(() => {
    if (selectedCountries.length === 0 && getCurrentFocusKey() === ONBOARDING_SECONDARY_FOCUS_KEY) {
      void setFocus(ONBOARDING_BACK_FOCUS_KEY)
    }
  }, [selectedCountries.length])

  // Closing the appended list unmounts its cards. Focus is normally already
  // on the expander (that is what was pressed), but no other route into a
  // close may leave focus pointing at a removed card.
  useEffect(() => {
    if (expanded) return
    const current = getCurrentFocusKey()
    if (!current.startsWith('country-')) return
    if (!pinned.some((c) => countryKey(c.name) === current)) void setFocus(COUNTRIES_TOGGLE_FOCUS_KEY)
  }, [expanded, pinned])

  // "Unwind the innermost thing first" Back behaviour, via
  // the existing back-handler stack. Focus moves BEFORE the state change so
  // no card is unmounted while focused.
  useBackHandler(() => {
    if (expanded) {
      void setFocus(COUNTRIES_TOGGLE_FOCUS_KEY)
      onToggleShowAllCountries()
      return true
    }
    onBack()
    return true
  })

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} className="onboarding-screen">
        <OnboardingTopBar current={4} />

        <div className="onboarding-heading">
          <h1 className="onboarding-headline">
            Choose your preferred <span className="accent">countries</span>
          </h1>
          <p className="onboarding-description">
            {/* Says out loud what this preference does and — just as
                importantly — what it does not do. It used to quietly hide
                every other country's channels from Channels; see
                rankCountries.ts. */}
            We'll put streams from these countries first when several options are available. Nothing is ever hidden —
            your whole playlist stays browsable. Your first pick is your primary country.
          </p>
        </div>

        <div className="onboarding-body">
          {pinned.length === 0 ? (
            <p className="countries-empty">
              Couldn't detect any countries to suggest yet — you can still browse everything normally, and set this up
              later in Settings once a playlist is connected.
            </p>
          ) : (
            <section className="onboarding-section">
              <div className="picker-section-header">
                <h2 className="picker-section-title">
                  Recommended
                  <span className="picker-section-counter">
                    {selectedCountries.length}/{MAX_PREFERRED_COUNTRIES} selected
                  </span>
                </h2>
              </div>

              <div className="countries-grid">
                {pinned.map((country, index) => (
                  <CountryCard
                    key={country.name}
                    country={country}
                    selected={selectedCountries.includes(country.name)}
                    isPrimary={selectedCountries[0] === country.name}
                    onToggle={() => onToggleCountry(country.name)}
                    forceFocus={index === 0}
                    arrows={arrowsFor(countryKey(country.name))}
                  />
                ))}
              </div>

              {/* Stable position, stable focusKey — the appended list goes
                  BELOW this control, so it never moves out from under the
                  focus ring. The last expander left in onboarding: the
                  league and team steps replaced theirs with always-open
                  browser panels. */}
              {canShowAll && (
                <OnboardingExpander
                  focusKey={COUNTRIES_TOGGLE_FOCUS_KEY}
                  expanded={expanded}
                  moreLabel="More countries"
                  fewerLabel="Show fewer"
                  chain={chain}
                  onToggle={onToggleShowAllCountries}
                />
              )}
            </section>
          )}

          {expanded && (
            <section className="onboarding-section countries-catalogue">
              <h2 className="picker-section-title">
                All countries
                <span className="picker-section-counter">{rest.length} more in your playlist</span>
              </h2>
              <div className="countries-grid">
                {rest.map((country) => (
                  <CountryCard
                    key={country.name}
                    country={country}
                    selected={selectedCountries.includes(country.name)}
                    isPrimary={selectedCountries[0] === country.name}
                    onToggle={() => onToggleCountry(country.name)}
                    arrows={arrowsFor(countryKey(country.name))}
                  />
                ))}
              </div>
            </section>
          )}
        </div>

        <OnboardingFooter
          onBack={onBack}
          secondary={selectedCountries.length > 0 ? { label: 'Clear selection', onPress: onClearSelection } : undefined}
          primary={{ label: 'Finish setup', onPress: onFinish }}
          upFocusKey={lastRowEntry(chain) ?? undefined}
        />
      </main>
    </FocusContext.Provider>
  )
}

function CountryCard({
  country,
  selected,
  isPrimary,
  onToggle,
  forceFocus,
  arrows,
}: {
  country: RecommendedCountry
  selected: boolean
  isPrimary: boolean
  onToggle: () => void
  forceFocus?: boolean
  arrows: {
    onArrowUp: () => void
    onArrowDown: () => void
    onArrowLeft?: () => void
    onArrowRight?: () => void
  }
}) {
  const flag = country.code ? flagSrc(country.code) : null
  return (
    <SelectableCard
      focusKey={countryKey(country.name)}
      selected={selected}
      onToggle={onToggle}
      forceFocus={forceFocus}
      {...arrows}
    >
      <div className="pick-card-icon round">{flag && <img src={flag} alt="" />}</div>
      <span className="pick-card-label">{country.name}</span>
      <span className="pick-card-sublabel">
        {isPrimary ? (
          <span className="pick-card-primary">Primary</span>
        ) : country.count > 0 ? (
          `${country.count} channels`
        ) : (
          'Suggested'
        )}
      </span>
    </SelectableCard>
  )
}
