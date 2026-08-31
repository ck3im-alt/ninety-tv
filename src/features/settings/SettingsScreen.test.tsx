// @vitest-environment jsdom
//
// Behavioural coverage for the rebuilt Settings screen. These drive the real
// components (rail, panes, dialogs) and assert on what the user would see
// and what the app would persist — the network boundaries (the competition
// catalog, playlist connection, QR pairing) are the only things stubbed.
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { destroy, getCurrentFocusKey, init, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { makeFakeLocalStorage } from '../../core/storage/testFakeLocalStorage'
import type { SettingsSectionId } from './settingsSections'

// Same setup main.tsx does before rendering <App/>; without it every
// useFocusable() registration throws an unhandled measureLayout rejection
// in jsdom. Re-run per test (see afterEach) rather than once for the file:
// spatial-navigation state is a module-level singleton that outlives
// cleanup(), and the focus-continuity tests below both depend on and
// produce focus state, so one test's leftovers must not become the next
// one's starting position.
function initSpatialNavigation() {
  init({ debug: false, visualDebug: false })
}
initSpatialNavigation()

// jsdom implements no layout, so it has no scrollIntoView — the shared
// useFocusScrollIntoView hook every focusable here uses would otherwise
// throw on first focus.
Element.prototype.scrollIntoView = () => {}

// The dialog connects through connectPlaylistFromUrl now. Only its network
// half is stubbed — the real sourceFromUrl still decides what a typed URL
// turns into, so these tests keep asserting the source record the library
// actually receives rather than one the mock made up.
const loadChannelsForSource = vi.fn()
vi.mock('../../data/playlists/connectPlaylist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/playlists/connectPlaylist')>()
  return {
    ...actual,
    loadChannelsForSource: (...args: unknown[]) => loadChannelsForSource(...args),
    connectPlaylistFromUrl: async (url: string) => {
      const source = actual.sourceFromUrl(url.trim())
      return { source, channels: await loadChannelsForSource(source) }
    },
  }
})

// The QR pairing session creates a server-side session on mount. Stubbed to
// its error state so these tests never touch the network (and so the
// connect dialog renders its manual form without a QR panel).
vi.mock('../setup/usePairingSession', () => ({
  usePairingSession: () => ({ status: 'error', activationUrl: null, retry: () => {} }),
  ackPairing: vi.fn(),
}))

// resetAppData's own store-clearing behaviour is covered by
// data/resetAppData.test.ts. What matters here is what the SCREEN does with
// it: which scope it asks for, and whether it reloads.
const resetAppData = vi.fn()
vi.mock('../../data/resetAppData', () => ({
  resetAppData: (...args: unknown[]) => resetAppData(...args),
}))

// jsdom's Location has no navigation, so reload has to be replaced outright
// rather than spied on.
const reloadSpy = vi.fn()
Object.defineProperty(window, 'location', {
  value: { ...window.location, reload: reloadSpy },
  configurable: true,
  writable: true,
})

const competitionsState = { current: { status: 'ready', leagues: [] } as unknown }
vi.mock('../../data/sports/useFootballCompetitions', () => ({
  useFootballCompetitions: () => competitionsState.current,
}))

import { SettingsScreen } from './SettingsScreen'
import { PANE_ENTRY_FOCUS_KEY } from './useSettingsFocusable'
import { getChannelIndex } from '../../data/channelIndex'
import { loadPreferences, savePreferences } from '../../data/preferences'
import { mergeChannelSources } from '../channels/mergeChannels'
import type { Channel } from '../../data/channel'
import type { LeagueDef } from '../../data/sports/leagues'
import type { PlaylistDefinition } from '../../data/playlists/playlistDefinition'
import type { PlaylistLibrary, PlaylistSyncStatus } from '../../data/playlists/usePlaylistLibrary'

// countryCode is spelled out exactly as GET /v1/competitions sends it
// (`string | null`, never absent) — null is what marks a supranational
// competition, which groups under "International competitions" rather than
// its nominal region. See data/sports/competitionGrouping.ts.
function league(id: string, name: string, region: string, countryCode: string | null, tier: 1 | 2 | 3): LeagueDef {
  return { id, sportKey: 'football', sportLabel: 'FOOTBALL', tsdbSport: 'Soccer', name, region, countryCode, tier }
}

const CATALOG: LeagueDef[] = [
  league('football_premier_league', 'Premier League', 'England', 'GB', 1),
  league('football_championship', 'Championship', 'England', 'GB', 2),
  league('football_fa_cup', 'FA Cup', 'England', 'GB', 2),
  league('football_la_liga', 'La Liga', 'Spain', 'ES', 1),
  league('football_eliteserien', 'Eliteserien', 'Norway', 'NO', 3),
]

const PLAYLIST_A: PlaylistDefinition = {
  id: 'pl-a',
  name: 'My Provider',
  source: { type: 'xtream', server: 'https://provider.example.com', username: 'user-a', password: 'secret-a' },
  createdAt: 0,
  lastSyncedAt: null,
  generationId: 'gen-a',
  channelCount: 28420,
}

const PLAYLIST_B: PlaylistDefinition = {
  id: 'pl-b',
  name: 'Backup',
  source: { type: 'm3u-url', url: 'https://backup.example.net/list.m3u' },
  createdAt: 0,
  lastSyncedAt: null,
  generationId: 'gen-b',
  channelCount: 8221,
}

function channels(): Channel[] {
  return mergeChannelSources([
    { id: '1', name: 'NRK 1', groupTitle: 'NO| Sports', url: 'http://a/1.ts' },
    { id: '2', name: 'NRK 2', groupTitle: 'NO| News', url: 'http://a/2.ts' },
    { id: '3', name: 'TNT Sports 1', groupTitle: 'UK| Sports', url: 'http://a/3.ts' },
    { id: '4', name: 'SVT 1', groupTitle: 'SE| General', url: 'http://a/4.ts' },
    { id: '5', name: 'Sky Sport', groupTitle: 'DE| Sports', url: 'http://a/5.ts' },
    { id: '6', name: 'TF1', groupTitle: 'FR| General', url: 'http://a/6.ts' },
    { id: '7', name: 'RAI 1', groupTitle: 'IT| General', url: 'http://a/7.ts' },
  ])
}

interface Harness {
  library: PlaylistLibrary
  calls: {
    addPlaylist: ReturnType<typeof vi.fn>
    addOrReconnectPlaylist: ReturnType<typeof vi.fn>
    renamePlaylist: ReturnType<typeof vi.fn>
    replaceConnection: ReturnType<typeof vi.fn>
    resyncPlaylist: ReturnType<typeof vi.fn>
    resyncAll: ReturnType<typeof vi.fn>
    removePlaylist: ReturnType<typeof vi.fn>
    onChangeChannelVisibility: ReturnType<typeof vi.fn>
    onClearRecentlyWatched: ReturnType<typeof vi.fn>
    onBack: ReturnType<typeof vi.fn>
  }
}

function renderSettings({
  playlists = [PLAYLIST_A],
  syncStatuses = {},
  hiddenCountries = new Set<string>(),
  hiddenCategories = new Set<string>(),
  recentlyWatchedCount = 0,
  channelSet = channels(),
  initialSection,
}: {
  playlists?: PlaylistDefinition[]
  syncStatuses?: Record<string, PlaylistSyncStatus>
  hiddenCountries?: Set<string>
  hiddenCategories?: Set<string>
  recentlyWatchedCount?: number
  // Deep-linked entry (Channels' Channel Visibility action). Omitted for
  // every other test, which is exactly the ordinary entry.
  initialSection?: SettingsSectionId
  // The combined channel set the Countries and Channel-visibility panes
  // derive their vocabulary from. Overridden only where the number of
  // countries is the point — the five-country cap means the default seven
  // can never leave the Available column empty.
  channelSet?: Channel[]
} = {}): Harness {
  const calls = {
    addPlaylist: vi.fn().mockResolvedValue(PLAYLIST_A),
    addOrReconnectPlaylist: vi.fn().mockResolvedValue(undefined),
    renamePlaylist: vi.fn(),
    replaceConnection: vi.fn().mockResolvedValue(undefined),
    resyncPlaylist: vi.fn().mockResolvedValue(undefined),
    resyncAll: vi.fn().mockResolvedValue(undefined),
    removePlaylist: vi.fn().mockResolvedValue(undefined),
    setPlaybackActive: vi.fn(),
    onChangeChannelVisibility: vi.fn(),
    onClearRecentlyWatched: vi.fn(),
    onBack: vi.fn(),
  }
  const library: PlaylistLibrary = {
    playlists,
    channels: channelSet,
    generationId: 'gen',
    xtream: { forSource: () => null, hasAny: false },
    hydration: 'done',
    syncStatus: (id) => syncStatuses[id] ?? { kind: 'idle' },
    notice: null,
    dismissNotice: () => {},
    reconnectNotice: null,
    ...calls,
  }
  render(
    <SettingsScreen
      library={library}
      channelIndex={getChannelIndex(library.channels)}
      hiddenCountries={hiddenCountries}
      hiddenCategories={hiddenCategories}
      onChangeChannelVisibility={calls.onChangeChannelVisibility}
      recentlyWatchedCount={recentlyWatchedCount}
      onClearRecentlyWatched={calls.onClearRecentlyWatched}
      initialSection={initialSection}
      onBack={calls.onBack}
    />,
  )
  return { library, calls }
}

// A library whose removePlaylist REALLY shrinks the list, so the focus
// consequences of a removal can be observed. Mirrors usePlaylistLibrary's
// ordering deliberately: the storage delete is awaited BEFORE any state
// change, so closing the dialog and shrinking the list land in separate
// commits — which is what decides whether the dialog's opener still exists
// when focus is handed back to it.
function renderRemovableSettings(initial: PlaylistDefinition[]) {
  function Host() {
    const [playlists, setPlaylists] = useState(initial)
    const library: PlaylistLibrary = {
      playlists,
      channels: channels(),
      generationId: 'gen',
      xtream: { forSource: () => null, hasAny: false },
      hydration: 'done',
      syncStatus: () => ({ kind: 'idle' }),
      notice: null,
      dismissNotice: () => {},
      reconnectNotice: null,
      addPlaylist: vi.fn().mockResolvedValue(PLAYLIST_A),
      addOrReconnectPlaylist: vi.fn().mockResolvedValue(undefined),
      renamePlaylist: vi.fn(),
      replaceConnection: vi.fn().mockResolvedValue(undefined),
      resyncPlaylist: vi.fn().mockResolvedValue(undefined),
      resyncAll: vi.fn().mockResolvedValue(undefined),
      setPlaybackActive: vi.fn(),
      removePlaylist: async (id: string) => {
        await Promise.resolve()
        setPlaylists((current) => current.filter((playlist) => playlist.id !== id))
      },
    }
    return (
      <SettingsScreen
        library={library}
        channelIndex={getChannelIndex(library.channels)}
        hiddenCountries={new Set()}
        hiddenCategories={new Set()}
        onChangeChannelVisibility={vi.fn()}
        recentlyWatchedCount={0}
        onClearRecentlyWatched={vi.fn()}
        onBack={vi.fn()}
      />
    )
  }
  render(<Host />)
}

function openSection(label: string) {
  fireEvent.click(screen.getByText(label))
}

// Same thing, but scoped to the rail — needed once a section is already
// open, because the pane header repeats the section's name.
function openSectionFromRail(label: string) {
  const rail = document.querySelector('.settings-rail')
  if (!rail) throw new Error('Settings rail not rendered')
  fireEvent.click(within(rail as HTMLElement).getByText(label))
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
  resetAppData.mockReset().mockResolvedValue(true)
  reloadSpy.mockReset()
  loadChannelsForSource.mockReset()
  competitionsState.current = { status: 'ready', leagues: CATALOG }
})

afterEach(() => {
  cleanup()
  // Unmounting the tree leaves the library still holding the last focus key
  // and a DEBOUNCED (300ms) "restore focus to my parent" armed for the
  // control that just vanished. Carried into the next test, that key gets
  // re-claimed the moment a component registers under it again — and for a
  // rail item, re-claiming it fires onFocus and silently switches the
  // section. destroy() drops the focus key, the component registry and the
  // key bindings; init() puts them back for the next render.
  destroy()
  initSpatialNavigation()
  vi.unstubAllGlobals()
})

describe('Settings rail', () => {
  it('offers exactly the five top-level sections', () => {
    renderSettings()
    for (const label of ['Playlists', 'Sports & leagues', 'Countries', 'Personalisation', 'Channel visibility']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('opens on Playlists', () => {
    renderSettings()
    expect(screen.getAllByText('My Provider').length).toBeGreaterThan(0)
    expect(screen.getByText('28,420')).toBeTruthy()
  })

  it('switching sections does not discard preference edits made in another section', () => {
    savePreferences({ sports: ['football', 'f1'], footballLeagueIds: [], favoriteCountries: [], streamType: 'auto', favoriteTeamIds: [], homeContentMode: 'all' })
    renderSettings()

    openSection('Personalisation')
    fireEvent.click(screen.getByText('TV Channels'))
    openSection('Countries')
    openSection('Personalisation')

    expect(loadPreferences().streamType).toBe('tv')
    // And the choice is still reflected in the re-rendered pane.
    expect(screen.getByText('TV Channels')).toBeTruthy()
  })
})

describe('Settings — Playlists', () => {
  it('shows a single connected playlist with its source, credential-free', () => {
    renderSettings()
    expect(screen.getAllByText('My Provider').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Xtream · provider.example.com').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toContain('secret-a')
    expect(document.body.textContent).not.toContain('user-a')
  })

  it('shows two connected playlists at once', () => {
    renderSettings({ playlists: [PLAYLIST_A, PLAYLIST_B] })
    expect(screen.getAllByText('My Provider').length).toBeGreaterThan(0)
    expect(screen.getByText('Backup')).toBeTruthy()
    expect(screen.getAllByText('M3U URL · backup.example.net').length).toBeGreaterThan(0)
  })

  it('offers an empty state with an Add action when nothing is connected', () => {
    renderSettings({ playlists: [] })
    expect(screen.getByText('No playlists connected')).toBeTruthy()
    expect(screen.getByText('Add playlist')).toBeTruthy()
  })

  it('ADDS a playlist rather than replacing the library, and leaves existing playlists listed', async () => {
    loadChannelsForSource.mockResolvedValue(channels())
    const { calls } = renderSettings({ playlists: [PLAYLIST_A] })

    fireEvent.click(screen.getByText('+ Add playlist'))
    fireEvent.change(screen.getByPlaceholderText('https://provider.com/get.php?...'), {
      target: { value: 'https://second.example.com/list.m3u' },
    })
    fireEvent.click(screen.getByText('Connect'))

    await waitFor(() => expect(calls.addPlaylist).toHaveBeenCalledTimes(1))
    expect(calls.addPlaylist.mock.calls[0][0]).toEqual({ type: 'm3u-url', url: 'https://second.example.com/list.m3u' })
    expect(calls.removePlaylist).not.toHaveBeenCalled()
    expect(screen.getAllByText('My Provider').length).toBeGreaterThan(0)
  })

  it('renames a playlist without touching its connection', () => {
    const { calls } = renderSettings()
    fireEvent.click(screen.getByText('Rename'))
    fireEvent.change(screen.getByDisplayValue('My Provider'), { target: { value: 'Living room' } })
    fireEvent.click(screen.getByText('Save'))

    expect(calls.renamePlaylist).toHaveBeenCalledWith('pl-a', 'Living room')
    expect(calls.replaceConnection).not.toHaveBeenCalled()
  })

  it('never renders a stored Xtream password in the edit form', () => {
    renderSettings()
    fireEvent.click(screen.getByText('Edit connection'))
    const password = screen.getByPlaceholderText('Password (unchanged)') as HTMLInputElement
    expect(password.value).toBe('')
    expect(document.body.textContent).not.toContain('secret-a')
  })

  it('applies a connection edit only after the new connection succeeds', async () => {
    loadChannelsForSource.mockResolvedValue(channels())
    const { calls } = renderSettings()

    fireEvent.click(screen.getByText('Edit connection'))
    fireEvent.change(screen.getByPlaceholderText('Server (https://your-provider.com:port)'), {
      target: { value: 'https://new-server.example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'user-a' } })
    fireEvent.click(screen.getByText('Connect'))

    await waitFor(() => expect(calls.replaceConnection).toHaveBeenCalledTimes(1))
    expect(calls.replaceConnection.mock.calls[0][0]).toBe('pl-a')
    // The stored password was reused because the field was left blank.
    expect(calls.replaceConnection.mock.calls[0][1]).toMatchObject({ type: 'xtream', username: 'user-a', password: 'secret-a' })
  })

  it('a failed connection edit changes nothing and reports why, inline', async () => {
    loadChannelsForSource.mockRejectedValue(new Error('network down'))
    const { calls } = renderSettings()

    fireEvent.click(screen.getByText('Edit connection'))
    fireEvent.change(screen.getByPlaceholderText('https://provider.com/get.php?...'), {
      target: { value: 'https://broken.example.com/list.m3u' },
    })
    fireEvent.click(screen.getByText('Connect'))

    await waitFor(() => expect(screen.getByText(/Couldn't reach that playlist/)).toBeTruthy())
    expect(calls.replaceConnection).not.toHaveBeenCalled()
  })

  it('confirms before removing a playlist, and cancelling removes nothing', () => {
    const { calls } = renderSettings()
    fireEvent.click(screen.getByText('Remove'))
    expect(screen.getByText('Remove "My Provider"?')).toBeTruthy()

    fireEvent.click(screen.getByText('Cancel'))
    expect(calls.removePlaylist).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Remove'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Remove'))
    expect(calls.removePlaylist).toHaveBeenCalledWith('pl-a')
  })

  it('resyncs one playlist at a time; Resync all only appears with more than one refetchable playlist', () => {
    const single = renderSettings()
    expect(screen.queryByText('Resync all')).toBeNull()
    fireEvent.click(screen.getByText('Resync now'))
    expect(single.calls.resyncPlaylist).toHaveBeenCalledWith('pl-a')

    cleanup()
    const many = renderSettings({ playlists: [PLAYLIST_A, PLAYLIST_B] })
    fireEvent.click(screen.getByText('Resync all'))
    expect(many.calls.resyncAll).toHaveBeenCalled()
  })

  it('keeps the resync control mounted and focusable while syncing — only its label changes', () => {
    renderSettings({ syncStatuses: { 'pl-a': { kind: 'syncing' } } })
    // Both the row's status badge and the (still-mounted) action say so.
    expect(screen.getAllByText('Syncing…').length).toBe(2)
    expect(screen.queryByText('Resync now')).toBeNull()
    // The playlist itself is still listed.
    expect(screen.getAllByText('My Provider').length).toBeGreaterThan(0)
  })

  it('reports a failed sync inline, with the playlist still connected', () => {
    renderSettings({ syncStatuses: { 'pl-a': { kind: 'error', message: "Couldn't sync — existing playlist kept." } } })
    expect(screen.getByText("Couldn't sync — existing playlist kept.")).toBeTruthy()
    expect(screen.getAllByText('My Provider').length).toBeGreaterThan(0)
  })

  it('offers Replace file (never a fake automatic resync) for a file playlist', () => {
    const filePlaylist: PlaylistDefinition = { ...PLAYLIST_A, id: 'pl-f', name: 'From file', source: { type: 'file', fileName: 'tv.m3u' } }
    renderSettings({ playlists: [filePlaylist] })
    expect(screen.getByText('Replace file')).toBeTruthy()
    expect(screen.queryByText('Resync now')).toBeNull()
  })
})

describe('Settings — Countries', () => {
  function setCountries(favoriteCountries: string[]) {
    savePreferences({ sports: ['football'], footballLeagueIds: [], favoriteCountries, streamType: 'auto', favoriteTeamIds: [], homeContentMode: 'all' })
  }

  it('marks the first preferred country as Primary', () => {
    setCountries(['Norway', 'Sweden'])
    renderSettings()
    openSection('Countries')
    expect(screen.getByText('Primary')).toBeTruthy()
  })

  it('adds a country from the combined playlist countries', () => {
    setCountries([])
    renderSettings()
    openSection('Countries')
    fireEvent.click(screen.getByText('United Kingdom'))
    expect(loadPreferences().favoriteCountries).toEqual(['United Kingdom'])
  })

  it('stops at five and never silently drops one of the user’s existing choices to make room', () => {
    setCountries(['Norway', 'Sweden', 'United Kingdom', 'Germany', 'France'])
    renderSettings()
    openSection('Countries')

    fireEvent.click(screen.getByText('Italy'))

    expect(loadPreferences().favoriteCountries).toEqual(['Norway', 'Sweden', 'United Kingdom', 'Germany', 'France'])
    expect(screen.getByText('5 / 5')).toBeTruthy()
  })

  it('makes a different country primary, preserving the relative order of the rest', () => {
    setCountries(['Norway', 'Sweden', 'United Kingdom'])
    renderSettings()
    openSection('Countries')

    fireEvent.click(screen.getByText('United Kingdom'))
    fireEvent.click(screen.getByText('Make primary'))

    expect(loadPreferences().favoriteCountries).toEqual(['United Kingdom', 'Norway', 'Sweden'])
  })

  it('removes a preferred country without a deselect/reselect dance', () => {
    setCountries(['Norway', 'Sweden'])
    renderSettings()
    openSection('Countries')

    fireEvent.click(screen.getByText('Sweden'))
    fireEvent.click(screen.getByText('Remove'))

    expect(loadPreferences().favoriteCountries).toEqual(['Norway'])
  })
})

describe('Settings — Sports & leagues', () => {
  function setPrefs(footballLeagueIds: string[], sports: Array<'football' | 'f1'> = ['football', 'f1']) {
    savePreferences({ sports, footballLeagueIds, favoriteCountries: [], streamType: 'auto', favoriteTeamIds: [], homeContentMode: 'all' })
  }

  it('renders the leagues already followed', () => {
    setPrefs(['football_premier_league', 'football_eliteserien'])
    renderSettings()
    openSection('Sports & leagues')
    expect(screen.getByText('2 leagues')).toBeTruthy()
    expect(screen.getAllByText('Premier League').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Eliteserien').length).toBeGreaterThan(0)
  })

  it('renders ONE region’s competitions at a time, never the whole catalog', () => {
    setPrefs([])
    renderSettings()
    openSection('Sports & leagues')

    // England opens first (three competitions); Spain's and Norway's are
    // not mounted until their region is focused.
    expect(screen.getByText('England competitions')).toBeTruthy()
    expect(screen.getAllByText('Championship').length).toBe(1)
    expect(screen.queryByText('La Liga')).toBeNull()
  })

  it('switching region does not drop selections made in another region', () => {
    setPrefs(['football_premier_league'])
    renderSettings()
    openSection('Sports & leagues')

    fireEvent.click(screen.getByText('Spain'))
    fireEvent.click(screen.getByText('La Liga'))

    expect(loadPreferences().footballLeagueIds).toEqual(['football_premier_league', 'football_la_liga'])
    // The England selection is still shown as followed.
    expect(screen.getAllByText('Premier League').length).toBeGreaterThan(0)
  })

  it('toggles a sport, and clears league selections when football is turned off', () => {
    setPrefs(['football_premier_league'])
    renderSettings()
    openSection('Sports & leagues')

    fireEvent.click(screen.getByText('Football'))

    expect(loadPreferences().sports).toEqual(['f1'])
    expect(loadPreferences().footballLeagueIds).toEqual([])
  })
})

// The section formerly known as Playback. Two radio groups on one surface —
// Home content breadth (which genuinely hides events) and stream-type
// ranking (which never does) — so both the copy boundary and the vertical
// focus chain across the group boundary are asserted, not eyeballed.
describe('Settings — Personalisation', () => {
  const KEY_CODES = { ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 } as const
  const arrow = (key: keyof typeof KEY_CODES) => fireEvent.keyDown(window, { key, keyCode: KEY_CODES[key] })

  // The label of whichever row currently owns focus. Read off the rendered
  // class rather than from norigin's key so the assertion is about what a
  // viewer would actually see highlighted.
  const focusedRowLabel = () =>
    document.querySelector('.settings-row.focused .settings-row-label')?.textContent ?? null

  describe('stream preference (unchanged behaviour)', () => {
    it('persists each stream-type choice through the existing preferences model', () => {
      savePreferences({ sports: ['football'], footballLeagueIds: [], favoriteCountries: [], streamType: 'auto', favoriteTeamIds: [], homeContentMode: 'all' })
      renderSettings()
      openSection('Personalisation')

      fireEvent.click(screen.getByText('Event Streams'))
      expect(loadPreferences().streamType).toBe('event')

      fireEvent.click(screen.getByText('TV Channels'))
      expect(loadPreferences().streamType).toBe('tv')

      fireEvent.click(screen.getByText('Auto'))
      expect(loadPreferences().streamType).toBe('auto')
    })

    it('uses consumer wording and never the IPTV-internal term', () => {
      renderSettings()
      openSection('Personalisation')
      expect(screen.getByText('Prefer match-specific streams')).toBeTruthy()
      expect(document.body.textContent).not.toContain('PPV')
    })

    // The claim is true of stream ranking and flatly untrue of the Home
    // modes above it, so it must stay attached to its own group rather than
    // being promoted to the pane hint.
    it('keeps "it never hides anything" inside the stream-preference group, not in the pane hint', () => {
      renderSettings()
      openSection('Personalisation')
      const hint = document.querySelector('.settings-pane-hint')?.textContent ?? ''
      expect(hint).toBe('Control what Ninety surfaces on Home and how it ranks available streams.')
      expect(hint).not.toContain('never hides anything')
      expect(document.querySelector('.settings-group-hint')?.textContent).toContain('never hides anything')
    })
  })

  describe('Home recommendations', () => {
    it('offers exactly the three modes, with their product copy', () => {
      renderSettings()
      openSection('Personalisation')
      expect(screen.getByText('Everything')).toBeTruthy()
      expect(screen.getByText('Show all relevant matches. Your leagues and teams rank higher.')).toBeTruthy()
      expect(screen.getByText('My leagues + highlights')).toBeTruthy()
      expect(screen.getByText('Prioritise what you follow, while still surfacing major matches from elsewhere.')).toBeTruthy()
      expect(screen.getByText('My leagues only')).toBeTruthy()
      expect(screen.getByText('Only show football from leagues you follow.')).toBeTruthy()
    })

    it('marks "My leagues + highlights" as recommended, and only that one', () => {
      renderSettings()
      openSection('Personalisation')
      const marked = [...document.querySelectorAll('.settings-row')].filter((row) =>
        row.textContent?.includes('Recommended'),
      )
      expect(marked).toHaveLength(1)
      expect(marked[0].textContent).toContain('My leagues + highlights')
    })

    it('persists each mode immediately, with no Save step', () => {
      savePreferences({ sports: ['football'], footballLeagueIds: [], favoriteCountries: [], streamType: 'auto', favoriteTeamIds: [], homeContentMode: 'all' })
      renderSettings()
      openSection('Personalisation')

      fireEvent.click(screen.getByText('My leagues only'))
      expect(loadPreferences().homeContentMode).toBe('favorites_only')

      fireEvent.click(screen.getByText('My leagues + highlights'))
      expect(loadPreferences().homeContentMode).toBe('highlights')

      fireEvent.click(screen.getByText('Everything'))
      expect(loadPreferences().homeContentMode).toBe('all')
    })

    it('leaves every other preference untouched when the mode changes', () => {
      savePreferences({
        sports: ['football', 'f1'],
        footballLeagueIds: ['football_premier_league'],
        favoriteCountries: ['Norway'],
        streamType: 'tv',
        favoriteTeamIds: ['team_a'],
        homeContentMode: 'all',
      })
      renderSettings()
      openSection('Personalisation')
      fireEvent.click(screen.getByText('My leagues only'))

      const prefs = loadPreferences()
      expect(prefs.sports).toEqual(['football', 'f1'])
      expect(prefs.footballLeagueIds).toEqual(['football_premier_league'])
      expect(prefs.favoriteCountries).toEqual(['Norway'])
      expect(prefs.streamType).toBe('tv')
      expect(prefs.favoriteTeamIds).toEqual(['team_a'])
    })

    it('reflects the stored mode as the selected row when the pane opens', () => {
      savePreferences({ sports: ['football'], footballLeagueIds: [], favoriteCountries: [], streamType: 'auto', favoriteTeamIds: [], homeContentMode: 'favorites_only' })
      renderSettings()
      openSection('Personalisation')
      const selected = [...document.querySelectorAll('.settings-row.selected')].map(
        (row) => row.querySelector('.settings-row-label')?.textContent,
      )
      expect(selected).toContain('My leagues only')
      expect(selected).not.toContain('Everything')
    })
  })

  // THE FOCUS CHAIN. Two radio groups separated by a heading (and, for the
  // second, a paragraph) is exactly the geometry norigin's >=20%-overlap
  // search gets wrong, so every vertical move is stated by the pane and
  // asserted here.
  describe('TV focus', () => {
    const railFocused = () => document.querySelector('.settings-rail-item.focused')?.textContent

    async function enterPane() {
      renderSettings()
      openSectionFromRail('Personalisation')
      await waitFor(() => expect(screen.getByText('My leagues only')).toBeTruthy())
      // Exactly what the rail's own Right handler does (see SettingsScreen's
      // enterPane). Stated here rather than fired as a keypress because
      // norigin's focus state is global and survives cleanup: the previous
      // test's row re-registers under the same key on this render, so
      // without an explicit claim the pane would be entered wherever the
      // last test left off instead of at its documented entry point.
      void setFocus(PANE_ENTRY_FOCUS_KEY)
      await waitFor(() => expect(focusedRowLabel()).toBe('Everything'))
    }

    // ONE PRESS, THEN WAIT. norigin resolves setFocus asynchronously (it
    // measures layout first), so firing several arrows back-to-back would
    // apply the second press against the focus the first had not yet moved.
    // Every step therefore states the row it expects to land on, which also
    // makes a failure name the exact press that went wrong.
    async function press(key: keyof typeof KEY_CODES, expected: string) {
      arrow(key)
      await waitFor(() => expect(focusedRowLabel()).toBe(expected))
    }

    it('enters on the first Home recommendation, not on a stream choice', async () => {
      await enterPane()
      expect(focusedRowLabel()).toBe('Everything')
    })

    it('moves Down through all three Home choices', async () => {
      await enterPane()
      await press('ArrowDown', 'My leagues + highlights')
      await press('ArrowDown', 'My leagues only')
    })

    it('crosses from the last Home choice into the first stream choice, and back up again', async () => {
      await enterPane()
      await press('ArrowDown', 'My leagues + highlights')
      await press('ArrowDown', 'My leagues only')
      // The group boundary in both directions — a heading and two separate
      // list containers apart, which geometry alone does not bridge.
      await press('ArrowDown', 'Auto')
      await press('ArrowUp', 'My leagues only')
    })

    it('continues through the stream choices and stops at the bottom rather than wrapping', async () => {
      await enterPane()
      await press('ArrowDown', 'My leagues + highlights')
      await press('ArrowDown', 'My leagues only')
      await press('ArrowDown', 'Auto')
      await press('ArrowDown', 'TV Channels')
      await press('ArrowDown', 'Event Streams')
      // Down at the bottom consumes the press and stays put — wrapping to
      // the top would look like the highlight jumping the whole pane.
      await press('ArrowDown', 'Event Streams')
    })

    it('stops at the top rather than wrapping to the bottom', async () => {
      await enterPane()
      await press('ArrowUp', 'Everything')
    })

    it('returns to the rail on Left from a Home recommendation', async () => {
      await enterPane()
      arrow('ArrowLeft')
      await waitFor(() => expect(railFocused()).toBe('Personalisation'))
    })

    it('returns to the rail on Left from a stream choice too', async () => {
      await enterPane()
      await press('ArrowDown', 'My leagues + highlights')
      await press('ArrowDown', 'My leagues only')
      await press('ArrowDown', 'Auto')
      await press('ArrowDown', 'TV Channels')
      arrow('ArrowLeft')
      await waitFor(() => expect(railFocused()).toBe('Personalisation'))
    })

    // Focus escaping to the screen's own root focusable draws no ring at
    // all and reads as a dead remote — see SelectableCard's BLOCK_ARROW.
    it('never leaves a row unfocused at a horizontal edge', async () => {
      await enterPane()
      await press('ArrowRight', 'Everything')
    })
  })
})

describe('Settings — Channel visibility', () => {
  it('edits the SAME hiddenCountries/hiddenCategories the Channels filter uses', () => {
    const { calls } = renderSettings({ hiddenCountries: new Set(['Germany']) })
    openSection('Channel visibility')

    fireEvent.click(screen.getByText('Norway'))

    expect(calls.onChangeChannelVisibility).toHaveBeenCalledTimes(1)
    const [nextCountries] = calls.onChangeChannelVisibility.mock.calls[0]
    expect([...(nextCountries as Set<string>)].sort()).toEqual(['Germany', 'Norway'])
  })

  it('scopes category visibility per country, using the existing composite key', () => {
    const { calls } = renderSettings()
    openSection('Channel visibility')

    fireEvent.click(screen.getByText('Sports'))

    const [, nextCategories] = calls.onChangeChannelVisibility.mock.calls[0]
    expect([...(nextCategories as Set<string>)]).toEqual(['Norway::Sports'])
  })

  it('rebinds the category column to the newly focused country', () => {
    const { calls } = renderSettings()
    openSection('Channel visibility')

    // Norway is active on open; move to the next country and toggle one of
    // ITS categories. The composite key that gets written is what proves the
    // column really rebound rather than still editing Norway.
    fireEvent.click(screen.getByText('United Kingdom'))
    fireEvent.click(screen.getByText('Sports'))

    const [, nextCategories] = calls.onChangeChannelVisibility.mock.calls.at(-1)!
    expect([...(nextCategories as Set<string>)]).toEqual(['United Kingdom::Sports'])
  })

  it('confirms before clearing recently watched', () => {
    const { calls } = renderSettings({ recentlyWatchedCount: 4 })
    openSection('Channel visibility')

    fireEvent.click(screen.getByText('Clear recently watched (4)'))
    expect(screen.getByText('Clear recently watched?')).toBeTruthy()
    expect(calls.onClearRecentlyWatched).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Clear'))
    expect(calls.onClearRecentlyWatched).toHaveBeenCalledTimes(1)
  })
})

describe('Settings — every focusable registers with a real DOM node', () => {
  // The spatial-navigation library warns (and loses focus coordinates)
  // whenever a useFocusable ref never reaches an element — the classic
  // symptom of a control rendered conditionally around its own ref. It is
  // invisible in a screenshot and fatal with a remote, so it is asserted
  // rather than eyeballed. See norigin-spatial-navigation-core's
  // addFocusable: console.warn('Component added without a node reference…').
  it('emits no "node reference" warning while walking all five sections', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderSettings({ playlists: [PLAYLIST_A, PLAYLIST_B], recentlyWatchedCount: 3 })
      for (const label of ['Playlists', 'Sports & leagues', 'Countries', 'Personalisation', 'Channel visibility']) {
        openSectionFromRail(label)
      }
      const offenders = warn.mock.calls.map((args) => String(args[0])).filter((m) => m.includes('node reference'))
      expect(offenders).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  it('emits none with an EMPTY library either — the empty state is a real focus surface', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderSettings({ playlists: [] })
      for (const label of ['Playlists', 'Sports & leagues', 'Countries', 'Personalisation', 'Channel visibility']) {
        openSectionFromRail(label)
      }
      const offenders = warn.mock.calls.map((args) => String(args[0])).filter((m) => m.includes('node reference'))
      expect(offenders).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })
})

// THE FOCUS-CONTINUITY CONTRACT.
//
// A Settings action must never switch top-level sections merely because the
// control holding focus stopped existing during the resulting state update.
// That is not hypothetical: the spatial-navigation library's own answer to
// "the focused component just unmounted" is a debounced "focus my parent",
// and every control on this screen is a direct child of the Settings root —
// so the fallback resolved through the root's preferred child and quietly
// put the user back on Playlists. Adding a country from the Countries pane
// did it on every press.
//
// These drive REAL norigin focus (setFocus + key events + getCurrentFocusKey),
// not just clicks: a pointer click never moves spatial focus, which is why
// the existing persistence tests above pass while the TV was broken.
describe('Settings — focus continuity across mutations', () => {
  const KEY_CODES = { ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 } as const
  const arrow = (key: keyof typeof KEY_CODES) => fireEvent.keyDown(window, { key, keyCode: KEY_CODES[key] })
  const pressEnter = () => {
    fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 })
    fireEvent.keyUp(window, { key: 'Enter', keyCode: 13 })
  }

  const activeSection = () => document.querySelector('.settings-rail-item.active')?.textContent
  const railFocused = () => document.querySelector('.settings-rail-item.focused')?.textContent ?? null
  // What a viewer would see highlighted — the strongest available check that
  // focus landed somewhere REAL. A focus key pointing at a deregistered
  // component leaves nothing highlighted at all, which is the dead-remote
  // symptom these tests exist to catch.
  const focusedRowLabel = () => document.querySelector('.settings-row.focused .settings-row-label')?.textContent ?? null
  const focusedActionLabel = () => document.querySelector('.settings-action.focused')?.textContent ?? null
  const focusedChipLabel = () => document.querySelector('.settings-chip.focused span')?.textContent ?? null

  // The library resolves setFocus asynchronously (it measures layout first),
  // so every step states where it expects to land before the next one.
  async function focusKey(key: string) {
    void setFocus(key)
    await waitFor(() => expect(getCurrentFocusKey()).toBe(key))
  }

  // The auto-restore this whole pass is about is DEBOUNCED by 300ms
  // (AUTO_RESTORE_FOCUS_DELAY). Asserting immediately after the mutation
  // would pass even with the bug present, so every case waits past it and
  // then asserts where focus actually came to rest.
  const AUTO_RESTORE_DELAY_MS = 300
  const settleAutoRestore = () => new Promise((resolve) => setTimeout(resolve, AUTO_RESTORE_DELAY_MS + 100))

  function setPrefs(overrides: Partial<ReturnType<typeof loadPreferences>> = {}) {
    savePreferences({
      sports: ['football'],
      footballLeagueIds: [],
      favoriteCountries: [],
      streamType: 'auto',
      favoriteTeamIds: [],
      homeContentMode: 'all',
      ...overrides,
    })
  }

  describe('Countries', () => {
    // The combined channel set these tests run against offers, in the
    // pane's own order (channel count desc, then alphabetical):
    // Norway, France, Germany, Italy, Sweden, United Kingdom.
    const availableKey = (name: string) => `settings-country-available-${name}`

    async function openCountries() {
      renderSettings()
      openSectionFromRail('Countries')
      await waitFor(() => expect(screen.getByText('Preferred')).toBeTruthy())
    }

    it('adding a middle Available country keeps the section and lands on the next country', async () => {
      setPrefs({ favoriteCountries: ['Norway'] })
      await openCountries()
      await focusKey(availableKey('Germany'))

      pressEnter()

      await waitFor(() => expect(loadPreferences().favoriteCountries).toEqual(['Norway', 'Germany']))
      await settleAutoRestore()
      // The section the user was working in, not the one Settings opens on.
      expect(activeSection()).toBe('Countries')
      expect(railFocused()).toBeNull()
      // Italy slid into the index Germany vacated.
      expect(getCurrentFocusKey()).toBe(availableKey('Italy'))
      expect(focusedRowLabel()).toBe('Italy')
    })

    it('adding the FIRST preferred country — when the Available column owns the pane entry — stays in Countries', async () => {
      setPrefs({ favoriteCountries: [] })
      await openCountries()
      // With nothing preferred, the first Available row is the pane entry,
      // so this is also the "Right from the rail, then Enter" path.
      await focusKey(PANE_ENTRY_FOCUS_KEY)
      expect(focusedRowLabel()).toBe('Norway')

      pressEnter()

      await waitFor(() => expect(loadPreferences().favoriteCountries).toEqual(['Norway']))
      await settleAutoRestore()
      expect(activeSection()).toBe('Countries')
      expect(getCurrentFocusKey()).toBe(availableKey('France'))
      expect(focusedRowLabel()).toBe('France')
    })

    it('adding the LAST Available country falls back to the one above it', async () => {
      setPrefs({ favoriteCountries: ['Norway'] })
      await openCountries()
      await focusKey(availableKey('United Kingdom'))

      pressEnter()

      await waitFor(() => expect(loadPreferences().favoriteCountries).toEqual(['Norway', 'United Kingdom']))
      await settleAutoRestore()
      expect(activeSection()).toBe('Countries')
      expect(getCurrentFocusKey()).toBe(availableKey('Sweden'))
      expect(focusedRowLabel()).toBe('Sweden')
    })

    it('emptying the Available column falls back into the Preferred column, not to the rail', async () => {
      // Needs a playlist carrying FEWER countries than the five-country cap
      // — with the default seven, the cap is always reached first and the
      // Available column can never actually run out.
      setPrefs({ favoriteCountries: ['Norway'] })
      renderSettings({
        channelSet: mergeChannelSources([
          { id: '1', name: 'NRK 1', groupTitle: 'NO| Sports', url: 'http://a/1.ts' },
          { id: '2', name: 'SVT 1', groupTitle: 'SE| General', url: 'http://a/2.ts' },
        ]),
      })
      openSectionFromRail('Countries')
      await waitFor(() => expect(screen.getByText('Preferred')).toBeTruthy())
      await focusKey(availableKey('Sweden'))

      pressEnter()

      await waitFor(() => expect(loadPreferences().favoriteCountries).toEqual(['Norway', 'Sweden']))
      await settleAutoRestore()
      expect(activeSection()).toBe('Countries')
      // The Preferred column's first row owns the pane entry key.
      expect(getCurrentFocusKey()).toBe(PANE_ENTRY_FOCUS_KEY)
      expect(focusedRowLabel()).toBe('Norway')
    })

    it('at the five-country cap, Enter changes nothing and focus does not move', async () => {
      setPrefs({ favoriteCountries: ['Norway', 'Sweden', 'United Kingdom', 'Germany', 'France'] })
      await openCountries()
      await focusKey(availableKey('Italy'))

      pressEnter()

      await settleAutoRestore()
      expect(loadPreferences().favoriteCountries).toEqual(['Norway', 'Sweden', 'United Kingdom', 'Germany', 'France'])
      expect(activeSection()).toBe('Countries')
      expect(getCurrentFocusKey()).toBe(availableKey('Italy'))
      expect(focusedRowLabel()).toBe('Italy')
    })

    it('removing a preferred country leaves focus on the Remove action', async () => {
      setPrefs({ favoriteCountries: ['Norway', 'Sweden'] })
      await openCountries()
      await focusKey('settings-country-remove')

      pressEnter()

      await waitFor(() => expect(loadPreferences().favoriteCountries).toEqual(['Sweden']))
      await settleAutoRestore()
      expect(activeSection()).toBe('Countries')
      expect(focusedActionLabel()).toBe('Remove')
    })

    it('changing the primary country leaves focus on the Make primary action', async () => {
      setPrefs({ favoriteCountries: ['Norway', 'Sweden'] })
      await openCountries()
      // Highlight Sweden, then step down into the actions the way the pane's
      // own Enter handler does.
      await focusKey('settings-country-selected-Sweden')
      pressEnter()
      await waitFor(() => expect(getCurrentFocusKey()).toBe('settings-country-make-primary'))

      pressEnter()

      await waitFor(() => expect(loadPreferences().favoriteCountries).toEqual(['Sweden', 'Norway']))
      await settleAutoRestore()
      expect(activeSection()).toBe('Countries')
      // "Make primary" is one control; the reorder happened underneath it
      // and it kept the highlight. (Its label now reads "Already primary".)
      expect(getCurrentFocusKey()).toBe('settings-country-make-primary')
      expect(focusedActionLabel()).toBe('Already primary')
    })
  })

  describe('Sports & leagues', () => {
    const chipKey = (leagueId: string) => `settings-league-chip-${leagueId}`

    async function openSports(footballLeagueIds: string[]) {
      setPrefs({ footballLeagueIds })
      renderSettings()
      openSectionFromRail('Sports & leagues')
      await waitFor(() => expect(screen.getByText('Following')).toBeTruthy())
    }

    it('Down from the Football toggle reaches the followed-league chips', async () => {
      await openSports(['football_premier_league', 'football_la_liga'])
      await focusKey(PANE_ENTRY_FOCUS_KEY)

      arrow('ArrowDown')

      await waitFor(() => expect(focusedChipLabel()).toBe('Premier League'))
    })

    it('removing a followed league from its chip keeps the section and lands on the next chip', async () => {
      await openSports(['football_premier_league', 'football_fa_cup', 'football_la_liga'])
      await focusKey(chipKey('football_fa_cup'))

      pressEnter()

      await waitFor(() => expect(loadPreferences().footballLeagueIds).toEqual(['football_premier_league', 'football_la_liga']))
      await settleAutoRestore()
      expect(activeSection()).toBe('Sports & leagues')
      expect(railFocused()).toBeNull()
      expect(getCurrentFocusKey()).toBe(chipKey('football_la_liga'))
      expect(focusedChipLabel()).toBe('La Liga')
    })

    it('removing the LAST chip falls back to the previous chip', async () => {
      await openSports(['football_premier_league', 'football_la_liga'])
      await focusKey(chipKey('football_la_liga'))

      pressEnter()

      await settleAutoRestore()
      expect(activeSection()).toBe('Sports & leagues')
      expect(getCurrentFocusKey()).toBe(chipKey('football_premier_league'))
      expect(focusedChipLabel()).toBe('Premier League')
    })

    it('removing the ONLY chip falls back to a stable Sports & leagues control', async () => {
      await openSports(['football_premier_league'])
      await focusKey(chipKey('football_premier_league'))

      pressEnter()

      await waitFor(() => expect(loadPreferences().footballLeagueIds).toEqual([]))
      await settleAutoRestore()
      expect(activeSection()).toBe('Sports & leagues')
      expect(getCurrentFocusKey()).toBe('settings-manage-teams')
      expect(document.querySelector('.settings-row.focused')).toBeTruthy()
    })

    it('turning Football off leaves focus on the Football row and consumes Down (nothing below it is mounted)', async () => {
      await openSports(['football_premier_league'])
      await focusKey(PANE_ENTRY_FOCUS_KEY)

      pressEnter()

      await waitFor(() => expect(loadPreferences().sports).toEqual([]))
      await settleAutoRestore()
      expect(activeSection()).toBe('Sports & leagues')
      expect(focusedRowLabel()).toBe('Football')

      // The chips, Manage teams and the region rail are all gone with it —
      // Down must not aim at a region row that is no longer registered.
      arrow('ArrowDown')
      await settleAutoRestore()
      expect(focusedRowLabel()).toBe('Football')
    })
  })

  describe('Playlists', () => {
    it('Left from the first playlist’s actions returns to the first ROW, which really is focused', async () => {
      setPrefs()
      renderSettings({ playlists: [PLAYLIST_A, PLAYLIST_B] })
      // The first row is registered under PANE_ENTRY_FOCUS_KEY, not under
      // `settings-playlist-${id}` — the detail column used to rebuild the
      // latter and send focus at a key no component held.
      await focusKey(PANE_ENTRY_FOCUS_KEY)
      expect(focusedRowLabel()).toBe('My Provider')

      arrow('ArrowRight')
      await waitFor(() => expect(getCurrentFocusKey()).toBe('settings-playlist-rename'))

      arrow('ArrowLeft')

      await waitFor(() => expect(getCurrentFocusKey()).toBe(PANE_ENTRY_FOCUS_KEY))
      expect(focusedRowLabel()).toBe('My Provider')
    })

    it('Left from a non-first playlist’s actions returns to that playlist’s own row', async () => {
      setPrefs()
      renderSettings({ playlists: [PLAYLIST_A, PLAYLIST_B] })
      await focusKey('settings-playlist-pl-b')
      arrow('ArrowRight')
      await waitFor(() => expect(getCurrentFocusKey()).toBe('settings-playlist-rename'))

      arrow('ArrowLeft')

      await waitFor(() => expect(getCurrentFocusKey()).toBe('settings-playlist-pl-b'))
      expect(focusedRowLabel()).toBe('Backup')
    })

    it('removing a playlist while its ROW holds focus lands on a surviving row', async () => {
      setPrefs()
      renderRemovableSettings([PLAYLIST_A, PLAYLIST_B])
      await focusKey('settings-playlist-pl-b')

      // Opened from the row, so the dialog's opener is the row itself — the
      // one thing guaranteed to be gone by the time the dialog closes.
      pressEnter()
      await waitFor(() => expect(getCurrentFocusKey()).toBe('settings-playlist-rename'))
      await focusKey('settings-playlist-remove')
      pressEnter()
      await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
      await focusKey('settings-confirm-accept')
      pressEnter()

      await waitFor(() => expect(screen.queryByText('Backup')).toBeNull())
      await settleAutoRestore()
      expect(activeSection()).toBe('Playlists')
      expect(railFocused()).toBeNull()
      // The Remove action survives (it details My Provider now), so the
      // modal's own opener restoration is what holds — and it holds on
      // something real.
      expect(focusedActionLabel()).toBe('Remove')
    })

    it('removing the LAST playlist lands on the empty state’s Add action, not on the rail', async () => {
      setPrefs()
      renderRemovableSettings([PLAYLIST_A])
      await focusKey('settings-playlist-remove')
      pressEnter()
      await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
      await focusKey('settings-confirm-accept')

      pressEnter()

      await waitFor(() => expect(screen.getByText('No playlists connected')).toBeTruthy())
      await settleAutoRestore()
      expect(activeSection()).toBe('Playlists')
      expect(getCurrentFocusKey()).toBe(PANE_ENTRY_FOCUS_KEY)
      expect(focusedActionLabel()).toBe('Add playlist')
    })
  })

  // THE SAFETY NET, exercised through the one mutation that still reaches
  // it. The league browser opens on whichever region the viewer follows most
  // competitions in, and that choice is re-derived while no region row has
  // been focused yet — so unfollowing the last league of the opened region
  // from its own CARD swaps the whole grid out, taking the focused card with
  // it. Nothing local can name a neighbour for a card in a grid that no
  // longer exists, so this falls all the way back to the Settings root.
  //
  // Pinned to the initial section, that fallback landed on the Playlists
  // rail item and switched the section out from under the viewer. It now
  // resolves to the rail item for the section they are actually in.
  describe('Settings root fallback', () => {
    it('resolves into the section the user is in, not the section Settings opens on', async () => {
      setPrefs({ footballLeagueIds: ['football_la_liga'] })
      renderSettings()
      openSectionFromRail('Sports & leagues')
      // Spain, because that is where the only followed competition is.
      await waitFor(() => expect(screen.getByText('Spain competitions')).toBeTruthy())
      await focusKey('settings-league-football_la_liga')

      pressEnter()

      await waitFor(() => expect(loadPreferences().footballLeagueIds).toEqual([]))
      await settleAutoRestore()
      expect(activeSection()).toBe('Sports & leagues')
      expect(railFocused()).toBe('Sports & leagues')
    })
  })

  // Every Settings dialog restores focus to the control that opened it
  // (useModalFocusScope). The cases worth stating are the ones where the
  // confirm CHANGES what it opened from — the opener has to still be a real
  // control afterwards, or the restore lands on a retired key and the remote
  // goes dead with nothing highlighted.
  describe('dialogs restore focus to a control that still exists', () => {
    it('Rename returns to the Rename action, which the rename did not disturb', async () => {
      setPrefs()
      renderSettings()
      await focusKey('settings-playlist-rename')
      pressEnter()
      await waitFor(() => expect(screen.getByDisplayValue('My Provider')).toBeTruthy())

      fireEvent.change(screen.getByDisplayValue('My Provider'), { target: { value: 'Living room' } })
      fireEvent.click(screen.getByText('Save'))

      await settleAutoRestore()
      expect(activeSection()).toBe('Playlists')
      expect(getCurrentFocusKey()).toBe('settings-playlist-rename')
      expect(focusedActionLabel()).toBe('Rename')
    })

    it('Clear recently watched returns to the action whose label it changed', async () => {
      setPrefs()
      renderSettings({ recentlyWatchedCount: 4 })
      openSectionFromRail('Channel visibility')
      await waitFor(() => expect(screen.getByText(/Ticked countries and categories/)).toBeTruthy())
      await focusKey('settings-clear-recent')
      pressEnter()
      await waitFor(() => expect(screen.getByText('Clear recently watched?')).toBeTruthy())

      fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Clear'))

      await settleAutoRestore()
      expect(activeSection()).toBe('Channel visibility')
      expect(getCurrentFocusKey()).toBe('settings-clear-recent')
    })

    it('Manage teams returns to the summary row it was opened from', async () => {
      setPrefs({ footballLeagueIds: ['football_premier_league'] })
      renderSettings()
      openSectionFromRail('Sports & leagues')
      await waitFor(() => expect(screen.getByText('Favorite teams')).toBeTruthy())
      await focusKey('settings-manage-teams')
      pressEnter()
      await waitFor(() => expect(screen.getByText('Teams you follow')).toBeTruthy())

      fireEvent.click(screen.getByText('Done'))

      await settleAutoRestore()
      expect(activeSection()).toBe('Sports & leagues')
      expect(getCurrentFocusKey()).toBe('settings-manage-teams')
      expect(focusedRowLabel()).toBe('None yet')
    })

    it('adding the first playlist from the empty state leaves focus on the pane, not the rail', async () => {
      setPrefs()
      loadChannelsForSource.mockResolvedValue(channels())
      renderSettings({ playlists: [] })
      await focusKey(PANE_ENTRY_FOCUS_KEY)
      expect(focusedActionLabel()).toBe('Add playlist')
      pressEnter()
      await waitFor(() => expect(screen.getByPlaceholderText('https://provider.com/get.php?...')).toBeTruthy())

      fireEvent.change(screen.getByPlaceholderText('https://provider.com/get.php?...'), {
        target: { value: 'https://first.example.com/list.m3u' },
      })
      fireEvent.click(screen.getByText('Connect'))

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      await settleAutoRestore()
      expect(activeSection()).toBe('Playlists')
      expect(railFocused()).toBeNull()
      expect(getCurrentFocusKey()).toBe(PANE_ENTRY_FOCUS_KEY)
    })
  })

  // Rows that only change state must NOT move focus — the other half of the
  // contract, and the reason those panes are deliberately left alone.
  describe('mutations that keep their own row mounted', () => {
    it('a Personalisation choice keeps focus on the row that was chosen', async () => {
      setPrefs()
      renderSettings()
      openSectionFromRail('Personalisation')
      await waitFor(() => expect(screen.getByText('My leagues only')).toBeTruthy())
      await focusKey('settings-stream-type-tv')

      pressEnter()

      await waitFor(() => expect(loadPreferences().streamType).toBe('tv'))
      await settleAutoRestore()
      expect(activeSection()).toBe('Personalisation')
      expect(focusedRowLabel()).toBe('TV Channels')
    })

    it('a Channel-visibility toggle keeps focus on the row that was toggled', async () => {
      setPrefs()
      renderSettings()
      openSectionFromRail('Channel visibility')
      await waitFor(() => expect(screen.getByText(/Ticked countries and categories/)).toBeTruthy())
      await focusKey('settings-visibility-country-United Kingdom')

      pressEnter()

      await settleAutoRestore()
      expect(activeSection()).toBe('Channel visibility')
      expect(focusedRowLabel()).toBe('United Kingdom')
    })
  })
})

describe('Settings — nothing developer-facing leaks into the production screen', () => {
  // 'Reset onboarding' was on this forbidden list until 2026-08-31, when a
  // deliberate, confirmed, user-facing Reset was added to the Playlists pane
  // (see the suite below). The guard's intent has not changed — no DEBUG
  // surface may reach a real user — but a reset is not a debug surface: it
  // is the standard way any TV app is handed on to someone else or dug out
  // of a broken state, and on this hardware it is also the ONLY way, since
  // the AdminPanel is compiled out of production builds and the TV exposes
  // no devtools to clear storage by hand. What stays forbidden is anything
  // that exposes Ninety's internals or wipes data without asking.
  it('shows no diagnostics, cache versions, API URLs or admin surfaces', () => {
    renderSettings()
    const text = document.body.textContent ?? ''
    for (const forbidden of ['Clear storage', 'ninety-api', 'cache version', 'Debug', 'Admin']) {
      expect(text).not.toContain(forbidden)
    }
  })

  // The part of the old guard that still matters: a reset must never be one
  // press away. Both actions are confirmed before anything is destroyed.
  it('destroys nothing on the press that opens a reset', () => {
    renderSettings()
    fireEvent.click(screen.getByText('Reset everything'))
    expect(resetAppData).not.toHaveBeenCalled()
    expect(reloadSpy).not.toHaveBeenCalled()
  })
})

// Resetting the app from the TV itself.
//
// This exists because there was NO way to do it on device: the AdminPanel
// that owned the old reset is behind `import.meta.env.DEV`, so it does not
// exist in the Tizen build at all, and at this Samsung account tier there
// are no devtools to clear storage by hand. Reinstalling was the only path.
describe('Settings — resetting the app', () => {
  // The pane's button and the dialog's confirm deliberately share a label
  // ("Reset everything" both places, so the confirm restates exactly what is
  // about to happen), so a click has to say which one it means.
  const clickInDialog = (label: string) => {
    const actions = document.querySelector('.settings-dialog-actions')
    if (!actions) throw new Error('no reset dialog is open')
    fireEvent.click(within(actions as HTMLElement).getByText(label))
  }

  // Both reset rows live at the foot of the Playlists pane, which is the
  // section Settings opens on, so they are reachable without arrowing
  // through the rail first.
  it('offers both scopes, and says which one keeps the playlist', () => {
    renderSettings()
    expect(screen.getByText('Reset onboarding & preferences')).toBeTruthy()
    expect(screen.getByText('Reset everything')).toBeTruthy()
  })

  it('is still reachable when no playlist is connected', () => {
    // The state a full reset produces. A reset the empty pane hid would be
    // unreachable exactly when someone wants to clear preferences again.
    renderSettings({ playlists: [] })
    expect(screen.getByText('Reset everything')).toBeTruthy()
  })

  it('spells out what a full reset destroys before doing it', () => {
    renderSettings()
    fireEvent.click(screen.getByText('Reset everything'))
    const body = document.querySelector('.settings-dialog-body')?.textContent ?? ''
    expect(body).toContain('playlists')
    expect(body).toContain('favorites')
  })

  it('promises the playlist survives an onboarding-only reset', () => {
    renderSettings()
    fireEvent.click(screen.getByText('Reset onboarding & preferences'))
    expect(document.querySelector('.settings-dialog-body')?.textContent ?? '').toContain('playlists and their downloaded channels are kept')
  })

  it('cancelling changes nothing at all', () => {
    renderSettings()
    fireEvent.click(screen.getByText('Reset everything'))
    clickInDialog('Cancel')

    expect(resetAppData).not.toHaveBeenCalled()
    expect(reloadSpy).not.toHaveBeenCalled()
    expect(document.querySelector('.settings-dialog')).toBeNull()
  })

  it('wipes everything and reloads once confirmed', async () => {
    renderSettings()
    fireEvent.click(screen.getByText('Reset everything'))
    clickInDialog('Reset everything')

    await waitFor(() => expect(resetAppData).toHaveBeenCalledWith('everything'))
    // The reload is what actually returns the app to a first-launch render —
    // resolveInitialScreen then opens onboarding by itself, because the
    // reset cleared the onboarding flag.
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1))
  })

  it('passes the narrower scope through for an onboarding-only reset', async () => {
    renderSettings()
    fireEvent.click(screen.getByText('Reset onboarding & preferences'))
    clickInDialog('Reset')

    await waitFor(() => expect(resetAppData).toHaveBeenCalledWith('onboarding'))
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1))
  })

  // Reloading into a half-cleared app is worse than not resetting at all.
  it('does not reload when the wipe fails, and says so', async () => {
    resetAppData.mockResolvedValue(false)
    renderSettings()
    fireEvent.click(screen.getByText('Reset everything'))
    clickInDialog('Reset everything')

    await waitFor(() => expect(screen.getByText('Reset failed')).toBeTruthy())
    expect(reloadSpy).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('nothing was changed')
  })
})

// CHANNELS DEEP-LINKS HERE. Its toolbar used to open a FilterPopup of its
// own — a second editor for the very same hidden-country/hidden-category
// preferences this pane owns. The popup is gone; the action opens Settings
// on this section instead, and landing on Playlists and asking the viewer to
// walk the rail would have been a worse answer than the popup was.
describe('Settings — opening on a specific section', () => {
  const activeSection = () => document.querySelector('.settings-rail-item.active')?.textContent

  it('opens straight on Channel visibility when asked to', () => {
    renderSettings({ initialSection: 'visibility' })
    expect(activeSection()).toBe('Channel visibility')
    // And the pane itself, not just the rail highlight.
    expect(screen.getByText('Ticked countries and categories appear while browsing Channels.')).toBeTruthy()
  })

  it('puts focus on that section rather than on the first one', async () => {
    renderSettings({ initialSection: 'visibility' })
    await act(async () => {
      await setFocus('settings-screen')
    })
    expect(getCurrentFocusKey()).toBe('settings-rail-visibility')
  })

  it('leaves an ordinary entry opening on Playlists exactly as before', () => {
    renderSettings()
    expect(activeSection()).toBe('Playlists')
  })

  it('lets the viewer move off the deep-linked section normally', async () => {
    renderSettings({ initialSection: 'visibility' })
    await act(async () => {
      await setFocus('settings-rail-countries')
    })
    expect(activeSection()).toBe('Countries')
  })

  // Back is the caller's business either way — Settings just reports it, and
  // App decides whether that means Home, Schedule or Channels.
  it('reports Back the same way however it was opened', () => {
    const { calls } = renderSettings({ initialSection: 'visibility' })
    fireEvent.click(screen.getByText('Back'))
    expect(calls.onBack).toHaveBeenCalledTimes(1)
  })
})
