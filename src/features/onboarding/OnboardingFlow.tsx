import { useEffect, useMemo, useState } from 'react'
import { ROOT_FOCUS_KEY, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { PlaylistSetupScreen } from '../setup/PlaylistSetupScreen'
import { OnboardingSportsScreen } from './OnboardingSportsScreen'
import { OnboardingCountriesScreen } from './OnboardingCountriesScreen'
import { OnboardingDoneScreen } from './OnboardingDoneScreen'
import { parseCategory } from '../channels/parseCategory'
import { DEFAULT_PREFERENCES, markOnboardingComplete, savePreferences } from '../../data/preferences'
import type { SportKey } from '../../data/sports/types'
import type { Channel } from '../../data/channel'
import type { PlaylistSourceRecord } from '../../data/session'

type Step = 1 | 2 | 3 | 4

interface Props {
  onDone: (channels: Channel[], source: PlaylistSourceRecord | null) => void
}

// Owns state across all four onboarding steps (playlist connect → sports →
// countries → done) so nothing is persisted piecemeal — only the very
// last step (Start Watching / Skip) actually writes to storage. Each step
// screen itself stays a plain controlled component with no storage
// awareness of its own.
export function OnboardingFlow({ onDone }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [channels, setChannels] = useState<Channel[]>([])
  const [source, setSource] = useState<PlaylistSourceRecord | null>(null)
  const [selectedSports, setSelectedSports] = useState<Set<SportKey>>(new Set(DEFAULT_PREFERENCES.sports))
  const [selectedLeagues, setSelectedLeagues] = useState<Set<string>>(new Set(DEFAULT_PREFERENCES.footballLeagueIds))
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(new Set())

  const allCountryNames = useMemo(() => {
    const names = new Set<string>()
    for (const channel of channels) {
      const { countryName } = parseCategory(channel.groupTitle || '')
      if (countryName) names.add(countryName)
    }
    return [...names]
  }, [channels])

  // Each step declares a forceFocus target of its own, but the spatial-nav
  // library only focuses it in response to an explicit setFocus call —
  // App.tsx's top-level effect only fires on its own `screen` state
  // changing, which doesn't happen between steps of this wizard (it's all
  // still just screen === 'onboarding' from that vantage point), so this
  // flow needs its own re-focus on every internal step change.
  useEffect(() => {
    void setFocus(ROOT_FOCUS_KEY)
  }, [step])

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
    setSelectedCountries((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function finish(sports: Set<SportKey>, leagues: Set<string>, countries: Set<string>) {
    savePreferences({
      sports: [...sports],
      footballLeagueIds: sports.has('football') ? [...leagues] : [],
      // Empty selection means "no country filtering" (everything visible)
      // — same meaning as never having run onboarding at all — rather
      // than an unusable "nothing visible" default.
      favoriteCountries: [...countries],
    })
    markOnboardingComplete()
    onDone(channels, source)
  }

  if (step === 1) {
    return (
      <PlaylistSetupScreen
        stepperCurrent={1}
        onLoaded={(loaded, connectedSource) => {
          setChannels(loaded)
          setSource(connectedSource)
          // Pre-select the playlist's biggest countries by channel count —
          // gives the Countries step a sensible non-empty starting point
          // instead of forcing the user to build the selection from zero.
          const counts = new Map<string, number>()
          for (const channel of loaded) {
            const { countryName } = parseCategory(channel.groupTitle || '')
            if (countryName) counts.set(countryName, (counts.get(countryName) ?? 0) + 1)
          }
          const top3 = [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([name]) => name)
          setSelectedCountries(new Set(top3))
          setStep(2)
        }}
      />
    )
  }

  if (step === 2) {
    return (
      <OnboardingSportsScreen
        selectedSports={selectedSports}
        selectedLeagues={selectedLeagues}
        onToggleSport={toggleSport}
        onToggleLeague={toggleLeague}
        onBack={() => setStep(1)}
        onSkip={() => finish(new Set(DEFAULT_PREFERENCES.sports), new Set(DEFAULT_PREFERENCES.footballLeagueIds), new Set())}
        onContinue={() => setStep(3)}
      />
    )
  }

  if (step === 3) {
    return (
      <OnboardingCountriesScreen
        channels={channels}
        selectedCountries={selectedCountries}
        onToggleCountry={toggleCountry}
        onSelectAll={() => setSelectedCountries(new Set(allCountryNames))}
        onDeselectAll={() => setSelectedCountries(new Set())}
        onBack={() => setStep(2)}
        onContinue={() => setStep(4)}
      />
    )
  }

  return (
    <OnboardingDoneScreen
      sportsCount={selectedSports.size}
      countriesCount={selectedCountries.size}
      onBack={() => setStep(3)}
      onFinish={() => finish(selectedSports, selectedLeagues, selectedCountries)}
    />
  )
}
