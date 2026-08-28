// Ninety Settings — a TV control centre, not a settings document.
//
// The screen it replaces was one long vertically-scrolling page of
// onboarding card grids: ~50 league cards, every playlist country, and a
// stream-type row, all mounted at once, several thousand pixels tall.
// Reaching the bottom took dozens of Down presses, the page scrolled out
// from under TopNav, and initial focus landed in the middle of a card grid.
//
// This is a left rail + right detail pane, fixed to one 1920x1080 viewport.
// The page shell never scrolls; only the lists inside a pane do. Focusing a
// rail row previews that section immediately (no Enter needed just to look),
// Right enters the pane, Left/Back returns to the rail, and Back from the
// rail leaves Settings — one focus graph, stated rather than inferred.
import { useMemo, useState } from 'react'
import { FocusContext, getCurrentFocusKey, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler } from '../../core/platform'
import { loadPreferences, savePreferences, withCountryToggled, withPrimaryCountry, withTeamToggled } from '../../data/preferences'
import { SettingsRailItem } from './settingsPrimitives'
import { PANE_ENTRY_FOCUS_KEY, useSettingsFocusable } from './useSettingsFocusable'
import { INITIAL_SETTINGS_SECTION, SETTINGS_SECTIONS, adjacentSection, isRailFocusKey, railFocusKey } from './settingsSections'
import { PlaylistsPane, type PlaylistDialogRequest } from './PlaylistsPane'
import { SportsLeaguesPane } from './SportsLeaguesPane'
import { CountriesPane } from './CountriesPane'
import { PersonalisationPane } from './PersonalisationPane'
import { ChannelVisibilityPane } from './ChannelVisibilityPane'
import { SettingsConfirmDialog, SettingsPromptDialog } from './SettingsDialogs'
import { PlaylistConnectDialog } from './PlaylistConnectDialog'
import { TeamPickerDialog } from './TeamPickerDialog'
import { useFootballCompetitions } from '../../data/sports/useFootballCompetitions'
import { footballLeaguesForPreferences } from '../../data/sports/leagues'
import type { SettingsSectionId } from './settingsSections'
import type { HomeContentMode, StreamTypePreference } from '../../data/preferences'
import type { SportKey } from '../../data/sports/types'
import type { ChannelIndex } from '../../data/channelIndex'
import type { PlaylistLibrary } from '../../data/playlists/usePlaylistLibrary'
import './SettingsScreen.css'

const SCREEN_FOCUS_KEY = 'settings-screen'
const BACK_FOCUS_KEY = 'settings-back'
// ChannelIndex's bucket for channels whose category carried no recognizable
// country prefix — see data/channelIndex.ts's OTHER.
const UNCATEGORIZED_COUNTRY = 'Other'

type Dialog =
  | { kind: 'none' }
  | { kind: 'add-playlist' }
  | { kind: 'edit-playlist'; playlistId: string }
  | { kind: 'rename-playlist'; playlistId: string }
  | { kind: 'remove-playlist'; playlistId: string }
  | { kind: 'clear-recent' }
  | { kind: 'manage-teams' }

interface Props {
  library: PlaylistLibrary
  // Prepared index over the COMBINED channel set — the country/category
  // vocabulary both the Countries and Channel-visibility sections work in.
  channelIndex: ChannelIndex
  hiddenCountries: Set<string>
  hiddenCategories: Set<string>
  onChangeChannelVisibility: (hiddenCountries: Set<string>, hiddenCategories: Set<string>) => void
  recentlyWatchedCount: number
  onClearRecentlyWatched: () => void
  onBack: () => void
}

export function SettingsScreen({
  library,
  channelIndex,
  hiddenCountries,
  hiddenCategories,
  onChangeChannelVisibility,
  recentlyWatchedCount,
  onClearRecentlyWatched,
  onBack,
}: Props) {
  const [section, setSection] = useState<SettingsSectionId>(INITIAL_SETTINGS_SECTION)
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })
  const [prefs, setPrefs] = useState(() => loadPreferences())

  // Immediate persistence for every lightweight preference — the same
  // behaviour the previous screen had, and the reason there is no "Save
  // settings" ceremony anywhere on this screen. Playlist operations are the
  // exception (they validate first, and confirm before destroying anything).
  function persist(next: typeof prefs) {
    setPrefs(next)
    savePreferences(next)
  }

  const { ref, focusKey } = useFocusable({
    focusKey: SCREEN_FOCUS_KEY,
    trackChildren: true,
    // THE SECTION THE USER IS IN, not the section Settings opens on.
    //
    // This is the last-resort target: the library falls back to "focus my
    // parent" whenever a focused focusable disappears without the screen
    // saying where focus should go instead, and the parent of every control
    // on this screen is this root. Pinned to the INITIAL section, that made
    // any such disappearance silently switch the user to Playlists — the
    // Countries pane's "add a country and the row you were on stops
    // existing" being the case that surfaced it.
    //
    // Safe to derive from state, unlike `focusKey` itself: the library
    // captures a focusable's OWN key at registration, but re-reads
    // preferredChildFocusKey through updateFocusable on every change (see
    // norigin-spatial-navigation-react's second effect), so this really
    // does track the current section.
    //
    // Still resolvable at mount for the same reason as before — the rail is
    // a fixed local list with no async gating, so this never races the lazy
    // chunk load the way a content-derived key would. See App.tsx's
    // SCREEN_FOCUS_KEYS.
    //
    // It is a safety net, not the mechanism: panes whose lists can shrink
    // under the user recover to a neighbouring row themselves (see
    // useFocusRecovery), because landing back on the section rail is a
    // worse answer than staying in the list you were working in.
    preferredChildFocusKey: railFocusKey(section),
  })

  const returnToRail = () => void setFocus(railFocusKey(section))
  const enterPane = () => void setFocus(PANE_ENTRY_FOCUS_KEY)

  useBackHandler(() => {
    // A dialog's own useModalFocusScope sits above this on the Back stack,
    // so this only ever runs for the screen itself.
    const current = getCurrentFocusKey()
    if (current && !isRailFocusKey(current) && current !== BACK_FOCUS_KEY) {
      // Several levels deep inside a pane — Back steps out to the rail
      // rather than leaving Settings entirely.
      returnToRail()
      return true
    }
    onBack()
    return true
  })

  const { ref: backRef, focused: backFocused } = useSettingsFocusable({
    focusKey: BACK_FOCUS_KEY,
    onEnter: onBack,
    onDown: returnToRail,
    onLeft: () => {},
    onRight: () => {},
    onUp: () => {},
  })

  function toggleSport(id: SportKey) {
    const sports = new Set(prefs.sports)
    if (sports.has(id)) sports.delete(id)
    else sports.add(id)
    // Deselecting football drops its league selections too — mirrors
    // OnboardingFlow's finish() (footballLeagueIds is only meaningful while
    // football itself is selected), so re-selecting football later doesn't
    // resurrect a stale, unreviewed league list.
    persist({
      ...prefs,
      sports: [...sports],
      footballLeagueIds: sports.has('football') ? prefs.footballLeagueIds : [],
      // Favorite teams follow the same rule as leagues: they are only
      // meaningful while football itself is on, and re-enabling it later
      // must not resurrect an unreviewed list.
      favoriteTeamIds: sports.has('football') ? prefs.favoriteTeamIds : [],
    })
  }

  function toggleLeague(id: string) {
    const leagues = new Set(prefs.footballLeagueIds)
    if (leagues.has(id)) leagues.delete(id)
    else leagues.add(id)
    persist({ ...prefs, footballLeagueIds: [...leagues] })
  }

  // Shares withTeamToggled with onboarding, so the two surfaces cannot
  // disagree about what following a team means. Persisted immediately, like
  // every other lightweight preference on this screen — which is why the
  // picker has no Cancel.
  function toggleTeam(id: string) {
    persist({ ...prefs, favoriteTeamIds: withTeamToggled(prefs.favoriteTeamIds, id) })
  }

  // The competition catalog is already cached for the session (see
  // competitionsCatalog.ts), so reading it here costs nothing beyond what
  // SportsLeaguesPane's own call already does — and the team picker needs
  // real LeagueDefs (names, order) rather than bare ids for its rail.
  const competitions = useFootballCompetitions()
  const followedLeagues = useMemo(
    () =>
      competitions.status === 'ready'
        ? footballLeaguesForPreferences(prefs.footballLeagueIds, competitions.leagues)
        : [],
    [competitions, prefs.footballLeagueIds],
  )

  // Derived from the COMBINED channel set, so with several playlists
  // connected the options are the union of what they all carry. Comes from
  // the prepared index (already keyed by parseCategory's display name, which
  // is what collapses the UK/GB prefix alias into one "United Kingdom"
  // entry) rather than a second scan of every channel.
  //
  // The index's "Other" bucket is excluded deliberately: it is where
  // channels with no recognizable country prefix land, not a country a user
  // could meaningfully prefer.
  const countryOptions = useMemo(
    () =>
      channelIndex
        .getCountries()
        .filter((country) => country.name !== UNCATEGORIZED_COUNTRY)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    [channelIndex],
  )

  function handlePlaylistDialog(request: PlaylistDialogRequest) {
    if (request.kind === 'add') setDialog({ kind: 'add-playlist' })
    else if (request.kind === 'rename') setDialog({ kind: 'rename-playlist', playlistId: request.playlist.id })
    else if (request.kind === 'edit') setDialog({ kind: 'edit-playlist', playlistId: request.playlist.id })
    else setDialog({ kind: 'remove-playlist', playlistId: request.playlist.id })
  }

  const dialogPlaylist =
    dialog.kind === 'edit-playlist' || dialog.kind === 'rename-playlist' || dialog.kind === 'remove-playlist'
      ? library.playlists.find((playlist) => playlist.id === dialog.playlistId)
      : undefined

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} className="settings-screen">
        <header className="settings-header">
          <button ref={backRef} className={`settings-back ${backFocused ? 'focused' : ''}`} onClick={onBack}>
            <BackArrowIcon /> Back
          </button>
          <h1 className="settings-title">Settings</h1>
        </header>

        <div className="settings-body">
          <nav className="settings-rail">
            {SETTINGS_SECTIONS.map((item) => (
              <SettingsRailItem
                key={item.id}
                label={item.label}
                active={item.id === section}
                focusKey={railFocusKey(item.id)}
                // Focusing a rail row previews its section immediately —
                // pressing Enter purely to change section would be a wasted
                // press on a remote.
                onFocus={() => setSection(item.id)}
                onEnter={enterPane}
                onRight={enterPane}
                onUp={() => {
                  const previous = adjacentSection(item.id, -1)
                  if (previous === item.id) void setFocus(BACK_FOCUS_KEY)
                  else void setFocus(railFocusKey(previous))
                }}
                onDown={() => {
                  const next = adjacentSection(item.id, 1)
                  if (next !== item.id) void setFocus(railFocusKey(next))
                }}
              />
            ))}
          </nav>

          <section className="settings-pane">
            {section === 'playlists' && (
              <PlaylistsPane library={library} onRequestDialog={handlePlaylistDialog} onLeaveToRail={returnToRail} />
            )}
            {section === 'sports' && (
              <SportsLeaguesPane
                sports={prefs.sports}
                footballLeagueIds={prefs.footballLeagueIds}
                onToggleSport={toggleSport}
                onToggleLeague={toggleLeague}
                favoriteTeamIds={prefs.favoriteTeamIds}
                onManageTeams={() => setDialog({ kind: 'manage-teams' })}
                onLeaveToRail={returnToRail}
              />
            )}
            {section === 'countries' && (
              <CountriesPane
                selected={prefs.favoriteCountries}
                available={countryOptions}
                onAdd={(name) => persist({ ...prefs, favoriteCountries: withCountryToggled(prefs.favoriteCountries, name) })}
                onRemove={(name) => persist({ ...prefs, favoriteCountries: withCountryToggled(prefs.favoriteCountries, name) })}
                onMakePrimary={(name) => persist({ ...prefs, favoriteCountries: withPrimaryCountry(prefs.favoriteCountries, name) })}
                onLeaveToRail={returnToRail}
              />
            )}
            {section === 'personalisation' && (
              <PersonalisationPane
                homeContentMode={prefs.homeContentMode}
                streamType={prefs.streamType}
                // Immediately persisted, like every other lightweight
                // preference here — Home re-derives from the new mode with
                // no refetch (see useHomeFeed's Effect 2), so returning to
                // it shows the change straight away.
                onSelectHomeContentMode={(homeContentMode: HomeContentMode) => persist({ ...prefs, homeContentMode })}
                onSelectStreamType={(streamType: StreamTypePreference) => persist({ ...prefs, streamType })}
                onLeaveToRail={returnToRail}
              />
            )}
            {section === 'visibility' && (
              <ChannelVisibilityPane
                channelIndex={channelIndex}
                hiddenCountries={hiddenCountries}
                hiddenCategories={hiddenCategories}
                onChange={onChangeChannelVisibility}
                recentlyWatchedCount={recentlyWatchedCount}
                onRequestClearRecentlyWatched={() => setDialog({ kind: 'clear-recent' })}
                onLeaveToRail={returnToRail}
              />
            )}
          </section>
        </div>

        {dialog.kind === 'add-playlist' && (
          <PlaylistConnectDialog
            mode="add"
            onConnected={({ source, channels }) => {
              setDialog({ kind: 'none' })
              // APPENDS — never replaces the library. This is the single
              // most important behavioural difference from the old
              // "Reconnect / change playlist" action.
              void library.addPlaylist(source, channels)
            }}
            onCancel={() => setDialog({ kind: 'none' })}
          />
        )}

        {dialog.kind === 'edit-playlist' && dialogPlaylist && (
          <PlaylistConnectDialog
            mode="edit"
            existing={dialogPlaylist.source}
            onConnected={({ source, channels }) => {
              const playlistId = dialogPlaylist.id
              setDialog({ kind: 'none' })
              // The dialog only reports success AFTER the replacement has
              // been fetched, parsed and merged, so the old working playlist
              // is still fully intact until this line. A failed edit never
              // reaches here — it shows an error inside the dialog and the
              // existing playlist is untouched.
              void library.replaceConnection(playlistId, source, channels)
            }}
            onCancel={() => setDialog({ kind: 'none' })}
          />
        )}

        {dialog.kind === 'rename-playlist' && dialogPlaylist && (
          <SettingsPromptDialog
            title="Rename playlist"
            hint="Only changes what this playlist is called in Ninety."
            initialValue={dialogPlaylist.name}
            onSubmit={(name) => {
              library.renamePlaylist(dialogPlaylist.id, name)
              setDialog({ kind: 'none' })
            }}
            onCancel={() => setDialog({ kind: 'none' })}
          />
        )}

        {dialog.kind === 'remove-playlist' && dialogPlaylist && (
          <SettingsConfirmDialog
            title={`Remove "${dialogPlaylist.name}"?`}
            body="This removes the playlist from Ninety. Your provider account is not affected, and your other playlists stay connected."
            confirmLabel="Remove"
            onConfirm={() => {
              void library.removePlaylist(dialogPlaylist.id)
              setDialog({ kind: 'none' })
            }}
            onCancel={() => setDialog({ kind: 'none' })}
          />
        )}

        {dialog.kind === 'manage-teams' && (
          <TeamPickerDialog
            followedLeagues={followedLeagues}
            selectedTeamIds={prefs.favoriteTeamIds}
            onToggleTeam={toggleTeam}
            onClose={() => setDialog({ kind: 'none' })}
          />
        )}

        {dialog.kind === 'clear-recent' && (
          <SettingsConfirmDialog
            title="Clear recently watched?"
            body="Ninety forgets the channels you've watched recently. Favorites and playlists are not affected."
            confirmLabel="Clear"
            onConfirm={() => {
              onClearRecentlyWatched()
              setDialog({ kind: 'none' })
            }}
            onCancel={() => setDialog({ kind: 'none' })}
          />
        )}
      </main>
    </FocusContext.Provider>
  )
}

// Local rather than imported from onboarding/sportIcons.tsx: a back chevron
// is not worth coupling this screen's build to the onboarding feature for.
function BackArrowIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
