import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { ROOT_FOCUS_KEY, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { TopNav } from './features/navigation/TopNav'
import { HomeScreen } from './features/home/HomeScreen'
import { AdminPanel } from './features/admin/AdminPanel'
import { hasCompletedOnboarding, loadPreferences } from './data/preferences'
import {
  loadFilters,
  hydratePlaylistState,
  xtreamCredsFromSource,
  saveFilters,
  saveSource,
  savePlaylistChannels,
  removeLegacyPlaylistChannelsCache,
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
import { parseCategory } from './features/channels/parseCategory'
import { getChannelIndex, warmChannelIndexAsync } from './data/channelIndex'
import { generatePlaylistGenerationId } from './data/playlistGeneration'
import { useChannelIdentityIndex } from './data/sports/useChannelIdentityIndex'
import { useHomeFeed } from './data/sports/useHomeFeed'
import { markPerf, measurePerf } from './core/perf/devPerf'
import type { Channel } from './data/channel'
import type { PlaylistSourceRecord } from './data/session'
import type { SportEvent } from './data/sports/types'

// Lazy-loaded: screens that are rare (first-run-only onboarding, dev-admin
// already tree-shaken separately) or off the primary Home->Channels->Watch
// hot path (Event Details, Competitions). Measured via `npm run build`
// before/after — moving these out of the main chunk is a real reduction to
// what has to parse/execute before the app is interactive; see the final
// report for before/after chunk sizes. Deliberately NOT applied to
// HomeScreen (always the first screen), BrowseCascadeScreen/
// CategoryChannelsScreen/FilterPopup/ChannelPlayerScreen (the
// latency-sensitive primary navigation path — lazy-loading those risked
// adding a visible stall exactly where "Channels-open should feel
// essentially immediate" matters most) or AdminPanel (already fully
// tree-shaken out of production builds by its own `import.meta.env.DEV &&`
// guard — lazy-loading it would provide no additional benefit and would
// undo that free win by forcing a real chunk to exist).
const PlaylistSetupScreen = lazy(() =>
  import('./features/setup/PlaylistSetupScreen').then((m) => ({ default: m.PlaylistSetupScreen })),
)
const OnboardingFlow = lazy(() => import('./features/onboarding/OnboardingFlow').then((m) => ({ default: m.OnboardingFlow })))
const EventDetailsScreen = lazy(() =>
  import('./features/eventDetails/EventDetailsScreen').then((m) => ({ default: m.EventDetailsScreen })),
)
const CompetitionsScreen = lazy(() =>
  import('./features/competitions/CompetitionsScreen').then((m) => ({ default: m.CompetitionsScreen })),
)

markPerf('app:module-load')

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

// The connected playlist's channels/source/generationId, updated together as
// one atomic unit (via installPlaylist below) so no code path can ever
// observe/persist a torn combination of old channels with a new source, or
// vice versa — this matters because the playlist-persistence effect keys its
// "did this generation already get written to IndexedDB" guard off
// reference identity across all three fields at once.
interface PlaylistState {
  channels: Channel[]
  source: PlaylistSourceRecord | null
  generationId: string | null
}
const EMPTY_PLAYLIST: PlaylistState = { channels: [], source: null, generationId: null }

function App() {
  // Home always opens first — its data comes from TheSportsDB, not the
  // connected IPTV playlist, so there's nothing it needs to wait on. This
  // holds on every launch, including a device's very first one: onboarding
  // (which starts with connecting a playlist — Steg 25) only kicks in once
  // the user actually goes looking for Channels, via onSelectChannels below.
  const [screen, setScreen] = useState<Screen>('home')

  // Playlist state now hydrates asynchronously from IndexedDB (see
  // session.ts's hydratePlaylistState) instead of a synchronous
  // localStorage JSON.parse at module load — a ~30,925-channel playlist
  // would otherwise block the very first paint. Starts empty; Home renders
  // and accepts input immediately regardless (see hydrationStatus below).
  const [playlist, setPlaylist] = useState<PlaylistState>(EMPTY_PLAYLIST)
  function installPlaylist(channels: Channel[], source: PlaylistSourceRecord | null, generationId: string) {
    setPlaylist({ channels, source, generationId })
  }
  // Marks whichever exact channels array a cache-hit hydration produced —
  // the playlist-persistence effect below skips writing when `playlist
  // .channels` is still reference-equal to this, since that data is already
  // durably stored and re-writing it would be a redundant IndexedDB write
  // immediately after reading the very same thing back.
  const hydratedChannelsRef = useRef<Channel[] | null>(null)
  const [hydrationStatus, setHydrationStatus] = useState<'pending' | 'done'>('pending')

  // DEV-perf: module-load -> first mount timing (markPerf('app:module-load')
  // fires once, above, at the top of this file, when the module first
  // evaluates).
  useEffect(() => {
    markPerf('app:mounted')
    measurePerf('app:boot-to-mount', 'app:module-load', 'app:mounted')
    // TEMPORARY, 2026-08-19: clears the boot-diag overlay (index.html) once
    // App has actually committed/painted — see main.tsx for the rest of this
    // diagnostic. Remove alongside the overlay once resolved.
    ;(window as unknown as { __ninetyBootMounted?: () => void }).__ninetyBootMounted?.()
  }, [])

  // DEV-only diagnostic hook for scripts/evaluate-real-playlist-channel-identity.ts
  // — exposes a SAFE projection of the in-memory playlist (no
  // ChannelSource.url, no credentials) on window so it can be exported from
  // devtools via `copy(JSON.stringify(window.__ninetyExportChannels))`.
  // Needed because a playlist this large can fail to round-trip through
  // storage in some environments, so the only reliable way to get real
  // playlist data out for that diagnostic is straight from this tab's own
  // React state.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as { __ninetyExportChannels?: unknown }).__ninetyExportChannels = playlist.channels.map((c) => {
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
  }, [playlist.channels])
  // Only set when the connected playlist was an Xtream source — EPG
  // (get_short_epg) only exists on that API, not for plain M3U playlists.
  // Derived from playlist.source rather than its own state so the two can
  // never drift apart.
  const xtreamCreds = useMemo(() => xtreamCredsFromSource(playlist.source), [playlist.source])
  // Prepared/indexed view of the playlist, built once per playlist
  // generation (memoized by `playlist.channels`'s own array reference — see
  // data/channelIndex.ts) instead of every consumer independently rescanning
  // the full ~30,925-channel array on every focus movement/state change.
  const channelIndex = useMemo(() => getChannelIndex(playlist.channels), [playlist.channels])
  // Channel Identity Resolver v2's runtime index — built once per (catalog
  // version, playlist) pair and reused by every event's Ninety-stage
  // channel match (see useChannelIdentityIndex.ts's own header for the
  // full cached-catalog/refresh/rebuild lifecycle). null until the first
  // build completes, or permanently null this session if no catalog is
  // reachable at all — matchChannelsForEvent degrades gracefully either
  // way (see channelMatch.ts).
  const identityIndex = useChannelIdentityIndex(playlist.channels, playlist.generationId)
  // Owned here (not by HomeScreen) so its fetch/match state survives Home
  // unmounting while the user is on Event Details/Player/Channels and
  // remounting on Back — HomeScreen used to own this hook directly, which
  // meant every Home remount re-ran Effect 1's full network fetch from
  // scratch, showing a multi-second Loading state that didn't need to
  // reload anything. loadPreferences() is read fresh on every App render
  // (cheap sync localStorage read), same as HomeScreen used to do — Effect
  // 1 inside useHomeFeed only actually refetches when the derived prefsKey
  // string changes, e.g. right after onboarding calls savePreferences.
  const homeFeedState = useHomeFeed(loadPreferences(), playlist.channels, xtreamCreds, identityIndex)
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
  const [reconnectNotice, setReconnectNotice] = useState<string | null>(null)
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

  // Startup: hydrate playlist state from IndexedDB (fast, async, never
  // blocks first paint) and, if the large channel cache is missing/stale but
  // the small source record survived, automatically rebuild it from source
  // instead of forcing the user back through setup — see
  // session.ts's hydratePlaylistState()'s 'recovering' outcome. Only Xtream
  // and M3U-URL sources are recoverable this way; a file-upload source with
  // no cache surfaces as reconnectNotice instead. Runs once, on mount.
  useEffect(() => {
    let cancelled = false
    markPerf('playlist:hydrate-start')
    void hydratePlaylistState().then(async (result) => {
      markPerf('playlist:hydrate-end')
      measurePerf('playlist:hydrate', 'playlist:hydrate-start', 'playlist:hydrate-end')
      if (cancelled) return
      if (result.kind === 'ready') {
        // Pre-warm the ChannelIndex cache (chunked, yielding between
        // batches) BEFORE installPlaylist triggers the render that would
        // otherwise force useMemo(() => getChannelIndex(...)) to build it
        // synchronously in one large main-thread task — see
        // data/channelIndex.ts's warmChannelIndexAsync for why this matters
        // on lower-powered Tizen hardware at ~30,925-channel scale.
        await warmChannelIndexAsync(result.channels)
        if (cancelled) return
        installPlaylist(result.channels, result.source, result.generationId)
        hydratedChannelsRef.current = result.channels
        removeLegacyPlaylistChannelsCache()
      } else if (result.kind === 'recovering') {
        try {
          const recovered = await recoverChannelsFromSource(result.source)
          if (cancelled) return
          await warmChannelIndexAsync(recovered)
          if (cancelled) return
          // Deliberately NO explicit savePlaylistChannels call here — the
          // playlist-persistence effect below is the ONE place that writes
          // the large channel cache, so a fresh recovery performs exactly
          // one IndexedDB write (via that effect reacting to this state
          // change), never two.
          installPlaylist(recovered, result.source, generatePlaylistGenerationId())
        } catch (err) {
          console.error('Automatic playlist recovery failed — the playlist will need to be reconnected manually.', err)
          if (!cancelled) {
            setPlaylistNotice("Ninety couldn't automatically reconnect your playlist. Open Channels to reconnect it.")
          }
        }
      } else if (result.kind === 'unrecoverable-file-source') {
        setReconnectNotice(
          `Ninety needs your playlist file again to reconnect — please re-add "${result.source.fileName}" below.`,
        )
      }
      if (!cancelled) setHydrationStatus('done')
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Persist the connected playlist whenever it changes (setup, onboarding,
  // or reconnecting) — the ONLY place savePlaylistChannels is called, so a
  // fresh connect/recovery performs exactly one large IndexedDB write, never
  // two. Skips: the empty initial state (nothing to save); the exact array
  // a cache-hit hydration just produced (already durably stored — see
  // hydratedChannelsRef above); and the brief instant before the first
  // installPlaylist call has ever run (no generationId yet).
  //
  // savePlaylistChannels only writes the large channel cache; saveSource
  // (small, essentially-never-fails) is written alongside it so a channel-
  // cache write failure still leaves a recoverable source record behind for
  // next launch. The toast below exists so that isn't a silent surprise.
  useEffect(() => {
    if (playlist.channels.length === 0) return
    if (playlist.channels === hydratedChannelsRef.current) return
    if (!playlist.generationId) return
    let cancelled = false
    void savePlaylistChannels(playlist.channels, playlist.generationId).then((persisted) => {
      if (cancelled) return
      if (!persisted) {
        // localStore.ts/idb.ts already log the underlying error. This is
        // the one write in the app large enough to plausibly fail — when it
        // happens, the connected playlist silently won't survive a reload,
        // so it's worth a distinct, findable log line here too.
        console.error('Playlist did not persist — it will need to be reconnected after a reload.')
        setPlaylistNotice(
          "Ninety couldn't fully save your playlist. It'll keep working for now, but you may need to reconnect it if the app restarts.",
        )
      } else {
        removeLegacyPlaylistChannelsCache()
        setPlaylistNotice(null)
      }
    })
    saveSource(playlist.source)
    return () => {
      cancelled = true
    }
  }, [playlist])

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
  // Uses the prepared ChannelIndex (O(1) bucket lookup) instead of
  // rescanning + re-parseCategory-ing the whole playlist on every playing-
  // channel change.
  const playerChannels = useMemo(() => {
    if (!playingChannel) return playlist.channels
    return [playingChannel, ...channelIndex.getSiblings(playingChannel)]
  }, [playlist.channels, channelIndex, playingChannel])

  function toggleInSet(set: Set<string>, setSet: (s: Set<string>) => void, value: string) {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setSet(next)
  }

  function recordWatched(channelId: string) {
    setRecentlyWatched((prev) => [channelId, ...prev.filter((id) => id !== channelId)].slice(0, RECENTLY_WATCHED_LIMIT))
  }

  // Both resolve through ChannelIndex's by-id map — O(k) in the number of
  // favorites/recents, not O(playlist size) — so toggling a favorite or
  // watching a channel no longer scans the full ~30,925-channel playlist on
  // the main thread (see the Samsung-TV favorite-toggle freeze report).
  const favoriteChannelsList = useMemo(
    () => channelIndex.getChannelsByIdsInPlaylistOrder(favoriteChannels),
    [channelIndex, favoriteChannels],
  )

  const recentChannelsList = useMemo(() => {
    return recentlyWatched.map((id) => channelIndex.getChannelById(id)).filter((c): c is Channel => c != null)
  }, [channelIndex, recentlyWatched])

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
          onSelectChannels={
            hydrationStatus === 'pending'
              ? undefined
              : () => {
                  markPerf('channels:open-start')
                  if (playlist.channels.length > 0) setScreen('browse-cascade')
                  // No playlist yet: a device's true first-ever Channels visit
                  // goes through the full onboarding wizard (Sports/Countries,
                  // plus playlist connect as its first step); anyone already
                  // onboarded but currently playlist-less (e.g. cleared storage)
                  // gets just the plain reconnect screen instead.
                  else setScreen(hasCompletedOnboarding() ? 'setup' : 'onboarding')
                }
          }
          onSelectCompetitions={() => setScreen('competitions')}
          onOpenAdmin={import.meta.env.DEV ? () => setAdminOpen(true) : undefined}
        />
      )}
      {/* TopNav stays outside this boundary deliberately — it's never lazy,
          so it never suspends, but a Suspense boundary hides its ENTIRE
          children while any descendant inside it is loading. Keeping TopNav
          out means it stays visible (exactly as today) while a lazy screen's
          chunk is still being fetched, instead of the whole top bar
          flashing away too. */}
      <Suspense fallback={null}>
      {screen === 'home' && (
        <HomeScreen
          feedState={homeFeedState}
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
          channels={playlist.channels}
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
            const generationId = generatePlaylistGenerationId()
            // Pre-warm before installPlaylist for the same reason as the
            // bootstrap effect above — avoids a synchronous ChannelIndex
            // build landing on the same tick as the screen transition.
            void warmChannelIndexAsync(loaded).finally(() => {
              installPlaylist(loaded, source, generationId)
              setScreen('browse-cascade')
            })
          }}
        />
      )}

      {screen === 'onboarding' && (
        <OnboardingFlow
          onDone={(loaded, source) => {
            const generationId = generatePlaylistGenerationId()
            // Country detection for the initial filter doesn't depend on
            // ChannelIndex — safe to compute immediately, in parallel with
            // the pre-warm below (parseCategory's own memoization already
            // makes this loop cheap; ChannelIndex's pre-warm will hit the
            // same cache).
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
            // Pre-warm before installPlaylist for the same reason as the
            // bootstrap effect above — avoids a synchronous ChannelIndex
            // build landing on the same tick as the screen transition.
            void warmChannelIndexAsync(loaded).finally(() => {
              installPlaylist(loaded, source, generationId)
              setScreen('browse-cascade')
            })
          }}
        />
      )}

      {screen === 'browse-cascade' && (
        <BrowseCascadeScreen
          channelIndex={channelIndex}
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
          channelIndex={channelIndex}
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

      {import.meta.env.DEV && adminOpen && (
        <AdminPanel channels={playlist.channels} onClose={() => setAdminOpen(false)} />
      )}
      </Suspense>
    </>
  )
}

export default App
