import { useEffect, useMemo, useState } from 'react'
import { ROOT_FOCUS_KEY, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { TopNav } from './features/navigation/TopNav'
import { HomeScreen } from './features/home/HomeScreen'
import { PlaylistSetupScreen } from './features/setup/PlaylistSetupScreen'
import { OnboardingFlow } from './features/onboarding/OnboardingFlow'
import { AdminPanel } from './features/admin/AdminPanel'
import { hasCompletedOnboarding, loadPreferences } from './data/preferences'
import {
  loadFilters,
  loadPlaylist,
  saveFilters,
  savePlaylist,
  loadFavoriteChannels,
  saveFavoriteChannels,
  loadFavoriteCategories,
  saveFavoriteCategories,
  loadRecentlyWatched,
  saveRecentlyWatched,
} from './data/session'
import { CategoryChannelsScreen } from './features/channels/CategoryChannelsScreen'
import { BrowseCascadeScreen } from './features/channels/BrowseCascadeScreen'
import type { CascadeLevel } from './features/channels/BrowseCascadeScreen'
import { FilterPopup } from './features/channels/FilterPopup'
import { ChannelPlayerScreen } from './features/player/ChannelPlayerScreen'
import { EventDetailsScreen } from './features/eventDetails/EventDetailsScreen'
import { CompetitionsScreen } from './features/competitions/CompetitionsScreen'
import { parseCategory } from './features/channels/parseCategory'
import type { Channel } from './data/channel'
import type { XtreamCredentials } from './data/xtream/types'
import type { SportEvent } from './data/sports/types'

// Temporary in-memory screen switcher, standing in for real routing
// (navigation-compose equivalent) until that's built. Playlist, Channels
// filter state, favorites, and recently-watched are all persisted (see
// data/session.ts) so a reload doesn't force reconnecting/re-filtering/
// re-favoriting; only screen/drill-down navigation position resets on
// reload.
type Screen =
  | 'home'
  | 'setup'
  | 'onboarding'
  | 'browse-cascade'
  | 'channels-favorites'
  | 'channels-recent'
  | 'player'
  | 'event-details'
  | 'competitions'

const RECENTLY_WATCHED_LIMIT = 30

// Read once at module load rather than per-render — both the initial screen
// and the initial channels/xtreamCreds state below need the same snapshot.
const storedPlaylist = loadPlaylist()

function App() {
  // Home always opens first — its data comes from TheSportsDB, not the
  // connected IPTV playlist, so there's nothing it needs to wait on. This
  // holds on every launch, including a device's very first one: onboarding
  // (which starts with connecting a playlist — Steg 25) only kicks in once
  // the user actually goes looking for Channels, via onSelectChannels below.
  const [screen, setScreen] = useState<Screen>('home')
  const [channels, setChannels] = useState<Channel[]>(() => storedPlaylist?.channels ?? [])
  // Only set when the connected playlist was an Xtream source — EPG
  // (get_short_epg) only exists on that API, not for plain M3U playlists.
  const [xtreamCreds, setXtreamCreds] = useState<XtreamCredentials | null>(() => storedPlaylist?.xtreamCreds ?? null)
  // The event the user drilled into from Home (hero or a Live Now/Coming Up
  // card) — set right before navigating to 'event-details', read by that
  // screen to know which fixture to look up broadcast channels for.
  const [selectedEvent, setSelectedEvent] = useState<SportEvent | null>(null)
  // Where Event Details' Back button should return to — Home or
  // Competitions, whichever the user drilled in from (same pattern as
  // playerReturnScreen below).
  const [eventDetailsReturnScreen, setEventDetailsReturnScreen] = useState<Screen>('home')
  const [playingChannel, setPlayingChannel] = useState<Channel | null>(null)
  const [playingSourceLabel, setPlayingSourceLabel] = useState<string | undefined>(undefined)
  // Where the player's Back button should return to — whichever list screen
  // (the cascade browser, favorites, or recently-watched) the user watched
  // from. Non-persisted, same as the rest of this in-memory nav state.
  const [playerReturnScreen, setPlayerReturnScreen] = useState<Screen>('browse-cascade')
  // Most-recently-watched channel id first, capped and de-duplicated.
  const [recentlyWatched, setRecentlyWatched] = useState<string[]>(() => loadRecentlyWatched())

  // The cascade browser's drill-down path — lifted up here (rather than
  // living inside BrowseCascadeScreen) so it survives navigating away to
  // watch a channel full-screen and coming back; the screen would otherwise
  // reset to the top on remount.
  const [cascadeLevel, setCascadeLevel] = useState<CascadeLevel>('country')
  const [cascadeCountry, setCascadeCountry] = useState<string | null>(null)
  const [cascadeCategory, setCascadeCategory] = useState<string | null>(null)
  const [cascadeChannel, setCascadeChannel] = useState<Channel | null>(null)

  const [hiddenCountries, setHiddenCountries] = useState<Set<string>>(() => new Set(loadFilters().hiddenCountries))
  // Composite `${country}::${category}` keys — see categoryFavoriteKey.
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(() => new Set(loadFilters().hiddenCategories))
  const [filterOpen, setFilterOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)

  // Favorited channels/categories are pinned to the top of their list.
  const [favoriteChannels, setFavoriteChannels] = useState<Set<string>>(() => loadFavoriteChannels())
  const [favoriteCategories, setFavoriteCategories] = useState<Set<string>>(() => loadFavoriteCategories())

  // The spatial-navigation library never auto-focuses anything — without
  // this, arrow keys (including a PC keyboard standing in for the remote)
  // have no current focus to navigate from and silently do nothing. Needs
  // to re-run on every screen change since the focusable tree is replaced.
  // Skips browse-cascade: that screen restores focus itself based on which
  // column (country/category/channel) was last active, via its own
  // `level`-keyed effect — since effects run child-before-parent, this
  // blanket ROOT-focus call would otherwise fire afterward and win the
  // race, always snapping back to the Countries column (its forceFocus
  // target) regardless of where the user actually was.
  useEffect(() => {
    if (screen === 'browse-cascade') return
    void setFocus(ROOT_FOCUS_KEY)
  }, [screen])

  // Persist the connected playlist whenever it changes (setup, onboarding,
  // or reconnecting) — guarded to skip the empty initial state so a reload
  // before ever connecting doesn't clobber nothing-with-nothing, and so a
  // future "disconnect" action wouldn't silently wipe a saved playlist by
  // resetting channels to [] (no such action exists yet, but the guard costs
  // nothing and keeps this effect honest about what it's for).
  useEffect(() => {
    if (channels.length === 0) return
    savePlaylist(channels, xtreamCreds)
  }, [channels, xtreamCreds])

  useEffect(() => {
    saveFilters(hiddenCountries, hiddenCategories)
  }, [hiddenCountries, hiddenCategories])

  useEffect(() => {
    saveFavoriteChannels(favoriteChannels)
  }, [favoriteChannels])

  useEffect(() => {
    saveFavoriteCategories(favoriteCategories)
  }, [favoriteCategories])

  useEffect(() => {
    saveRecentlyWatched(recentlyWatched)
  }, [recentlyWatched])

  // Same country+category group the playing channel came from, so the
  // player's sidebar can still switch between siblings without leaving it.
  const playerChannels = useMemo(() => {
    if (!playingChannel) return channels
    const target = parseCategory(playingChannel.groupTitle || '')
    const siblings = channels.filter((c) => {
      if (c.id === playingChannel.id) return false
      const p = parseCategory(c.groupTitle || '')
      return (p.countryName ?? 'Other') === (target.countryName ?? 'Other') && p.mergedLabel === target.mergedLabel
    })
    return [playingChannel, ...siblings]
  }, [channels, playingChannel])

  function toggleInSet(set: Set<string>, setSet: (s: Set<string>) => void, value: string) {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setSet(next)
  }

  function recordWatched(channelId: string) {
    setRecentlyWatched((prev) => [channelId, ...prev.filter((id) => id !== channelId)].slice(0, RECENTLY_WATCHED_LIMIT))
  }

  const favoriteChannelsList = useMemo(
    () => channels.filter((c) => favoriteChannels.has(c.id)),
    [channels, favoriteChannels],
  )

  const recentChannelsList = useMemo(() => {
    const byId = new Map(channels.map((c) => [c.id, c] as const))
    return recentlyWatched.map((id) => byId.get(id)).filter((c): c is Channel => c != null)
  }, [channels, recentlyWatched])

  function watchChannel(channel: Channel, source: { label: string }, fromScreen: Screen) {
    recordWatched(channel.id)
    setPlayingChannel(channel)
    setPlayingSourceLabel(source.label)
    setPlayerReturnScreen(fromScreen)
    setScreen('player')
  }

  return (
    <>
      {screen !== 'player' && screen !== 'onboarding' && (
        <TopNav
          activeItem={screen === 'home' ? 'Home' : screen === 'competitions' ? 'Competitions' : 'Channels'}
          onSelectHome={() => setScreen('home')}
          onSelectChannels={() => {
            if (channels.length > 0) setScreen('browse-cascade')
            // No playlist yet: a device's true first-ever Channels visit
            // goes through the full onboarding wizard (Sports/Countries,
            // plus playlist connect as its first step); anyone already
            // onboarded but currently playlist-less (e.g. cleared storage)
            // gets just the plain reconnect screen instead.
            else setScreen(hasCompletedOnboarding() ? 'setup' : 'onboarding')
          }}
          onSelectCompetitions={() => setScreen('competitions')}
          onOpenAdmin={() => setAdminOpen(true)}
        />
      )}
      {screen === 'home' && (
        <HomeScreen
          channels={channels}
          xtreamCreds={xtreamCreds}
          favoriteChannels={favoriteChannelsList}
          onSelectEvent={(event) => {
            setSelectedEvent(event)
            setEventDetailsReturnScreen('home')
            setScreen('event-details')
          }}
          onWatchChannel={(channel, source) => watchChannel(channel, source, 'home')}
        />
      )}

      {screen === 'competitions' && (
        <CompetitionsScreen
          onSelectEvent={(event) => {
            setSelectedEvent(event)
            setEventDetailsReturnScreen('competitions')
            setScreen('event-details')
          }}
          onBack={() => setScreen('home')}
        />
      )}

      {screen === 'event-details' && selectedEvent && (
        <EventDetailsScreen
          event={selectedEvent}
          channels={channels}
          xtreamCreds={xtreamCreds}
          onWatch={(channel, source) => watchChannel(channel, source, 'event-details')}
          onBack={() => setScreen(eventDetailsReturnScreen)}
          onBrowseChannels={() => setScreen('browse-cascade')}
        />
      )}

      {screen === 'setup' && (
        <PlaylistSetupScreen
          onLoaded={(loaded, creds) => {
            setChannels(loaded)
            setXtreamCreds(creds)
            setScreen('browse-cascade')
          }}
        />
      )}

      {screen === 'onboarding' && (
        <OnboardingFlow
          onDone={(loaded, creds) => {
            setChannels(loaded)
            setXtreamCreds(creds)
            // Countries step selection becomes the initial hidden-country
            // filter: everything NOT chosen starts hidden in Channels
            // browsing (still changeable any time via the existing Filter
            // popup — this only sets where it starts). An empty selection
            // (Skip, or nothing detected) means no filtering at all.
            const favoriteCountries = loadPreferences().favoriteCountries ?? []
            if (favoriteCountries.length > 0) {
              const allCountries = new Set<string>()
              for (const channel of loaded) {
                const { countryName } = parseCategory(channel.groupTitle || '')
                if (countryName) allCountries.add(countryName)
              }
              const favorites = new Set(favoriteCountries)
              setHiddenCountries(new Set([...allCountries].filter((name) => !favorites.has(name))))
            }
            setScreen('browse-cascade')
          }}
        />
      )}

      {screen === 'browse-cascade' && (
        <BrowseCascadeScreen
          channels={channels}
          xtreamCreds={xtreamCreds}
          hiddenCountries={hiddenCountries}
          hiddenCategories={hiddenCategories}
          favoriteCategories={favoriteCategories}
          onToggleFavoriteCategory={(key) => toggleInSet(favoriteCategories, setFavoriteCategories, key)}
          favoriteChannels={favoriteChannels}
          onToggleFavoriteChannel={(id) => toggleInSet(favoriteChannels, setFavoriteChannels, id)}
          onWatch={(channel, source) => watchChannel(channel, source, 'browse-cascade')}
          onOpenFavorites={() => setScreen('channels-favorites')}
          onOpenRecent={() => setScreen('channels-recent')}
          onOpenFilter={() => setFilterOpen(true)}
          onExit={() => setScreen('home')}
          level={cascadeLevel}
          onLevelChange={setCascadeLevel}
          selectedCountry={cascadeCountry}
          onSelectedCountryChange={setCascadeCountry}
          selectedCategory={cascadeCategory}
          onSelectedCategoryChange={setCascadeCategory}
          selectedChannel={cascadeChannel}
          onSelectedChannelChange={setCascadeChannel}
        />
      )}

      {screen === 'channels-favorites' && (
        <CategoryChannelsScreen
          country=""
          category=""
          title="Favorites"
          breadcrumb={['Channels', 'Favorites']}
          emptyMessage="You haven't favorited any channels yet — press the star on a channel to add it here."
          channels={favoriteChannelsList}
          xtreamCreds={xtreamCreds}
          favoriteChannels={favoriteChannels}
          onToggleFavoriteChannel={(id) => toggleInSet(favoriteChannels, setFavoriteChannels, id)}
          onBack={() => setScreen('browse-cascade')}
          onWatch={(channel, source) => watchChannel(channel, source, 'channels-favorites')}
        />
      )}

      {screen === 'channels-recent' && (
        <CategoryChannelsScreen
          country=""
          category=""
          title="Recently Watched"
          breadcrumb={['Channels', 'Recently Watched']}
          emptyMessage="Channels you watch will show up here."
          channels={recentChannelsList}
          xtreamCreds={xtreamCreds}
          favoriteChannels={favoriteChannels}
          onToggleFavoriteChannel={(id) => toggleInSet(favoriteChannels, setFavoriteChannels, id)}
          onBack={() => setScreen('browse-cascade')}
          onWatch={(channel, source) => watchChannel(channel, source, 'channels-recent')}
        />
      )}

      {screen === 'player' && (
        <ChannelPlayerScreen
          channels={playerChannels}
          initialSourceLabel={playingSourceLabel}
          onBack={() => setScreen(playerReturnScreen)}
        />
      )}

      {filterOpen && (
        <FilterPopup
          channels={channels}
          hiddenCountries={hiddenCountries}
          hiddenCategories={hiddenCategories}
          onApply={(nextHiddenCountries, nextHiddenCategories) => {
            setHiddenCountries(nextHiddenCountries)
            setHiddenCategories(nextHiddenCategories)
          }}
          onClose={() => setFilterOpen(false)}
        />
      )}

      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}
    </>
  )
}

export default App
