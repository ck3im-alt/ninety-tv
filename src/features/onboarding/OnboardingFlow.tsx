import { useEffect, useMemo, useRef, useState } from 'react'
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { PlaylistSetupScreen } from '../setup/PlaylistSetupScreen'
import { OnboardingSportsScreen } from './OnboardingSportsScreen'
import { OnboardingCountriesScreen } from './OnboardingCountriesScreen'
import { pickInitialPrimaryCountry } from './recommendedCountries'
import { DEFAULT_PREFERENCES, markOnboardingComplete, savePreferences, withCountryToggled } from '../../data/preferences'
import { useViewerCountry } from '../../data/useViewerCountry'
import { playlistCountries } from '../../data/viewerCountry'
import type { SportKey } from '../../data/sports/types'
import type { Channel } from '../../data/channel'
import type { PlaylistSourceRecord } from '../../data/session'

// Exactly three steps. The old fourth "You're all set" screen was removed
// in the 2026-08-25 restructure — finishing Countries IS finishing
// onboarding.
type Step = 1 | 2 | 3

// Each step screen's own root focusKey. Targeted directly (rather than
// ROOT_FOCUS_KEY) for the same reason App.tsx targets a screen's own key
// for lazy screens: norigin records a preset key even before anything is
// registered under it, and each step's root container self-focuses via its
// preferredChildFocusKey the moment it mounts — so the landing target is
// stated rather than left to whatever the root happens to descend into.
const STEP_FOCUS_KEYS: Record<Step, string> = {
  1: 'setup-screen',
  2: 'onboarding-sports',
  3: 'onboarding-countries',
}

interface Props {
  // Called once, from step 3's Finish setup, after preferences are saved
  // and onboarding is marked complete. `channels` is empty (and `source`
  // null) when the user skipped step 1 — App.tsx must not treat that as a
  // playlist to install.
  onDone: (channels: Channel[], source: PlaylistSourceRecord | null) => void
}

// Owns state across all three onboarding steps (playlist connect → sports &
// leagues → countries) so nothing is persisted piecemeal — only Finish
// setup actually writes to storage. Each step screen stays a plain
// controlled component with no storage awareness of its own.
export function OnboardingFlow({ onDone }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [channels, setChannels] = useState<Channel[]>([])
  const [source, setSource] = useState<PlaylistSourceRecord | null>(null)
  const [selectedSports, setSelectedSports] = useState<Set<SportKey>>(new Set(DEFAULT_PREFERENCES.sports))
  const [selectedLeagues, setSelectedLeagues] = useState<Set<string>>(new Set(DEFAULT_PREFERENCES.footballLeagueIds))
  // ORDERED, capped at MAX_PREFERRED_COUNTRIES — selection order is
  // priority order and the first pick is the user's primary country (see
  // SportPreferences.favoriteCountries / withCountryToggled).
  const [selectedCountries, setSelectedCountries] = useState<string[]>([])
  // "See all"/"See more" expansion lives here rather than inside the step
  // screens so navigating Back and forward again doesn't silently collapse
  // a list the user deliberately expanded.
  const [showAllLeagues, setShowAllLeagues] = useState(false)
  const [showAllCountries, setShowAllCountries] = useState(false)

  // Country-level personalization signal for this TV — device region, then
  // locale, then the connected playlist (see data/viewerCountry.ts). Owned
  // here, at the flow level, so the async device probe starts on step 1 and
  // has long resolved by the time steps 2 and 3 render recommendations from
  // it. Never blocks: an undetected country just means fewer suggestions.
  const viewerCountry = useViewerCountry(channels)
  const availableCountries = useMemo(() => playlistCountries(channels), [channels])

  // Each step declares a forceFocus target of its own, but the spatial-nav
  // library only focuses it in response to an explicit setFocus call —
  // App.tsx's top-level effect only fires on its own `screen` state
  // changing, which doesn't happen between steps of this wizard (it's all
  // still just screen === 'onboarding' from that vantage point), so this
  // flow needs its own re-focus on every internal step change.
  useEffect(() => {
    void setFocus(STEP_FOCUS_KEYS[step])
  }, [step])

  // Seeds ONE primary country the first time a signal exists to base it on
  // — the detected home country when the playlist can serve it, otherwise
  // the playlist's dominant country. Deliberately not five: neighbours,
  // the UK and the US are recommendations to consider, not preferences the
  // user expressed. The ref makes this strictly a seed — once it has run
  // (or the user has picked anything) it never overwrites a real choice,
  // including deliberately clearing the selection.
  const countriesSeededRef = useRef(false)
  useEffect(() => {
    if (countriesSeededRef.current) return
    const seed = pickInitialPrimaryCountry(viewerCountry.code, availableCountries)
    if (!seed) return
    countriesSeededRef.current = true
    setSelectedCountries([seed])
  }, [viewerCountry.code, availableCountries])

  function toggleSport(id: SportKey) {
    setSelectedSports((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleLeague(id: string) {
    setSelectedLeagues((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleCountry(name: string) {
    // Any manual edit ends the seeding window — see countriesSeededRef.
    countriesSeededRef.current = true
    setSelectedCountries((prev) => withCountryToggled(prev, name))
  }

  function finish() {
    savePreferences({
      sports: [...selectedSports],
      footballLeagueIds: selectedSports.has('football') ? [...selectedLeagues] : [],
      // Empty selection means "no country filtering" (everything visible)
      // — same meaning as never having run onboarding at all — rather
      // than an unusable "nothing visible" default.
      favoriteCountries: selectedCountries,
      // Stream-type preference is deliberately NOT an onboarding question
      // (no mandatory technical IPTV concepts during onboarding) —
      // everyone starts on 'auto' and can change it any time in Settings.
      streamType: 'auto',
    })
    markOnboardingComplete()
    onDone(channels, source)
  }

  if (step === 1) {
    return (
      <PlaylistSetupScreen
        variant="onboarding"
        onLoaded={(loaded, connectedSource) => {
          setChannels(loaded)
          setSource(connectedSource)
          setStep(2)
        }}
        // Skipping leaves channels empty and source null, and deliberately
        // does NOT complete onboarding — the user can still set their
        // sports/leagues/countries and explore Ninety, then connect a
        // provider later from Settings.
        onSkip={() => setStep(2)}
      />
    )
  }

  if (step === 2) {
    return (
      <OnboardingSportsScreen
        selectedSports={selectedSports}
        selectedLeagues={selectedLeagues}
        viewerCountryCode={viewerCountry.code}
        showAllLeagues={showAllLeagues}
        onToggleShowAllLeagues={() => setShowAllLeagues((v) => !v)}
        onToggleSport={toggleSport}
        onToggleLeague={toggleLeague}
        onBack={() => setStep(1)}
        onContinue={() => setStep(3)}
      />
    )
  }

  return (
    <OnboardingCountriesScreen
      availableCountries={availableCountries}
      viewerCountryCode={viewerCountry.code}
      selectedCountries={selectedCountries}
      showAllCountries={showAllCountries}
      onToggleShowAllCountries={() => setShowAllCountries((v) => !v)}
      onToggleCountry={toggleCountry}
      onClearSelection={() => {
        countriesSeededRef.current = true
        setSelectedCountries([])
      }}
      onBack={() => setStep(2)}
      onFinish={finish}
    />
  )
}
