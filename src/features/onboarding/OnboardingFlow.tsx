import { useEffect, useMemo, useRef, useState } from 'react'
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { PlaylistSetupScreen } from '../setup/PlaylistSetupScreen'
import { OnboardingSportsScreen } from './OnboardingSportsScreen'
import { OnboardingTeamsScreen } from './OnboardingTeamsScreen'
import { OnboardingCountriesScreen } from './OnboardingCountriesScreen'
import { pickInitialPrimaryCountry } from './recommendedCountries'
import { DEFAULT_PREFERENCES, markOnboardingComplete, savePreferences, withCountryToggled } from '../../data/preferences'
import { useViewerCountry } from '../../data/useViewerCountry'
import { playlistCountries } from '../../data/viewerCountry'
import type { SportKey } from '../../data/sports/types'
import type { Channel } from '../../data/channel'
import type { PlaylistSourceRecord } from '../../data/session'

// Four steps: Playlist, Sports & leagues, Teams, Countries. There is still
// no "You're all set" summary — finishing Countries IS finishing onboarding
// (the 2026-08-25 restructure removed that screen).
//
// Teams became step 3 in the 2026-08-26 pass; it used to be a cramped
// expandable section inside step 2. See ONBOARDING_STEPS for why.
type Step = 1 | 2 | 3 | 4

// Each step screen's own root focusKey. Targeted directly (rather than
// ROOT_FOCUS_KEY) for the same reason App.tsx targets a screen's own key
// for lazy screens: norigin records a preset key even before anything is
// registered under it, and each step's root container self-focuses via its
// preferredChildFocusKey the moment it mounts — so the landing target is
// stated rather than left to whatever the root happens to descend into.
const STEP_FOCUS_KEYS: Record<Step, string> = {
  1: 'setup-screen',
  2: 'onboarding-sports',
  3: 'onboarding-teams',
  4: 'onboarding-countries',
}

interface Props {
  // Called once, from step 4's Finish setup, after preferences are saved
  // and onboarding is marked complete. `channels` is empty (and `source`
  // null) when the user skipped step 1 — App.tsx must not treat that as a
  // playlist to install.
  onDone: (channels: Channel[], source: PlaylistSourceRecord | null) => void
}

// Owns state across all four onboarding steps (playlist connect → sports &
// leagues → teams → countries) so nothing is persisted piecemeal — only
// Finish setup actually writes to storage. Each step screen stays a plain
// controlled component with no storage awareness of its own.
export function OnboardingFlow({ onDone }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [channels, setChannels] = useState<Channel[]>([])
  const [source, setSource] = useState<PlaylistSourceRecord | null>(null)
  const [selectedSports, setSelectedSports] = useState<Set<SportKey>>(new Set(DEFAULT_PREFERENCES.sports))
  const [selectedLeagues, setSelectedLeagues] = useState<Set<string>>(new Set(DEFAULT_PREFERENCES.footballLeagueIds))
  // Canonical ninety-api team ids. Starts EMPTY and stays optional: unlike
  // sports and leagues there is no defensible default here — guessing which
  // clubs someone supports would be worse than asking nothing at all.
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set(DEFAULT_PREFERENCES.favoriteTeamIds))
  // ORDERED, capped at MAX_PREFERRED_COUNTRIES — selection order is
  // priority order and the first pick is the user's primary country (see
  // SportPreferences.favoriteCountries / withCountryToggled).
  const [selectedCountries, setSelectedCountries] = useState<string[]>([])
  // Only the Countries step still has anything to expand — the league and
  // team steps replaced their expanders with always-open browser panels (see
  // OnboardingSportsScreen). It lives here rather than inside the screen so
  // navigating Back and forward again doesn't silently collapse a list the
  // user deliberately expanded.
  const [showAllCountries, setShowAllCountries] = useState(false)

  // Country-level personalization signal for this TV — device region, then
  // locale, then the connected playlist (see data/viewerCountry.ts). Owned
  // here, at the flow level, so the async device probe starts on step 1 and
  // has long resolved by the time the later steps render recommendations
  // from it. Never blocks: an undetected country just means fewer
  // suggestions.
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

  function toggleTeam(id: string) {
    setSelectedTeams((prev) => {
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
      // Optional, and genuinely optional: onboarding never blocks on the
      // team catalogue being reachable (see OnboardingTeamsScreen) — a
      // viewer who skipped or couldn't load it finishes with an empty list
      // and can add teams later in Settings.
      favoriteTeamIds: selectedSports.has('football') ? [...selectedTeams] : [],
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
        onToggleSport={toggleSport}
        onToggleLeague={toggleLeague}
        onBack={() => setStep(1)}
        onContinue={() => setStep(3)}
      />
    )
  }

  if (step === 3) {
    return (
      <OnboardingTeamsScreen
        // Leagues ORDER the clubs on this step (suggestions, and the top of
        // the browser's rail); they never limit which clubs exist. See
        // teamRail.ts.
        selectedLeagues={selectedLeagues}
        selectedTeams={selectedTeams}
        onToggleTeam={toggleTeam}
        onBack={() => setStep(2)}
        onContinue={() => setStep(4)}
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
      onBack={() => setStep(3)}
      onFinish={finish}
    />
  )
}
