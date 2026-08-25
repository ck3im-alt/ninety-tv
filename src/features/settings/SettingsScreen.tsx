import { useMemo, useState } from 'react'
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler, useFocusScrollIntoView } from '../../core/platform'
import { MAX_PREFERRED_COUNTRIES, loadPreferences, savePreferences, withCountryToggled } from '../../data/preferences'
import type { StreamTypePreference } from '../../data/preferences'
import { useFootballCompetitions } from '../../data/sports/useFootballCompetitions'
import type { SportKey } from '../../data/sports/types'
import { parseCategory } from '../channels/parseCategory'
import { flagSrc } from '../../data/countryCodes'
import { SelectableCard } from '../onboarding/OnboardingSportsScreen'
import { BackArrowIcon, FootballIcon, FormulaOneIcon } from '../onboarding/sportIcons'
import type { Channel } from '../../data/channel'
import type { PlaylistSourceRecord } from '../../data/session'
import '../onboarding/onboardingShared.css'
import './SettingsScreen.css'

const ROOT_FOCUS_KEY = 'settings-screen'
const BACK_FOCUS_KEY = 'settings-back'
const RECONNECT_FOCUS_KEY = 'settings-reconnect'
const GRID_COLUMNS = 8

interface PopularSport {
  id: SportKey
  label: string
  icon: () => React.JSX.Element
}

const POPULAR_SPORTS: PopularSport[] = [
  { id: 'football', label: 'Football', icon: FootballIcon },
  { id: 'f1', label: 'Formula 1', icon: FormulaOneIcon },
]

// Consumer wording only — "Event Streams", never the IPTV-internal "PPV"
// (see the stream-groups task, sections 7/9). A ranking preference, not a
// filter: the non-preferred type still appears whenever it's better or the
// only way to watch.
const STREAM_TYPE_CHOICES: Array<{ id: StreamTypePreference; label: string; description: string }> = [
  { id: 'auto', label: 'Auto', description: 'Best stream wins' },
  { id: 'tv', label: 'TV Channels', description: 'Prefer regular channels' },
  { id: 'event', label: 'Event Streams', description: 'Prefer per-match feeds' },
]

interface Props {
  // Read-only playlist summary + the "Reconnect" entry point — sourced
  // straight from what App.tsx already holds, same data AdminPanel's
  // debug-status block reads. No account system invented here: just the
  // facts the data model already has and a link into the existing Setup
  // screen to change them.
  channels: Channel[]
  source: PlaylistSourceRecord | null
  onBack: () => void
  onReconnectPlaylist: () => void
}

function sourceSummary(source: PlaylistSourceRecord | null): string {
  if (!source) return 'No playlist connected'
  if (source.type === 'xtream') return `Xtream — ${source.server}`
  if (source.type === 'm3u-url') return 'M3U playlist URL'
  return `M3U file — ${source.fileName}`
}

export function SettingsScreen({ channels, source, onBack, onReconnectPlaylist }: Props) {
  const { ref, focusKey } = useFocusable({
    focusKey: ROOT_FOCUS_KEY,
    trackChildren: true,
    // Always resolvable at mount — the sports grid's first card always
    // exists (POPULAR_SPORTS is a fixed local list, no async gating). See
    // App.tsx's SCREEN_FOCUS_KEYS/initial-focus effect for why targeting
    // this container by its own key (rather than ROOT_FOCUS_KEY) matters:
    // this screen is lazy-loaded.
    preferredChildFocusKey: 'settings-sport-football',
  })

  const [prefs, setPrefs] = useState(() => loadPreferences())

  function persist(next: typeof prefs) {
    setPrefs(next)
    savePreferences(next)
  }

  function toggleSport(id: SportKey) {
    const sports = new Set(prefs.sports)
    if (sports.has(id)) sports.delete(id)
    else sports.add(id)
    // Deselecting football drops its league selections too — mirrors
    // OnboardingFlow's finish() (footballLeagueIds is only ever meaningful
    // while football itself is selected), so a re-selected football later
    // doesn't resurrect a stale, unreviewed league list.
    persist({ ...prefs, sports: [...sports], footballLeagueIds: sports.has('football') ? prefs.footballLeagueIds : [] })
  }

  function toggleLeague(id: string) {
    const leagues = new Set(prefs.footballLeagueIds)
    if (leagues.has(id)) leagues.delete(id)
    else leagues.add(id)
    persist({ ...prefs, footballLeagueIds: [...leagues] })
  }

  function toggleCountry(name: string) {
    // Shared cap/primary-promotion rule with onboarding — see
    // preferences.ts's withCountryToggled. At the cap the toggle is a
    // no-op; the "N/5" counter in the section title communicates why.
    persist({ ...prefs, favoriteCountries: withCountryToggled(prefs.favoriteCountries, name) })
  }

  function selectStreamType(streamType: StreamTypePreference) {
    persist({ ...prefs, streamType })
  }

  const footballSelected = prefs.sports.includes('football')
  const competitionsState = useFootballCompetitions()
  const footballLeagues = competitionsState.status === 'ready' ? competitionsState.leagues : []

  const countryOptions = useMemo(() => {
    const counts = new Map<string, { code: string | null; count: number }>()
    for (const channel of channels) {
      const { countryName, countryCode } = parseCategory(channel.groupTitle || '')
      if (!countryName) continue
      const existing = counts.get(countryName)
      counts.set(countryName, { code: countryCode, count: (existing?.count ?? 0) + 1 })
    }
    return [...counts.entries()].map(([name, { code, count }]) => ({ name, code, count })).sort((a, b) => b.count - a.count)
  }, [channels])

  useBackHandler(() => {
    onBack()
    return true
  })

  const { ref: backRef, focused: backFocused } = useFocusable({ focusKey: BACK_FOCUS_KEY, onEnterPress: onBack })
  useFocusScrollIntoView(backRef, backFocused)

  const { ref: reconnectRef, focused: reconnectFocused } = useFocusable({
    focusKey: RECONNECT_FOCUS_KEY,
    onEnterPress: onReconnectPlaylist,
  })
  useFocusScrollIntoView(reconnectRef, reconnectFocused)

  const leaguesVisible = footballSelected && footballLeagues.length > 0
  const countriesVisible = countryOptions.length > 0
  const sportsFirstKey = 'settings-sport-football'
  const leaguesFirstKey = footballLeagues[0] ? `settings-league-${footballLeagues[0].id}` : undefined
  const countriesFirstKey = countryOptions[0] ? `settings-country-${countryOptions[0].name}` : undefined
  const streamTypeFirstKey = 'settings-streamtype-auto'
  const afterSportsKey = leaguesVisible ? leaguesFirstKey : countriesVisible ? countriesFirstKey : streamTypeFirstKey
  const afterLeaguesKey = countriesVisible ? countriesFirstKey : streamTypeFirstKey
  const beforeCountriesKey = leaguesVisible ? leaguesFirstKey : sportsFirstKey
  const beforeStreamTypeKey = countriesVisible ? countriesFirstKey : beforeCountriesKey

  const leaguesLastRowStart = footballLeagues.length > 0 ? (Math.ceil(footballLeagues.length / GRID_COLUMNS) - 1) * GRID_COLUMNS : 0
  const countriesLastRowStart = countryOptions.length > 0 ? (Math.ceil(countryOptions.length / GRID_COLUMNS) - 1) * GRID_COLUMNS : 0

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} className="settings-screen">
        <div className="settings-header">
          <button ref={backRef} className={`back-button ${backFocused ? 'focused' : ''}`} onClick={onBack}>
            <BackArrowIcon /> Back
          </button>
          <h1 className="settings-title">Settings</h1>
        </div>

        <div className="settings-content">
          <section className="settings-section">
            <h2 className="picker-section-title">FAVORITE SPORTS</h2>
            <div className="settings-grid settings-sports-grid">
              {POPULAR_SPORTS.map((sport) => {
                const Icon = sport.icon
                return (
                  <SelectableCard
                    key={sport.id}
                    focusKey={`settings-sport-${sport.id}`}
                    selected={prefs.sports.includes(sport.id)}
                    onToggle={() => toggleSport(sport.id)}
                    onArrowUp={() => void setFocus(BACK_FOCUS_KEY)}
                    onArrowDown={afterSportsKey ? () => void setFocus(afterSportsKey) : undefined}
                  >
                    <div className="pick-card-icon">
                      <Icon />
                    </div>
                    <span className="pick-card-label">{sport.label}</span>
                  </SelectableCard>
                )
              })}
            </div>
          </section>

          {footballSelected && competitionsState.status === 'loading' && <p className="picker-status">Loading competitions…</p>}
          {footballSelected && competitionsState.status === 'error' && <p className="picker-status">{competitionsState.message}</p>}

          {leaguesVisible && (
            <section className="settings-section">
              <h2 className="picker-section-title">FAVORITE FOOTBALL LEAGUES</h2>
              <div className="settings-grid settings-league-grid">
                {footballLeagues.map((league, index) => (
                  <SelectableCard
                    key={league.id}
                    focusKey={`settings-league-${league.id}`}
                    selected={prefs.footballLeagueIds.includes(league.id)}
                    onToggle={() => toggleLeague(league.id)}
                    onArrowUp={index < GRID_COLUMNS ? () => void setFocus(sportsFirstKey) : undefined}
                    onArrowDown={
                      index >= leaguesLastRowStart && afterLeaguesKey ? () => void setFocus(afterLeaguesKey) : undefined
                    }
                  >
                    <div className="pick-card-icon">{league.badge && <img src={league.badge} alt="" />}</div>
                    <span className="pick-card-label">{league.name}</span>
                  </SelectableCard>
                ))}
              </div>
            </section>
          )}

          {countriesVisible && (
            <section className="settings-section">
              <h2 className="picker-section-title">
                FAVORITE COUNTRIES
                <span className="picker-section-counter">
                  {prefs.favoriteCountries.length}/{MAX_PREFERRED_COUNTRIES}
                </span>
              </h2>
              <p className="settings-section-hint">
                Up to {MAX_PREFERRED_COUNTRIES}. Your first pick is your primary country and ranks highest — everything
                stays browsable regardless.
              </p>
              <div className="settings-grid settings-countries-grid">
                {countryOptions.map((country, index) => {
                  const isPrimary = prefs.favoriteCountries[0] === country.name
                  return (
                    <SelectableCard
                      key={country.name}
                      focusKey={`settings-country-${country.name}`}
                      selected={prefs.favoriteCountries.includes(country.name)}
                      onToggle={() => toggleCountry(country.name)}
                      onArrowUp={index < GRID_COLUMNS ? () => void setFocus(beforeCountriesKey ?? sportsFirstKey) : undefined}
                      onArrowDown={index >= countriesLastRowStart ? () => void setFocus(streamTypeFirstKey) : undefined}
                    >
                      <div className="pick-card-icon round">
                        {country.code && flagSrc(country.code) && <img src={flagSrc(country.code)!} alt="" />}
                      </div>
                      <span className="pick-card-label">{country.name}</span>
                      <span className="pick-card-sublabel">
                        {isPrimary ? <span className="pick-card-primary">Primary</span> : `${country.count} channels`}
                      </span>
                    </SelectableCard>
                  )
                })}
              </div>
            </section>
          )}

          <section className="settings-section">
            <h2 className="picker-section-title">STREAM PREFERENCE</h2>
            <p className="settings-section-hint">
              When a match is on both regular TV channels and event-specific streams, which should rank first? Auto
              simply picks the best stream. This never hides anything.
            </p>
            <div className="settings-grid settings-streamtype-grid">
              {STREAM_TYPE_CHOICES.map((choice) => (
                <SelectableCard
                  key={choice.id}
                  focusKey={`settings-streamtype-${choice.id}`}
                  selected={prefs.streamType === choice.id}
                  onToggle={() => selectStreamType(choice.id)}
                  onArrowUp={() => void setFocus(beforeStreamTypeKey ?? sportsFirstKey)}
                  onArrowDown={() => void setFocus(RECONNECT_FOCUS_KEY)}
                >
                  <span className="pick-card-label">{choice.label}</span>
                  <span className="pick-card-sublabel">{choice.description}</span>
                </SelectableCard>
              ))}
            </div>
          </section>

          <section className="settings-section settings-playlist">
            <h2 className="picker-section-title">PLAYLIST</h2>
            <p className="settings-playlist-summary">
              {sourceSummary(source)}
              {channels.length > 0 ? ` — ${channels.length.toLocaleString()} channels` : ''}
            </p>
            <button ref={reconnectRef} className={`picker-section-action ${reconnectFocused ? 'focused' : ''}`} onClick={onReconnectPlaylist}>
              {channels.length > 0 ? 'Reconnect / change playlist' : 'Connect a playlist'}
            </button>
          </section>
        </div>
      </main>
    </FocusContext.Provider>
  )
}
