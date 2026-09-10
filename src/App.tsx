import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { ROOT_FOCUS_KEY, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { FocusDebugOverlay, exitApp, setUnhandledBackHandler, useAppLifecycle, useNetworkStatus } from './core/platform'
import { ExitConfirmDialog } from './features/exit/ExitConfirmDialog'
import { NetworkOfflineNotice } from './features/network/NetworkOfflineNotice'
import { EntitlementRequiredScreen } from './features/entitlement/EntitlementRequiredScreen'
import { useDeviceEntitlement } from './data/useDeviceEntitlement'
import { TopNav } from './features/navigation/TopNav'
import { HomeScreen } from './features/home/HomeScreen'
import { AdminPanel } from './features/admin/AdminPanel'
import { hasCompletedOnboarding, loadPreferences } from './data/preferences'
import {
  loadFilters,
  saveFilters,
  loadFavoriteChannels,
  saveFavoriteChannels,
  loadRecentlyWatched,
  saveRecentlyWatched,
} from './data/session'
import { usePlaylistLibrary } from './data/playlists/usePlaylistLibrary'
import { isResyncable } from './data/playlists/playlistDefinition'
import { CategoryChannelsScreen } from './features/channels/CategoryChannelsScreen'
import { BrowseCascadeScreen } from './features/channels/BrowseCascadeScreen'
import type { CascadeLevel } from './features/channels/BrowseCascadeScreen'
import type { ChannelsEntryIntent } from './features/channels/channelsEntryIntent'
import { ChannelPlayerScreen } from './features/player/ChannelPlayerScreen'
import { parseCategory } from './features/channels/parseCategory'
import { getChannelIndex } from './data/channelIndex'
import { useChannelIdentityIndex } from './data/sports/useChannelIdentityIndex'
import { useHomeFeed } from './data/sports/useHomeFeed'
import { recordEventOpened, recordEventWatched } from './data/sports/watchAffinity'
import { LazyScreenFallback, LoadingScreen, PLAYLIST_IMPORT_STAGES, PLAYLIST_IMPORT_TITLE, useDeferredBusy } from './core/ui'
import type { PlaylistImportStage } from './core/ui'
import { markPerf, measurePerf } from './core/perf/devPerf'
import { DEBUG_FORCE_SCREEN_KEY } from './core/debugForceScreen'
import { SCREEN_AFTER_ONBOARDING, resolveInitialScreen, type Screen } from './core/appScreens'
import type { Channel } from './data/channel'
import type { PlaylistSourceRecord } from './data/session'
import type { SportEvent } from './data/sports/types'
import type { EventPlaybackGroup } from './features/eventDetails/eventPlaybackGroup'
import { createMultiviewSession } from './features/multiview/multiviewSession'
import type { MultiviewSession, PaneAssignment } from './features/multiview/multiviewSession'
import type { ChannelSource } from './data/channel'
import type { SettingsSectionId } from './features/settings/settingsSections'

// Lazy-loaded: screens that are rare (first-run-only onboarding, dev-admin
// already tree-shaken separately) or off the primary Home->Channels->Watch
// hot path (Event Details, Schedule). Measured via `npm run build`
// before/after — moving these out of the main chunk is a real reduction to
// what has to parse/execute before the app is interactive; see the final
// report for before/after chunk sizes. Deliberately NOT applied to
// HomeScreen (always the first screen), BrowseCascadeScreen/
// CategoryChannelsScreen/ChannelPlayerScreen (the
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
const ScheduleScreen = lazy(() => import('./features/schedule/ScheduleScreen').then((m) => ({ default: m.ScheduleScreen })))
const SettingsScreen = lazy(() => import('./features/settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen })))
// Heavy (up to 4 concurrent Player instances) and rare relative to the
// primary Home->Channels->Watch path — same lazy-loading rationale as
// EventDetailsScreen/ScheduleScreen above.
const MultiviewScreen = lazy(() => import('./features/multiview/MultiviewScreen').then((m) => ({ default: m.MultiviewScreen })))

markPerf('app:module-load')

// `Screen`, resolveInitialScreen and SCREEN_AFTER_ONBOARDING live in
// core/appScreens.ts — pure, and therefore testable without mounting this
// entire module (hls.js, workers, network and all).

const RECENTLY_WATCHED_LIMIT = 30

// The three screens that show a list of channels, and therefore the three
// that can act on a channel return intent (see channelsEntryIntent.ts).
// Watching from Home or Event Details returns to Home or Event Details, and
// neither has a row to restore.
const CHANNEL_LIST_SCREENS: readonly Screen[] = ['browse-cascade', 'channels-favorites', 'channels-recent']

// See the settingsEntry state below.
interface SettingsEntry {
  returnScreen: Screen
  // Deep-linked section, for an entry that exists to do one specific thing.
  // Undefined for the ordinary avatar entry, which keeps Settings' own
  // INITIAL_SETTINGS_SECTION.
  section?: SettingsSectionId
  // Which Channels toolbar button Back should return focus to, when Back
  // returns to Channels and Settings was reached from one of its actions.
  returnFocus?: 'filters'
}

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
  // Internal screen id stayed 'competitions' when the surface became
  // Schedule (see features/schedule/ScheduleScreen.tsx); the focus key
  // follows the screen's own root key, which did change.
  competitions: 'schedule-screen',
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
  // Read fresh on every render (a cheap sync localStorage read) so a
  // savePreferences from onboarding/Settings is picked up without a
  // restart — hoisted into one binding because Channels now needs the same
  // object for its preferred-country ORDER, and two independent reads per
  // render would be two chances to disagree.
  const preferences = loadPreferences()
  const homeFeedState = useHomeFeed(preferences, library.channels, library.xtream, identityIndex)
  // Both playlist notices now live in the playlist library hook (it owns
  // every path that can produce one) — see PlaylistToast below for the
  // "couldn't save/reconnect" case and PlaylistSetupScreen's `notice` prop
  // for "this file playlist needs the file again".
  // The event the user drilled into from Home (hero or a Live Now/Coming Up
  // card) — set right before navigating to 'event-details', read by that
  // screen to know which fixture to look up broadcast channels for.
  const [selectedEvent, setSelectedEvent] = useState<SportEvent | null>(null)
  // Where Event Details' Back button should return to — Home or Schedule,
  // whichever the user drilled in from (same pattern as playerReturnScreen
  // below).
  const [eventDetailsReturnScreen, setEventDetailsReturnScreen] = useState<Screen>('home')
  // HOW SETTINGS WAS ENTERED, which decides three things at once: where
  // Back returns to, which section it opens on, and where focus lands on the
  // way out. Kept as one object rather than three loose pieces of state
  // because they are only ever set together, and a Back that returns to the
  // right screen while restoring the wrong focus is exactly the kind of
  // half-updated navigation this pass exists to remove.
  const [settingsEntry, setSettingsEntry] = useState<SettingsEntry>({ returnScreen: 'home' })
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
  // The whole logical stream group Event Details handed to playback — every
  // quality variant of ONE broadcaster/event feed, best-first, plus its
  // contextual display identity (see eventPlaybackGroup.ts). Undefined for
  // every OTHER watch path (Home, Browse, Favorites, Recent), which play a
  // single channel's own sources and keep the player's existing
  // channel-name/Source-menu behavior completely unchanged.
  const [playingGroup, setPlayingGroup] = useState<EventPlaybackGroup | undefined>(undefined)
  // Where the player's Back button should return to — whichever list screen
  // (the cascade browser, favorites, or recently-watched) the user watched
  // from. Non-persisted, same as the rest of this in-memory nav state.
  const [playerReturnScreen, setPlayerReturnScreen] = useState<Screen>('browse-cascade')
  // WHERE BACK LEAVES CHANNELS TO — the screen the viewer entered the
  // browser FROM, not a hardcoded Home. It matters for exactly one entry
  // point today: Event Details' "Check channels manually", which sends a
  // viewer off to look for a stream Ninety could not find for them. Landing
  // them on Home when they back out would strand them somewhere they never
  // asked to be, several presses from the fixture they were reading about.
  //
  // Set at every entry INTO the browser rather than cleared on the way out,
  // so it can never be left pointing at a stale screen. Navigating around
  // inside Channels (Favorites, Recently Watched, the player) deliberately
  // does not touch it — those all come back to the browser, not through it.
  const [channelsExitScreen, setChannelsExitScreen] = useState<Screen>('home')
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

  // WHY THE VIEWER IS ARRIVING AT A CHANNELS SCREEN — a one-shot,
  // explicitly-stated return intent rather than anything inferred from
  // norigin's remembered last-focused child (see channelsEntryIntent.ts for
  // why that distinction is load-bearing). Set at the moment a screen
  // navigates away from Channels, consumed by whichever Channels screen
  // mounts next, then cleared.
  const [channelsEntryIntent, setChannelsEntryIntent] = useState<ChannelsEntryIntent | null>(null)
  const clearChannelsEntryIntent = useCallback(() => setChannelsEntryIntent(null), [])

  // The cascade browser's drill-down path — lifted up here (rather than
  // living inside BrowseCascadeScreen) so it survives navigating away to
  // watch a channel full-screen and coming back; the screen would otherwise
  // reset to the top on remount.
  const [cascadeLevel, setCascadeLevel] = useState<CascadeLevel>('country')
  const [cascadeCountry, setCascadeCountry] = useState<string | null>(null)
  const [cascadeCategory, setCascadeCategory] = useState<string | null>(null)
  const [cascadeChannel, setCascadeChannel] = useState<Channel | null>(null)

  // Installing a playlist — merging, persisting and building the ~30,000
  // channel ChannelIndex — is the one operation in the app long enough that
  // the screen it leads to genuinely cannot render yet. `active` and `stage`
  // are one state object so the stage SURVIVES the operation finishing: the
  // overlay outlives `active` by its minimum-visible window (see
  // useDeferredBusy), and re-reading a cleared stage during that tail would
  // visibly rewrite the caption on the way out.
  const [install, setInstall] = useState<{ active: boolean; stage: PlaylistImportStage }>({
    active: false,
    stage: 'organizing',
  })
  const installing = useDeferredBusy(install.active)

  // Wraps every path that hands freshly-loaded channels to the library, so
  // none of them can forget the loading state or leave it stuck on. Resolves
  // to whether the install succeeded, so callers only navigate on success.
  const installPlaylist = useCallback(
    async (source: PlaylistSourceRecord, channels: Channel[]): Promise<boolean> => {
      setInstall({ active: true, stage: 'organizing' })
      try {
        await library.addOrReconnectPlaylist(source, channels)
        return true
      } catch (err) {
        console.warn('[app] playlist install failed:', err)
        return false
      } finally {
        // Stage deliberately retained — see the state's own comment.
        setInstall((prev) => ({ ...prev, active: false }))
      }
    },
    [library],
  )

  const [hiddenCountries, setHiddenCountries] = useState<Set<string>>(() => new Set(loadFilters().hiddenCountries))
  // Composite `${country}::${category}` keys — see categoryFavoriteKey.
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(() => new Set(loadFilters().hiddenCategories))
  const [adminOpen, setAdminOpen] = useState(false)

  // Favorited channels are pinned to the top of their list. Categories used
  // to be favoritable too; that went away on 2026-08-31 — see session.ts.
  const [favoriteChannels, setFavoriteChannels] = useState<Set<string>>(() => loadFavoriteChannels())

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
  // 'home' -> 'competitions', the Schedule screen) while Suspense is still
  // rendering `null` waiting for the chunk, so this effect fires before the
  // lazy screen's focus tree exists. setFocus(ROOT_FOCUS_KEY) resolves synchronously
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
  // way AdminPanel has; App is the only place that knows both the old and
  // the new screen.
  // THE PLAYBACK GATE (see usePlaylistLibrary's setPlaybackActive). App is
  // the only place that knows whether a screen owning live video is up, so
  // it is the only place that can tell the sync coordinator. Both screens
  // count: Multiview can have four decoders running, which is if anything
  // the more fragile of the two.
  //
  // Deliberately its own effect, deliberately calling a ref-writing
  // callback: telling the library that playback started must not re-render
  // the library's consumers, and must not be entangled with the focus
  // effect below.
  const setPlaybackActive = library.setPlaybackActive
  useEffect(() => {
    setPlaybackActive(screen === 'player' || screen === 'multiview')
  }, [screen, setPlaybackActive])

  // ---- Samsung TV lifecycle: Return/Exit, network, multitasking ----

  // LEAVING PLAYBACK, stated once. Both the Player's own Back button and
  // the multitasking handler below need "return from playback", and Samsung
  // requires the hidden-app behaviour to be the SAME semantic action as
  // Return during playback — so it is one function called from both places
  // rather than two implementations that can drift.
  //
  // Idempotent: a second call while already off the player screen is a
  // harmless no-op (setScreen to the same value, an intent nobody consumes),
  // which matters because visibilitychange can fire again during app exit.
  const exitPlayback = useCallback(
    (from: Screen) => {
      if (from === 'player') {
        // BACK FROM THE PLAYER RETURNS TO THE CHANNEL, not to the top of
        // the list — the return intent introduced in 201126f, preserved
        // exactly (see channelsEntryIntent.ts).
        if (playingChannel && CHANNEL_LIST_SCREENS.includes(playerReturnScreen)) {
          setChannelsEntryIntent({ kind: 'channel', channelId: playingChannel.id })
        }
        setScreen(playerReturnScreen)
        // Immediate silent refresh on Player exit — the primary staleness
        // scenario this feature exists for (watch a live match for two
        // hours, Home/Event Details must already show the final state on
        // return). Safe unconditionally: useHomeFeed's in-flight guard
        // no-ops a refresh that is already running.
        homeFeedState.refresh()
        return
      }
      if (from === 'multiview') {
        setScreen(multiviewReturnScreen)
      }
    },
    [playingChannel, playerReturnScreen, multiviewReturnScreen, homeFeedState],
  )

  // THE APP-OWNED EXIT CONFIRMATION Samsung requires on a root Return.
  // Nothing else in the app may call exitApp(); backHandler.ts no longer
  // does (see its header), and this dialog's affirmative option is the one
  // and only path to it.
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false)

  // Registered once, for the app's whole lifetime: whenever a Return press
  // reaches the bottom of the LIFO handler stack unconsumed — i.e. the
  // viewer is at a root screen with nothing left to back out of — raise the
  // confirmation instead of quitting.
  //
  // Guarded on the current value so a repeated Return while the dialog is
  // already up cannot re-open (and therefore re-run useModalFocusScope's
  // opener capture with the dialog itself as the "opener"). In practice the
  // dialog's own Back handler consumes those presses first; the guard is
  // there so this does not depend on that ordering.
  useEffect(() => {
    return setUnhandledBackHandler(() => setExitConfirmOpen((open) => (open ? open : true)))
  }, [])

  // Samsung Product Network API on TV, navigator.onLine in browser dev —
  // see core/platform/networkStatus.ts for why this is TV connectivity only
  // and deliberately not "the provider/API is reachable".
  const network = useNetworkStatus()
  const deviceEntitlement = useDeviceEntitlement()
  const recheckNetwork = network.recheck

  // MULTITASKING. One listener for the whole app (Samsung requires
  // visibilitychange handling; feature components deliberately do not each
  // add their own).
  //
  // `screenRef` rather than a `screen` dependency: re-subscribing the
  // document listener on every navigation would be pointless churn, and the
  // handler must read the screen at FIRE time, not at subscribe time.
  const screenRef = useRef<Screen>(screen)
  screenRef.current = screen
  const exitPlaybackRef = useRef(exitPlayback)
  exitPlaybackRef.current = exitPlayback

  useAppLifecycle({
    // Tear playback down through the EXISTING lifecycle: leaving the
    // player/Multiview screen unmounts ChannelPlayerScreen / MultiviewPane,
    // which disposes each PlayerSessionController, which disposes the
    // underlying Player — destroying the hls.js/mpegts.js instance,
    // detaching the <video> and stopping the stall watchdog. Nothing keeps
    // decoding or polling behind a hidden app, and no separate teardown
    // path exists to drift from the Back one.
    onHidden: () => exitPlaybackRef.current(screenRef.current),
    // Restore a valid focus target. Deliberately NOT a reload: cached
    // playlists, preferences and navigation state are all still in memory
    // and must survive backgrounding untouched. Reuses the same resolution
    // the screen-change effect uses, so a lazy screen still resolves to its
    // own root key rather than to ROOT.
    onVisible: () => {
      void setFocus(SCREEN_FOCUS_KEYS[screenRef.current] ?? ROOT_FOCUS_KEY)
    },
    recheckNetwork,
  })

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
    if (previousScreen === 'settings' && screen === settingsEntry.returnScreen) {
      void setFocus('nav-avatar')
      return
    }
    void setFocus(SCREEN_FOCUS_KEYS[screen] ?? ROOT_FOCUS_KEY)
  }, [screen, settingsEntry.returnScreen])

  useEffect(() => {
    saveFilters(hiddenCountries, hiddenCategories)
  }, [hiddenCountries, hiddenCategories])

  useEffect(() => {
    saveFavoriteChannels(favoriteChannels)
  }, [favoriteChannels])

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
  // reached via Schedule, which uses its own separate fetch and isn't
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

  // WHAT EVENT DETAILS' "Refresh playlist" ACTUALLY DOES — the existing
  // playlist library's own manual resync, not a second refresh mechanism.
  // Only playlists that CAN be re-fetched are counted (a file-upload
  // playlist has nothing to fetch from), which is also what decides whether
  // the empty state offers the action at all and whether it says "playlist"
  // or "playlists".
  //
  // With exactly one it resyncs that one; with several it resyncs them all,
  // because Ninety has no way of knowing which playlist a broadcaster it
  // could not find would have been in, and guessing would leave the viewer
  // refreshing the wrong provider.
  const resyncablePlaylists = useMemo(() => library.playlists.filter((p) => isResyncable(p.source)), [library.playlists])
  const resyncPlaylist = library.resyncPlaylist
  const resyncAll = library.resyncAll
  const playlistRefresh = useMemo(
    () => ({
      resyncableCount: resyncablePlaylists.length,
      // The MOST RECENT successful sync across them. "Last refreshed" is a
      // statement about the action that button performs, and that action
      // covers the whole set — so the newest of their timestamps is the
      // honest answer to "when did pressing this last achieve anything".
      lastRefreshedAt: resyncablePlaylists.reduce<number | null>(
        (latest, p) => (p.lastSyncedAt != null && (latest == null || p.lastSyncedAt > latest) ? p.lastSyncedAt : latest),
        null,
      ),
      refresh: async () => {
        if (resyncablePlaylists.length === 1) await resyncPlaylist(resyncablePlaylists[0].id)
        else await resyncAll()
      },
    }),
    [resyncablePlaylists, resyncPlaylist, resyncAll],
  )

  // Opening an event's details is the app's one "the viewer is interested in
  // this" signal that costs nothing to capture — it happens at a navigation
  // point that already exists, nowhere near playback. Routed through here
  // rather than repeated at each call site so Home, Schedule and any future
  // entry point all feed the same local tally (see watchAffinity.ts).
  function openEventDetails(event: SportEvent, fromScreen: Screen) {
    recordEventOpened(event)
    setSelectedEvent(event)
    setEventDetailsReturnScreen(fromScreen)
    setScreen('event-details')
  }

  function watchChannel(channel: Channel, source: { label: string }, fromScreen: Screen) {
    recordWatched(channel.id)
    setPlayingChannel(channel)
    setPlayingSourceLabel(source.label)
    setPlayingGroup(undefined)
    // See playingEvent's own comment above — selectedEvent is only the
    // right event when this watch actually came from Event Details.
    setPlayingEvent(fromScreen === 'event-details' ? selectedEvent : null)
    setPlayerReturnScreen(fromScreen)
    setScreen('player')
  }

  // Event Details' own watch path. It hands over the whole logical stream
  // GROUP rather than one (channel, source) pair, so the player can offer
  // every quality the row collapsed, and fail over between the candidates
  // behind each one — see eventPlaybackGroup.ts. The best quality's primary
  // candidate is what actually starts playing, and is also what the rest of
  // this state cares about: which channel to record as watched, and which
  // channel a later "Add to Multiview" falls back to.
  function watchEventStream(group: EventPlaybackGroup) {
    // The best quality's PRIMARY candidate — what playback actually opens
    // with (see eventPlaybackGroup.ts's two levels: qualities the viewer
    // picks from, candidates the player fails over between).
    const best = group.variants[0]?.candidates[0]
    if (!best) return
    recordWatched(best.channel.id)
    // The strongest implicit signal Ninety has: a stream for THIS event
    // actually started. Recorded here, at the navigation boundary, and
    // deliberately not inside the player — personalization telemetry must
    // never be on a code path that can affect playback reliability.
    if (selectedEvent) recordEventWatched(selectedEvent)
    setPlayingChannel(best.channel)
    setPlayingSourceLabel(best.source.label)
    setPlayingGroup(group)
    setPlayingEvent(selectedEvent)
    setPlayerReturnScreen('event-details')
    setScreen('player')
  }

  // A whole logical stream row's favorite star (see StreamRow) — one row can
  // span several playlist Channel objects that Ninety resolved to the same
  // broadcaster, so the star has to move them together or the row's own
  // state becomes ambiguous ("favorited" via one spelling, not via the
  // other). All-or-nothing: if ANY of them is currently favorited the whole
  // set is cleared, otherwise the whole set is added. Uses the functional
  // setter because it writes several ids in one go — toggleInSet's
  // closed-over snapshot would only see the pre-update set.
  function toggleFavoriteChannels(channelIds: string[]) {
    setFavoriteChannels((prev) => {
      const next = new Set(prev)
      const anyFavorited = channelIds.some((id) => next.has(id))
      for (const id of channelIds) {
        if (anyFavorited) next.delete(id)
        else next.add(id)
      }
      return next
    })
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

  // The API remains authoritative after activation. Never expose playback
  // before a credential has been checked; a transient failure gets a retry
  // screen rather than being mistaken for permission.
  if (deviceEntitlement.status === 'checking') {
    return <LoadingScreen title="Checking your Ninety access" />
  }
  if (deviceEntitlement.status === 'unavailable') {
    return <EntitlementRequiredScreen unavailable onRetry={deviceEntitlement.retry} />
  }
  if (deviceEntitlement.status === 'inactive') {
    return <EntitlementRequiredScreen onRetry={deviceEntitlement.retry} />
  }

  return (
    <>
      {screen !== 'player' &&
        screen !== 'onboarding' &&
        screen !== 'multiview' &&
        screen !== 'event-details' &&
        screen !== 'settings' && (
        <TopNav
          // Event Details and Settings both stay off TopNav and carry their
          // own Back control instead (see EventDetailsScreen.tsx and
          // SettingsScreen.tsx) — on Event Details that Back is overlaid on
          // the hero artwork rather than occupying a header row, so the
          // competition artwork can start at the very top of the canvas.
          // For Settings this isn't cosmetic either: TopNav is
          // 84px tall, so keeping it would push a screen designed for the
          // full 1080px canvas into page-level scrolling — the exact thing
          // the Settings rebuild exists to remove.
          activeItem={screen === 'home' ? 'Home' : screen === 'competitions' ? 'Schedule' : 'Channels'}
          onSelectHome={() => setScreen('home')}
          onSelectChannels={
            library.hydration === 'pending'
              ? undefined
              : () => {
                  markPerf('channels:open-start')
                  setChannelsExitScreen('home')
                  // A fresh entry from the top nav, so no return intent can
                  // be outstanding — clearing it stops a channel intent left
                  // over from an earlier Home/Event Details watch from
                  // steering a navigation it has nothing to do with.
                  setChannelsEntryIntent(null)
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
          onSelectSchedule={() => setScreen('competitions')}
          onOpenSettings={() => {
            // The ordinary entry: no deep link, no return-focus intent, so
            // Settings opens on its own initial section and Back restores
            // the avatar exactly as before.
            setSettingsEntry({ returnScreen: screen })
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
      {/* Not `null`: a slow chunk on a TV otherwise looks like a dead app.
          LazyScreenFallback stays invisible for the fast common case, so
          this changes nothing for a transition that was already instant —
          see core/ui/LazyScreenFallback.tsx. */}
      <Suspense fallback={<LazyScreenFallback />}>
      {screen === 'home' && (
        <HomeScreen
          feedState={homeFeedState}
          xtream={library.xtream}
          favoriteChannels={favoriteChannelsList}
          onSelectEvent={(event) => openEventDetails(event, 'home')}
          onWatchChannel={(channel, source) => watchChannel(channel, source, 'home')}
        />
      )}

      {screen === 'competitions' && (
        <ScheduleScreen
          onSelectEvent={(event) => openEventDetails(event, 'competitions')}
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
          initialSection={settingsEntry.section}
          onBack={() => {
            // Back out of a deep link returns focus to the control that
            // opened it — for Channel visibility, the Channels toolbar
            // button. Stated here rather than left to whatever the cascade
            // last had focused.
            if (settingsEntry.returnFocus) {
              setChannelsEntryIntent({ kind: 'toolbar', target: settingsEntry.returnFocus })
            }
            setScreen(settingsEntry.returnScreen)
          }}
        />
      )}

      {screen === 'event-details' && liveSelectedEvent && (
        <EventDetailsScreen
          event={liveSelectedEvent}
          channels={library.channels}
          playlistGenerationId={library.generationId}
          xtream={library.xtream}
          identityIndex={identityIndex}
          favoriteChannels={favoriteChannels}
          onToggleFavoriteChannels={toggleFavoriteChannels}
          onWatch={watchEventStream}
          onBack={() => setScreen(eventDetailsReturnScreen)}
          onBrowseChannels={() => {
            // Back out of Channels returns to THIS fixture, not to Home.
            setChannelsExitScreen('event-details')
            setScreen('browse-cascade')
          }}
          playlistRefresh={playlistRefresh}
        />
      )}

      {screen === 'setup' && (
        <PlaylistSetupScreen
          variant="standalone"
          onPaired={() => setScreen('home')}
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
            // same main-thread task as a ~30,000-channel index build. The
            // wait is covered by the Ninety loading state (installPlaylist),
            // which also keeps the remote inert until Channels can render.
            void installPlaylist(source, loaded).then((ok) => {
              if (!ok) return
              setChannelsExitScreen('home')
              setScreen('browse-cascade')
            })
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
            // PREFERRED COUNTRIES ARE A RANKING SIGNAL, NEVER A FILTER.
            // This used to seed hiddenCountries with every playlist country
            // the viewer had NOT preferred, which silently deleted most of
            // their playlist from the Channels browser the moment they
            // finished onboarding — a preference expressed as "prioritize
            // Norway" was being executed as "hide Denmark, Germany, Spain".
            // The preference now reaches Channels as an ORDER (see
            // BrowseCascadeScreen's preferredCountries prop) and
            // hiddenCountries stays what it always was: the explicit,
            // user-driven Filter popup. Nothing is seeded here.
            //
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
            void installPlaylist(source, loaded).then(() => setScreen(SCREEN_AFTER_ONBOARDING))
          }}
        />
      )}

      {screen === 'browse-cascade' && (
        <BrowseCascadeScreen
          channelIndex={channelIndex}
          xtream={library.xtream}
          hiddenCountries={hiddenCountries}
          preferredCountries={preferences.favoriteCountries}
          hiddenCategories={hiddenCategories}
          favoriteChannels={favoriteChannels}
          onToggleFavoriteChannel={(id) => toggleInSet(favoriteChannels, setFavoriteChannels, id)}
          onWatch={(channel, source) => watchChannel(channel, source, 'browse-cascade')}
          onOpenFavorites={() => setScreen('channels-favorites')}
          onOpenRecent={() => setScreen('channels-recent')}
          // THE ONE PLACE hidden countries/categories are edited. Channels
          // used to open its own FilterPopup here — a second, staged-draft
          // implementation of Settings' Channel visibility pane over the
          // same two preferences and the same storage key. The popup was
          // deleted rather than restyled: two editors for one setting is a
          // bug waiting to be written, and the Settings pane is the better
          // of the two (immediate application, no Apply step, existing
          // focus recovery). Deep-linked to the section so nobody has to
          // land on Playlists and walk the rail to reach it.
          onOpenChannelVisibility={() => {
            setSettingsEntry({ returnScreen: 'browse-cascade', section: 'visibility', returnFocus: 'filters' })
            setScreen('settings')
          }}
          onExit={() => setScreen(channelsExitScreen)}
          entryIntent={channelsEntryIntent}
          onEntryIntentConsumed={clearChannelsEntryIntent}
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
          restoreChannelId={channelsEntryIntent?.kind === 'channel' ? channelsEntryIntent.channelId : null}
          onBack={() => {
            setChannelsEntryIntent({ kind: 'toolbar', target: 'favorites' })
            setScreen('browse-cascade')
          }}
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
          restoreChannelId={channelsEntryIntent?.kind === 'channel' ? channelsEntryIntent.channelId : null}
          onBack={() => {
            setChannelsEntryIntent({ kind: 'toolbar', target: 'recent' })
            setScreen('browse-cascade')
          }}
          onWatch={(channel, source) => watchChannel(channel, source, 'channels-recent')}
        />
      )}

      {screen === 'player' && (
        <ChannelPlayerScreen
          channels={playerChannels}
          initialSourceLabel={playingSourceLabel}
          playbackGroup={playingGroup}
          // Identical to what the multitasking handler runs when the app
          // is hidden during playback — Samsung requires those to be the
          // same semantic action, so they are literally the same function
          // (see exitPlayback above for the return-intent behaviour).
          onBack={() => exitPlayback('player')}
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
          onBack={() => exitPlayback('multiview')}
        />
      )}

      {library.notice && <PlaylistToast message={library.notice} onDismiss={library.dismissNotice} />}

      {/* The second half of a playlist import — see installPlaylist. Sits
          outside every screen because it deliberately outlives the screen
          change it is covering: onboarding's last step is still mounted when
          this goes up, and Home is mounted before it comes down, so neither
          is ever seen half-built. */}
      {installing && <LoadingScreen title={PLAYLIST_IMPORT_TITLE} detail={PLAYLIST_IMPORT_STAGES[install.stage]} />}

      {import.meta.env.DEV && adminOpen && (
        <AdminPanel channels={library.channels} onClose={() => setAdminOpen(false)} />
      )}
      {import.meta.env.DEV && (
        <FocusDebugOverlay screen={screen} region={screen === 'browse-cascade' ? cascadeLevel : undefined} overlay={adminOpen ? 'admin' : null} />
      )}
      </Suspense>

      {/* Both of these sit OUTSIDE the Suspense boundary on purpose: a lazy
          screen's fallback would otherwise hide them for exactly as long as
          a chunk takes to load, which is precisely when a viewer on a dead
          network most needs to be told why nothing is happening. */}
      {network.status === 'offline' && <NetworkOfflineNotice />}

      {exitConfirmOpen && (
        <ExitConfirmDialog
          onCancel={() => setExitConfirmOpen(false)}
          onConfirm={() => {
            // THE ONLY call to exitApp() in the application. Samsung
            // requires that the app quits only from the affirmative option
            // of its own confirmation popup.
            exitApp()
          }}
        />
      )}
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
