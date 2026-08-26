// @vitest-environment jsdom
//
// Behavioural coverage for the rebuilt Settings screen. These drive the real
// components (rail, panes, dialogs) and assert on what the user would see
// and what the app would persist — the network boundaries (the competition
// catalog, playlist connection, QR pairing) are the only things stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { init } from '@noriginmedia/norigin-spatial-navigation'
import { makeFakeLocalStorage } from '../../core/storage/testFakeLocalStorage'

// Same one-time setup main.tsx does before rendering <App/>; without it
// every useFocusable() registration throws an unhandled measureLayout
// rejection in jsdom.
init({ debug: false, visualDebug: false })

// jsdom implements no layout, so it has no scrollIntoView — the shared
// useFocusScrollIntoView hook every focusable here uses would otherwise
// throw on first focus.
Element.prototype.scrollIntoView = () => {}

const loadChannelsForSource = vi.fn()
vi.mock('../../data/playlists/connectPlaylist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/playlists/connectPlaylist')>()
  return { ...actual, loadChannelsForSource: (...args: unknown[]) => loadChannelsForSource(...args) }
})

// The QR pairing session creates a server-side session on mount. Stubbed to
// its error state so these tests never touch the network (and so the
// connect dialog renders its manual form without a QR panel).
vi.mock('../setup/usePairingSession', () => ({
  usePairingSession: () => ({ status: 'error', activationUrl: null, retry: () => {} }),
  ackPairing: vi.fn(),
}))

const competitionsState = { current: { status: 'ready', leagues: [] } as unknown }
vi.mock('../../data/sports/useFootballCompetitions', () => ({
  useFootballCompetitions: () => competitionsState.current,
}))

import { SettingsScreen } from './SettingsScreen'
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
}: {
  playlists?: PlaylistDefinition[]
  syncStatuses?: Record<string, PlaylistSyncStatus>
  hiddenCountries?: Set<string>
  hiddenCategories?: Set<string>
  recentlyWatchedCount?: number
} = {}): Harness {
  const calls = {
    addPlaylist: vi.fn().mockResolvedValue(PLAYLIST_A),
    addOrReconnectPlaylist: vi.fn().mockResolvedValue(undefined),
    renamePlaylist: vi.fn(),
    replaceConnection: vi.fn().mockResolvedValue(undefined),
    resyncPlaylist: vi.fn().mockResolvedValue(undefined),
    resyncAll: vi.fn().mockResolvedValue(undefined),
    removePlaylist: vi.fn().mockResolvedValue(undefined),
    onChangeChannelVisibility: vi.fn(),
    onClearRecentlyWatched: vi.fn(),
    onBack: vi.fn(),
  }
  const library: PlaylistLibrary = {
    playlists,
    channels: channels(),
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
      onBack={calls.onBack}
    />,
  )
  return { library, calls }
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
  loadChannelsForSource.mockReset()
  competitionsState.current = { status: 'ready', leagues: CATALOG }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Settings rail', () => {
  it('offers exactly the five top-level sections', () => {
    renderSettings()
    for (const label of ['Playlists', 'Sports & leagues', 'Countries', 'Playback', 'Channel visibility']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('opens on Playlists', () => {
    renderSettings()
    expect(screen.getAllByText('My Provider').length).toBeGreaterThan(0)
    expect(screen.getByText('28,420')).toBeTruthy()
  })

  it('switching sections does not discard preference edits made in another section', () => {
    savePreferences({ sports: ['football', 'f1'], footballLeagueIds: [], favoriteCountries: [], streamType: 'auto', favoriteTeamIds: [] })
    renderSettings()

    openSection('Playback')
    fireEvent.click(screen.getByText('TV Channels'))
    openSection('Countries')
    openSection('Playback')

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
    savePreferences({ sports: ['football'], footballLeagueIds: [], favoriteCountries, streamType: 'auto', favoriteTeamIds: [] })
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
    savePreferences({ sports, footballLeagueIds, favoriteCountries: [], streamType: 'auto', favoriteTeamIds: [] })
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

describe('Settings — Playback', () => {
  it('persists each stream-type choice through the existing preferences model', () => {
    savePreferences({ sports: ['football'], footballLeagueIds: [], favoriteCountries: [], streamType: 'auto', favoriteTeamIds: [] })
    renderSettings()
    openSection('Playback')

    fireEvent.click(screen.getByText('Event Streams'))
    expect(loadPreferences().streamType).toBe('event')

    fireEvent.click(screen.getByText('TV Channels'))
    expect(loadPreferences().streamType).toBe('tv')

    fireEvent.click(screen.getByText('Auto'))
    expect(loadPreferences().streamType).toBe('auto')
  })

  it('uses consumer wording and never the IPTV-internal term', () => {
    renderSettings()
    openSection('Playback')
    expect(screen.getByText('Prefer match-specific streams')).toBeTruthy()
    expect(document.body.textContent).not.toContain('PPV')
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
      for (const label of ['Playlists', 'Sports & leagues', 'Countries', 'Playback', 'Channel visibility']) {
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
      for (const label of ['Playlists', 'Sports & leagues', 'Countries', 'Playback', 'Channel visibility']) {
        openSectionFromRail(label)
      }
      const offenders = warn.mock.calls.map((args) => String(args[0])).filter((m) => m.includes('node reference'))
      expect(offenders).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })
})

describe('Settings — nothing developer-facing leaks into the production screen', () => {
  it('shows no diagnostics, cache versions, API URLs, onboarding reset or storage wipe', () => {
    renderSettings()
    const text = document.body.textContent ?? ''
    for (const forbidden of ['Reset onboarding', 'Clear storage', 'ninety-api', 'cache version', 'Debug', 'Admin']) {
      expect(text).not.toContain(forbidden)
    }
  })
})
