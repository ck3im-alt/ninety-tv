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
  loadPlaylistState,
  xtreamCredsFromSource,
  saveFilters,
  savePlaylist,
  loadFavoriteChannels,
  saveFavoriteChannels,
  loadFavoriteCategories,
  saveFavoriteCategories,
  loadRecentlyWatched,
  saveRecentlyWatched,
} from './data/session'
import { recoverChannelsFromSource } from './data/playlistRecovery'
import { CategoryChannelsScreen } from './features/channels/CategoryChannelsScreen'
import { BrowseCascadeScreen } from './features/channels/BrowseCascadeScreen'
import type { CascadeLevel } from './features/channels/BrowseCascadeScreen'
import { FilterPopup } from './features/channels/FilterPopup'
import { ChannelPlayerScreen } from './features/player/ChannelPlayerScreen'
import { EventDetailsScreen } from './features/eventDetails/EventDetailsScreen'
import { CompetitionsScreen } from './features/competitions/CompetitionsScreen'
import { parseCategory } from './features/channels/parseCategory'
import { useChannelIdentityIndex } from './data/sports/useChannelIdentityIndex'
import type { Channel } from './data/channel'
import type { PlaylistSourceRecord } from './data/session'
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
// and the initial channels/source state below need the same snapshot.
const initialPlaylistState = loadPlaylistState()

function App() {
  // Home always opens first — its data comes from TheSportsDB, not the
  // connected IPTV playlist, so there's nothing it needs to wait on. This
  // holds on every launch, including a device's very first one: onboarding
  // (which starts with connecting a playlist — Steg 25) only kicks in once
  // the user actually goes looking for Channels, via onSelectChannels below.
  const [screen, setScreen] = useState<Screen>('home')
  const [channels, setChannels] = useState<Channel[]>(() =>
    initialPlaylistState.kind === 'ready' ? initialPlaylistState.channels : [],
  )
  // TEMPORARY BOOT DIAGNOSTIC — remove alongside index.html's #boot-diag script.
  useEffect(() => {
    const el = document.getElementById('boot-diag')
    if (!el) return
    el.style.background = '#4caf50'
    el.textContent += '\n[App.tsx] APP MOUNTED AND RENDERED OK'
    const timer = setTimeout(() => el.remove(), 5000)
    return () => clearTimeout(timer)
  }, [])
  // DEV-only diagnostic hook for scripts/evaluate-real-playlist-channel-identity.ts
  // — exposes a SAFE projection of the in-memory playlist (no
  // ChannelSource.url, no credentials) on window so it can be exported from
  // devtools via `copy(JSON.stringify(window.__ninetyExportChannels))`.
  // Needed because a playlist this large can fail to round-trip through
  // localStorage (see session.ts's savePlaylist/QuotaExceededError), so the
  // only reliable way to get real playlist data out for that diagnostic is
  // straight from this tab's own React state.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as { __ninetyExportChannels?: unknown }).__ninetyExportChannels = channels.map((c) => {
      const parsed = parseCategory(c.groupTitle ?? '')
      return {
        id: c.id,
        name: c.name,
        groupTitle: c.groupTitle,
        country: parsed.countryName,
        category: parsed.mergedLabel,
        epgChannelIds: c.epgChannelIds,
        rawNames: c.rawNames,
        hasEpgChannelId: c.hasEpgChannelId,
      }
    })
  }, [channels])
  // The recorded source (Xtream creds / M3U URL / file-upload metadata) for
  // the connected playlist, kept alongside `channels` so a save persists
  // both — see session.ts. Also what drives startup recovery below when the
  // channel cache didn't survive but the source did.
  const [playlistSource, setPlaylistSource] = useState<PlaylistSourceRecord | null>(() =>
    initialPlaylistState.kind === 'ready' ? initialPlaylistState.source : null,
  )
  // Only set when the connected playlist was an Xtream source — EPG
  // (get_short_epg) only exists on that API, not for plain M3U playlists.
  // Derived from playlistSource rather than its own state so the two can
  // never drift apart.
  const xtreamCreds = useMemo(() => xtreamCredsFromSource(playlistSource), [playlistSource])
  // Channel Identity Resolver v2's runtime index — built once per (catalog
  // version, playlist) pair and reused by every event's Ninety-stage
  // channel match (see useChannelIdentityIndex.ts's own header for the
  // full cached-catalog/refresh/rebuild lifecycle). null until the first
  // build completes, or permanently null this session if no catalog is
  // reachable at all — matchChannelsForEvent degrades gracefully either
  // way (see channelMatch.ts).
  const identityIndex = useChannelIdentityIndex(channels)
  // Plain-language, non-technical message shown when the channel cache
  // couldn't be saved (or couldn't be auto-recovered) — see the persistence
  // effect and the startup-recovery effect below. Cleared once the user
  // dismisses it or a save/recovery later succeeds.
  const [playlistNotice, setPlaylistNotice] = useState<string | null>(null)
  // Shown on the setup screen only — when the only thing on record is a
  // file-upload source with no valid cache, there's nothing to auto-fetch
  // (the file's contents were never kept around), so the user is told
  // plainly that re-adding the file is required rather than the app
  // pretending it can recover on its own. See PlaylistSetupScreen's
  // `notice` prop.
  const [reconnectNotice] = useState<string | null>(() =>
    initialPlaylistState.kind === 'unrecoverable-file-source'
      ? `Ninety needs your playlist file again to reconnect — please re-add "${initialPlaylistState.source.fileName}" below.`
      : null,
  )
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
  //
  // savePlaylist writes the (small, cheap) source record even when the
  // (large, quota-risky) channel-cache write fails, so a failure here still
  // leaves a recoverable 'source-available-cache-missing' state behind for
  // next launch (see session.ts / playlistRecovery.ts) rather than forcing
  // the user to re-enter their playlist source from scratch. The toast
  // below exists so that recovery need isn't a silent surprise.
  useEffect(() => {
    if (channels.length === 0) return
    const persisted = savePlaylist(channels, playlistSource)
    if (!persisted) {
      // localStore.ts already logs the underlying error. This is the one
      // write in the app large enough to plausibly hit a storage quota —
      // when it happens, the connected playlist silently won't survive a
      // reload, so it's worth a distinct, findable log line here too.
      console.error('Playlist did not persist — it will need to be reconnected after a reload.')
      setPlaylistNotice(
        "Ninety couldn't fully save your playlist. It'll keep working for now, but you may need to reconnect it if the app restarts.",
      )
    } else {
      setPlaylistNotice(null)
    }
  }, [channels, playlistSource])

  // Startup recovery: if the small source record survived but the large
  // channel cache didn't (missing, or written under an older schema
  // version), automatically rebuild the cache from the source instead of
  // forcing the user back through setup — see loadPlaylistState()'s
  // 'source-available-cache-missing'/'source-available-cache-invalid'
  // outcomes. Only Xtream and M3U-URL sources are recoverable this way; a
  // file-upload source with no cache surfaces as reconnectNotice instead
  // (see the initial state for reconnectNotice below and the 'setup'
  // screen render). Runs once, off the snapshot read at module load.
  useEffect(() => {
    if (
      initialPlaylistState.kind !== 'source-available-cache-missing' &&
      initialPlaylistState.kind !== 'source-available-cache-invalid'
    ) {
      return
    }
    let cancelled = false
    const source = initialPlaylistState.source
    recoverChannelsFromSource(source)
      .then((recovered) => {
        if (cancelled) return
        setChannels(recovered)
        setPlaylistSource(source)
      })
      .catch((err) => {
        console.error('Automatic playlist recovery failed — the playlist will need to be reconnected manually.', err)
        if (!cancelled) {
          setPlaylistNotice("Ninety couldn't automatically reconnect your playlist. Open Channels to reconnect it.")
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once off the module-load snapshot, not live state
  }, [])

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
          onOpenAdmin={import.meta.env.DEV ? () => setAdminOpen(true) : undefined}
        />
      )}
      {screen === 'home' && (
        <HomeScreen
          channels={channels}
          xtreamCreds={xtreamCreds}
          identityIndex={identityIndex}
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
          identityIndex={identityIndex}
          onWatch={(channel, source) => watchChannel(channel, source, 'event-details')}
          onBack={() => setScreen(eventDetailsReturnScreen)}
          onBrowseChannels={() => setScreen('browse-cascade')}
        />
      )}

      {screen === 'setup' && (
        <PlaylistSetupScreen
          notice={reconnectNotice ?? undefined}
          onLoaded={(loaded, source) => {
            setChannels(loaded)
            setPlaylistSource(source)
            setScreen('browse-cascade')
          }}
        />
      )}

      {screen === 'onboarding' && (
        <OnboardingFlow
          onDone={(loaded, source) => {
            setChannels(loaded)
            setPlaylistSource(source)
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

      {playlistNotice && (
        <div className="playlist-persistence-toast" role="status">
          <span>{playlistNotice}</span>
          <button aria-label="Dismiss" onClick={() => setPlaylistNotice(null)}>
            ×
          </button>
        </div>
      )}

      {import.meta.env.DEV && adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}
    </>
  )
}

export default App
