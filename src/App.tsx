import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { ROOT_FOCUS_KEY, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { FocusDebugOverlay } from './core/platform'
import { TopNav } from './features/navigation/TopNav'
import { HomeScreen } from './features/home/HomeScreen'
import { AdminPanel } from './features/admin/AdminPanel'
import { hasCompletedOnboarding, loadPreferences } from './data/preferences'
import {
  loadFilters,
  saveFilters,
  loadFavoriteChannels,
  saveFavoriteChannels,
  loadFavoriteCategories,
  saveFavoriteCategories,
  loadRecentlyWatched,
  saveRecentlyWatched,
} from './data/session'
import { usePlaylistLibrary } from './data/playlists/usePlaylistLibrary'
import { CategoryChannelsScreen } from './features/channels/CategoryChannelsScreen'
import { BrowseCascadeScreen } from './features/channels/BrowseCascadeScreen'
import type { CascadeLevel } from './features/channels/BrowseCascadeScreen'
import { FilterPopup } from './features/channels/FilterPopup'
import { ChannelPlayerScreen } from './features/player/ChannelPlayerScreen'
import { parseCategory } from './features/channels/parseCategory'
import { getChannelIndex } from './data/channelIndex'
import { useChannelIdentityIndex } from './data/sports/useChannelIdentityIndex'
import { useHomeFeed } from './data/sports/useHomeFeed'
import { markPerf, measurePerf } from './core/perf/devPerf'
import { DEBUG_FORCE_SCREEN_KEY } from './core/debugForceScreen'
import { SCREEN_AFTER_ONBOARDING, resolveInitialScreen, type Screen } from './core/appScreens'
import type { Channel } from './data/channel'
import type { SportEvent } from './data/sports/types'
import type { EventStreamDisplayParts } from './features/eventDetails/ppvDisplayName'
import { createMultiviewSession } from './features/multiview/multiviewSession'
import type { MultiviewSession, PaneAssignment } from './features/multiview/multiviewSession'
import type { ChannelSource } from './data/channel'

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
const SettingsScreen = lazy(() => import('./features/settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen })))
// Heavy (up to 4 concurrent Player instances) and rare relative to the
// primary Home->Channels->Watch path — same lazy-loading rationale as
// EventDetailsScreen/CompetitionsScreen above.
const MultiviewScreen = lazy(() => import('./features/multiview/MultiviewScreen').then((m) => ({ default: m.MultiviewScreen })))

markPerf('app:module-load')

// `Screen`, resolveInitialScreen and SCREEN_AFTER_ONBOARDING live in
// core/appScreens.ts — pure, and therefore testable without mounting this
// entire module (hls.js, workers, network and all).

const RECENTLY_WATCHED_LIMIT = 30

// Root focus key each LAZY (React.lazy/Suspense) screen registers itself
// under (see each screen's own top-level useFocusable call). Screens NOT
// listed here (home, browse-cascade, the two CategoryChannelsScreen
// instances, player) are eagerly mounted, so the plain
// setFocus(ROOT_FOCUS_KEY) + forceFocus convention they already use has no
// race to fix — see the initial-focus effect below for why lazy screens
// need this instead.
//
// 'setup' and 'onboarding' share PlaylistSetupScreen's key: onboarding's
// step 1 IS PlaylistSetupScreen (see OnboardingFlow.tsx), so a fresh
// onboarding entry resolves to the same target as the standalone Setup
// screen. This now matters on every first launch, not just when a user
// goes looking for Channels — onboarding is the initial screen for a
// brand-new install, so its chunk is being fetched while this effect runs.
const SCREEN_FOCUS_KEYS: Partial<Record<Screen, string>> = {
  setup: 'setup-screen',
  onboarding: 'setup-screen',
  'event-details': 'event-details-screen',
  competitions: 'competitions-screen',
  settings: 'settings-screen',
  multiview: 'multiview-screen',
}

function App() {
  // A device's very first launch opens straight into onboarding; every
  // launch after that opens Home. See resolveInitialScreen (core/
  // appScreens.ts) for why, and for the DEV-only force-flag exception that
  // keeps AdminPanel's "Reset onboarding & preferences" reload working.
  //
  // Home's own data comes from ninety-api, not the connected IPTV playlists,
  // so when Home IS the initial screen it still has nothing to wait on —
  // the async playlist hydration below never blocks its first paint.
  const [screen, setScreen] = useState<Screen>(() => {
    const isDev = import.meta.env.DEV
    const forced = isDev ? sessionStorage.getItem(DEBUG_FORCE_SCREEN_KEY) : null
    if (forced) sessionStorage.removeItem(DEBUG_FORCE_SCREEN_KEY)
    return resolveInitialScreen({ forcedScreen: forced, isDev, onboardingComplete: hasCompletedOnboarding() })
  })

  // Every connected playlist, their combined channel list, and the
  // per-playlist Xtream credential resolver — see
  // data/playlists/usePlaylistLibrary.ts. This replaced App's former
  // single `playlist` state (one channels array, one source, one
  // generationId) plus its hydrate/persist effects; the atomicity,
  // pre-warming and never-block-first-paint behaviour those effects
  // carried moved into the hook unchanged.
  const library = usePlaylistLibrary()

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
  // — exposes a SAFE projection of the in-memory combined playlist (no
  // ChannelSource.url, no credentials) on window so it can be exported from
  // devtools via `copy(JSON.stringify(window.__ninetyExportChannels))`.
  // Needed because a playlist this large can fail to round-trip through
  // storage in some environments, so the only reliable way to get real
  // playlist data out for that diagnostic is straight from this tab's own
  // React state.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as { __ninetyExportChannels?: unknown }).__ninetyExportChannels = library.channels.map((c) => {
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
  }, [library.channels])
  // Prepared/indexed view of the COMBINED playlist set, built once per
  // playlist generation (memoized by the channels array's own reference —
  // see data/channelIndex.ts) instead of every consumer independently
  // rescanning the full ~30,925-channel array on every focus movement/state
  // change.
  const channelIndex = useMemo(() => getChannelIndex(library.channels), [library.channels])
  // Channel Identity Resolver v2's runtime index — built once per (catalog
  // version, playlist) pair and reused by every event's Ninety-stage
  // channel match (see useChannelIdentityIndex.ts's own header for the
  // full cached-catalog/refresh/rebuild lifecycle). null until the first
  // build completes, or permanently null this session if no catalog is
  // reachable at all — matchChannelsForEvent degrades gracefully either
  // way (see channelMatch.ts).
  const identityIndex = useChannelIdentityIndex(library.channels, library.generationId)
  // Owned here (not by HomeScreen) so its fetch/match state survives Home
  // unmounting while the user is on Event Details/Player/Channels and
  // remounting on Back — HomeScreen used to own this hook directly, which
  // meant every Home remount re-ran Effect 1's full network fetch from
  // scratch, showing a multi-second Loading state that didn't need to
  // reload anything. loadPreferences() is read fresh on every App render
  // (cheap sync localStorage read), same as HomeScreen used to do — Effect
  // 1 inside useHomeFeed only actually refetches when the derived prefsKey
  // string changes, e.g. right after onboarding calls savePreferences.
  const homeFeedState = useHomeFeed(loadPreferences(), library.channels, library.xtream, identityIndex)
  // Both playlist notices now live in the playlist library hook (it owns
  // every path that can produce one) — see PlaylistToast below for the
  // "couldn't save/reconnect" case and PlaylistSetupScreen's `notice` prop
  // for "this file playlist needs the file again".
  // The event the user drilled into from Home (hero or a Live Now/Coming Up
  // card) — set right before navigating to 'event-details', read by that
  // screen to know which fixture to look up broadcast channels for.
  const [selectedEvent, setSelectedEvent] = useState<SportEvent | null>(null)
  // Where Event Details' Back button should return to — Home or
  // Competitions, whichever the user drilled in from (same pattern as
  // playerReturnScreen below).
  const [eventDetailsReturnScreen, setEventDetailsReturnScreen] = useState<Screen>('home')
  // Where Settings' Back button should return to — whichever screen the
  // avatar was pressed from (Home, Competitions, or a Channels screen).
  const [settingsReturnScreen, setSettingsReturnScreen] = useState<Screen>('home')
  const [playingChannel, setPlayingChannel] = useState<Channel | null>(null)
  const [playingSourceLabel, setPlayingSourceLabel] = useState<string | undefined>(undefined)
  // The SportEvent behind the currently-playing channel, when known — set
  // alongside playingChannel by watchChannel below. Only ever non-null when
  // the watch came from Event Details (selectedEvent is already the right
  // event at that exact call site, since it's set right before navigating
  // there and doesn't change while the player is up) — every other watch
  // path (Home hero/Home favorite channels/Browse/Favorites/Recent) leaves
  // it null. Used by "Add to Multiview" (ChannelPlayerScreen) so a fresh
  // Multiview pane gets real event metadata/ranked candidates instead of
  // just a bare channel.
  const [playingEvent, setPlayingEvent] = useState<SportEvent | null>(null)
  // Contextual event-stream display identity (provider/event title/start
  // time/quality) carried from Event Details' StreamRow through to the
  // player overlay — see Part V of the redesign task. Undefined for every
  // OTHER watch path (Home, Browse, Favorites, Recent), which never pass a
  // third argument to watchChannel at all — the player falls back to its
  // existing selected?.name behavior for those, completely unchanged.
  const [playingDisplayParts, setPlayingDisplayParts] = useState<EventStreamDisplayParts | undefined>(undefined)
  // Where the player's Back button should return to — whichever list screen
  // (the cascade browser, favorites, or recently-watched) the user watched
  // from. Non-persisted, same as the rest of this in-memory nav state.
  const [playerReturnScreen, setPlayerReturnScreen] = useState<Screen>('browse-cascade')
  // Multiview session — pane assignments/focus/audio/maximize state only
  // (see multiviewSession.ts's own header on why no player instances live
  // here). null when Multiview has never been entered this session; kept
  // around (not reset to null) after Back so re-entering isn't currently
  // wired up to preserve it either way — "Add to Multiview" always starts a
  // fresh 1-pane session, see startMultiview below.
  const [multiviewSession, setMultiviewSession] = useState<MultiviewSession | null>(null)
  // Same return-screen pattern as playerReturnScreen — Back from the main
  // Multiview screen returns here, per the feature spec's own navigation
  // requirement.
  const [multiviewReturnScreen, setMultiviewReturnScreen] = useState<Screen>('browse-cascade')
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
  // column (country/category/channel/preview) was last active, via its own
  // `level`-keyed effect — since effects run child-before-parent, this
  // blanket call would otherwise fire afterward and win the race, always
  // snapping back to its default target regardless of where the user
  // actually was.
  //
  // For lazy (Suspense) screens this targets that screen's OWN root
  // focusKey (see SCREEN_FOCUS_KEYS above) instead of ROOT_FOCUS_KEY. That
  // isn't just cosmetic — it fixes a real race: `screen` can change (e.g.
  // 'home' -> 'competitions') while Suspense is still rendering `null`
  // waiting for the chunk, so this effect fires before the lazy screen's
  // focus tree exists. setFocus(ROOT_FOCUS_KEY) resolves synchronously
  // against whatever's registered RIGHT NOW (getForcedFocusKey scans
  // currently-mounted forceFocus components only) — with nothing mounted
  // yet, it silently aborts, and since `screen` itself doesn't change again
  // once the chunk finishes loading, nothing ever retries. Targeting the
  // screen's own focusKey instead relies on norigin's "preset key" behavior
  // (see SpatialNavigationService.addFocusable): setFocus(key) still
  // records that key as the pending focus target even when nothing with
  // that key is registered yet, and the screen's root container
  // self-focuses (via its own preferredChildFocusKey) the moment it mounts
  // and registers under that exact key — whenever that ends up happening.
  // No timers, no waiting for a ref.
  // Tracks the PREVIOUS screen value so leaving Settings can restore focus
  // to the exact avatar it was opened from — Settings is a full screen swap
  // (not a modal), so there's no local "remember the opener" closure the
  // way FilterPopup/AdminPanel have; App is the only place that knows both
  // the old and new screen.
  const previousScreenRef = useRef<Screen>(screen)
  useEffect(() => {
    const previousScreen = previousScreenRef.current
    previousScreenRef.current = screen
    if (screen === 'browse-cascade') return
    // Leaving Settings BACK to where it was opened from restores focus to
    // the avatar it was opened with. Since the Settings rebuild, Back is the
    // only way out of Settings — connecting and editing playlists happens in
    // its own dialogs rather than by navigating to the setup screen — so the
    // guard is really "did we return, or did something else change the
    // screen", and anything else still falls through to that screen's own
    // focus target below.
    if (previousScreen === 'settings' && screen === settingsReturnScreen) {
      void setFocus('nav-avatar')
      return
    }
    void setFocus(SCREEN_FOCUS_KEYS[screen] ?? ROOT_FOCUS_KEY)
  }, [screen, settingsReturnScreen])

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
    if (!playingChannel) return library.channels
    return [playingChannel, ...channelIndex.getSiblings(playingChannel)]
  }, [library.channels, channelIndex, playingChannel])

  // The freshest known version of selectedEvent — looked up by id in
  // useHomeFeed's own event map (kept current by its silent ~60s/
  // visibility-regain background refresh, see useHomeFeed.ts) rather than
  // the frozen snapshot captured at the moment the user drilled in. Falls
  // back to that frozen snapshot when the id isn't present (e.g. an event
  // reached via Competitions, which uses its own separate fetch and isn't
  // part of useHomeFeed's followed-leagues scope — out of scope for this
  // pass, see the live-scores task's final report) — Event Details still
  // works exactly as before for those, it just doesn't get live updates.
  const liveSelectedEvent = selectedEvent ? (homeFeedState.eventsById.get(selectedEvent.id) ?? selectedEvent) : null

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

  function watchChannel(
    channel: Channel,
    source: { label: string },
    fromScreen: Screen,
    displayParts?: EventStreamDisplayParts,
  ) {
    recordWatched(channel.id)
    setPlayingChannel(channel)
    setPlayingSourceLabel(source.label)
    setPlayingDisplayParts(displayParts)
    // See playingEvent's own comment above — selectedEvent is only the
    // right event when this watch actually came from Event Details.
    setPlayingEvent(fromScreen === 'event-details' ? selectedEvent : null)
    setPlayerReturnScreen(fromScreen)
    setScreen('player')
  }

  // "Add to Multiview" (ChannelPlayerScreen's toolbar). Uses the CHANNEL the
  // player screen reports as actually playing (which may have drifted from
  // playingChannel via in-player failover) for the channel-only fallback
  // path; playingEvent never changes mid-session once set, so it's safe to
  // read directly here and is preferred whenever available so the new pane
  // gets a real ranked candidate list rather than just one channel's own
  // sources. The originating ChannelSource itself isn't threaded through:
  // Multiview picks pane 1's initial quality via its own pane-count-aware
  // ranking (selectMultiviewSource) rather than carrying over whatever tier
  // solo playback happened to be on — a single-stream pick (often the
  // highest tier) is exactly what Multiview-aware ranking exists to
  // reconsider once more than one pane is active.
  function startMultiview(channel: Channel, _source: ChannelSource) {
    const assignment: PaneAssignment = playingEvent ? { kind: 'event', event: playingEvent } : { kind: 'channel', channel }
    setMultiviewSession(createMultiviewSession(assignment))
    setMultiviewReturnScreen(playerReturnScreen)
    setScreen('multiview')
  }

  return (
    <>
      {screen !== 'player' &&
        screen !== 'onboarding' &&
        screen !== 'multiview' &&
        screen !== 'event-details' &&
        screen !== 'settings' && (
        <TopNav
          // Event Details and Settings both render their own back-only
          // header instead of TopNav (see EventDetailsScreen.tsx and
          // SettingsScreen.tsx). For Settings that isn't cosmetic: TopNav is
          // 84px tall, so keeping it would push a screen designed for the
          // full 1080px canvas into page-level scrolling — the exact thing
          // the Settings rebuild exists to remove.
          activeItem={screen === 'home' ? 'Home' : screen === 'competitions' ? 'Competitions' : 'Channels'}
          onSelectHome={() => setScreen('home')}
          onSelectChannels={
            library.hydration === 'pending'
              ? undefined
              : () => {
                  markPerf('channels:open-start')
                  if (library.channels.length > 0) setScreen('browse-cascade')
                  // No playlist: just the plain reconnect screen. This no
                  // longer needs to branch on hasCompletedOnboarding() —
                  // onboarding is now the initial screen for a device that
                  // hasn't completed it (see resolveInitialScreen), so
                  // nobody can be standing on Home un-onboarded. Reaching
                  // Home means onboarding is done, whether a playlist was
                  // connected during it or skipped.
                  else setScreen('setup')
                }
          }
          onSelectCompetitions={() => setScreen('competitions')}
          onOpenSettings={() => {
            setSettingsReturnScreen(screen)
            setScreen('settings')
          }}
          onOpenAdmin={import.meta.env.DEV ? () => setAdminOpen(true) : undefined}
          // Only the standalone playlist-setup screen needs this: its form
          // starts on the far left, so nothing sits under the right-hand
          // avatar for norigin's geometric Down search to find. Every other
          // screen keeps the purely geometric behaviour.
          downFocusKey={screen === 'setup' ? 'setup-url' : undefined}
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
          xtream={library.xtream}
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

      {screen === 'settings' && (
        <SettingsScreen
          library={library}
          channelIndex={channelIndex}
          hiddenCountries={hiddenCountries}
          hiddenCategories={hiddenCategories}
          onChangeChannelVisibility={(nextCountries, nextCategories) => {
            setHiddenCountries(nextCountries)
            setHiddenCategories(nextCategories)
          }}
          recentlyWatchedCount={recentlyWatched.length}
          onClearRecentlyWatched={() => setRecentlyWatched([])}
          onBack={() => setScreen(settingsReturnScreen)}
        />
      )}

      {screen === 'event-details' && liveSelectedEvent && (
        <EventDetailsScreen
          event={liveSelectedEvent}
          channels={library.channels}
          xtream={library.xtream}
          identityIndex={identityIndex}
          favoriteChannels={favoriteChannels}
          onToggleFavoriteChannel={(id) => toggleInSet(favoriteChannels, setFavoriteChannels, id)}
          onWatch={(channel, source, displayParts) => watchChannel(channel, source, 'event-details', displayParts)}
          onBack={() => setScreen(eventDetailsReturnScreen)}
          onBrowseChannels={() => setScreen('browse-cascade')}
        />
      )}

      {screen === 'setup' && (
        <PlaylistSetupScreen
          variant="standalone"
          notice={library.reconnectNotice ?? undefined}
          onLoaded={(loaded, source) => {
            // ADDS a playlist rather than replacing the library — Settings
            // owns editing an existing playlist. The one exception is the
            // other reason this screen is reached: re-supplying the file a
            // playlist is waiting for (library.reconnectNotice above), which
            // restores THAT playlist in place instead of leaving the broken
            // row beside a duplicate. See playlists/reconnectTarget.ts.
            //
            // The library hook handles persistence and the ChannelIndex
            // pre-warm, so the screen transition still never lands on the
            // same main-thread task as a ~30,000-channel index build.
            void library.addOrReconnectPlaylist(source, loaded).then(() => setScreen('browse-cascade'))
          }}
        />
      )}

      {screen === 'onboarding' && (
        <OnboardingFlow
          onDone={(loaded, source) => {
            // Step 1 can be skipped, in which case there is no playlist to
            // install at all — go straight to Home rather than adding an
            // empty playlist to the library. `source` is null on exactly
            // that path, so the two are checked together.
            if (loaded.length === 0 || !source) {
              setScreen(SCREEN_AFTER_ONBOARDING)
              return
            }
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
            // addPlaylist persists the playlist AND pre-warms the
            // ChannelIndex before installing it, so this transition still
            // never lands a ~30,000-channel index build on the same
            // main-thread task as the screen change. Home, not the channel
            // browser — onboarding exists to personalize Home (sports +
            // leagues + preferred countries all feed useHomeFeed), and
            // loadPreferences() is re-read on every App render, so the
            // preferences savePreferences just wrote are picked up by
            // useHomeFeed's prefsKey on this very transition; no restart, no
            // second preferences store.
            void library.addOrReconnectPlaylist(source, loaded).then(() => setScreen(SCREEN_AFTER_ONBOARDING))
          }}
        />
      )}

      {screen === 'browse-cascade' && (
        <BrowseCascadeScreen
          channelIndex={channelIndex}
          xtream={library.xtream}
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
          xtream={library.xtream}
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
          xtream={library.xtream}
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
          initialDisplayParts={playingDisplayParts}
          onBack={() => {
            setScreen(playerReturnScreen)
            // Immediate silent refresh on Player exit — the primary
            // staleness scenario this feature exists for (watch a live
            // match for two hours, Home/Event Details must already show
            // the final state on return, not wait up to 60s for the next
            // periodic tick). Safe to call unconditionally: useHomeFeed's
            // own in-flight guard already no-ops this if a refresh is
            // already running.
            homeFeedState.refresh()
          }}
          onAddToMultiview={startMultiview}
        />
      )}

      {screen === 'multiview' && multiviewSession && (
        <MultiviewScreen
          session={multiviewSession}
          onSessionChange={(updater) => setMultiviewSession((prev) => (prev ? updater(prev) : prev))}
          channels={library.channels}
          xtream={library.xtream}
          identityIndex={identityIndex}
          favoriteChannels={favoriteChannels}
          favoriteChannelsList={favoriteChannelsList}
          recentChannelsList={recentChannelsList}
          homeFeed={homeFeedState.feed}
          onBack={() => setScreen(multiviewReturnScreen)}
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

      {library.notice && <PlaylistToast message={library.notice} onDismiss={library.dismissNotice} />}

      {import.meta.env.DEV && adminOpen && (
        <AdminPanel channels={library.channels} onClose={() => setAdminOpen(false)} />
      )}
      {import.meta.env.DEV && (
        <FocusDebugOverlay screen={screen} region={screen === 'browse-cascade' ? cascadeLevel : undefined} overlay={filterOpen ? 'filter' : adminOpen ? 'admin' : null} />
      )}
      </Suspense>
    </>
  )
}

// Was mouse-only (a plain onClick button) — the × can now be reached with
// the remote too, via a stable (not forceFocus) key: this toast can appear
// over any screen, so it deliberately doesn't compete for that screen's own
// initial-focus target, but a user who does navigate to it can still
// dismiss it. Also auto-dismisses on a timer so a persistence failure
// notice can't sit there indefinitely covering content if nobody happens to
// navigate to it.
const PLAYLIST_TOAST_AUTO_DISMISS_MS = 12000

function PlaylistToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const { ref, focused } = useFocusable({ focusKey: 'playlist-toast-dismiss', onEnterPress: onDismiss })

  useEffect(() => {
    const id = setTimeout(onDismiss, PLAYLIST_TOAST_AUTO_DISMISS_MS)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message])

  return (
    <div className="playlist-persistence-toast" role="status">
      <span>{message}</span>
      <button ref={ref} className={focused ? 'focused' : ''} aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}

export default App
