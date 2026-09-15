import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyRemotePlaylistCommand, type RemotePlaylistCommand } from './useRemotePlaylistManagement'
import type { PlaylistLibrary } from './usePlaylistLibrary'
import type { PlaylistDefinition } from './playlistDefinition'

vi.mock('./connectPlaylist', () => ({ connectPlaylistFromUrl: vi.fn(), loadChannelsForSource: vi.fn() }))
vi.mock('./playlistLibraryStore', () => ({ loadPlaylistLibrary: vi.fn() }))
import { connectPlaylistFromUrl } from './connectPlaylist'
import { loadPlaylistLibrary } from './playlistLibraryStore'

const command: RemotePlaylistCommand = { id: 'abc', playlistId: 'pl-abc', operation: 'add', name: 'Sports', url: 'https://provider.invalid/list.m3u' }
const playlist = { id: command.playlistId, name: command.name, source: { type: 'm3u-url', url: command.url } } as PlaylistDefinition

describe('remote playlist delivery', () => {
  let stored: PlaylistDefinition[]
  let library: PlaylistLibrary
  beforeEach(() => {
    vi.resetAllMocks()
    stored = []
    vi.mocked(loadPlaylistLibrary).mockImplementation(() => stored)
    vi.mocked(connectPlaylistFromUrl).mockResolvedValue({ source: playlist.source as { type: 'm3u-url'; url: string }, channels: [] })
    library = {
      addPlaylist: vi.fn(async () => { stored = [playlist]; return playlist }),
      removePlaylist: vi.fn(async () => { stored = [] }),
      renamePlaylist: vi.fn((_id, name) => { stored = [{ ...playlist, name }] }),
    } as unknown as PlaylistLibrary
  })
  it('does not mutate the library while playback is active', async () => {
    expect(await applyRemotePlaylistCommand(command, () => ({ library, playback: true }))).toBe(false)
    expect(connectPlaylistFromUrl).not.toHaveBeenCalled()
    expect(library.addPlaylist).not.toHaveBeenCalled()
  })
  it('defers installation if playback starts while downloading', async () => {
    let playback = false
    vi.mocked(connectPlaylistFromUrl).mockImplementation(async () => { playback = true; return { source: playlist.source as { type: 'm3u-url'; url: string }, channels: [] } })
    expect(await applyRemotePlaylistCommand(command, () => ({ library, playback }))).toBe(false)
    expect(library.addPlaylist).not.toHaveBeenCalled()
  })
  it('retries a delivered add without creating duplicate playlists', async () => {
    const current = () => ({ library, playback: false })
    expect(await applyRemotePlaylistCommand(command, current)).toBe(true)
    expect(await applyRemotePlaylistCommand(command, current)).toBe(true)
    expect(library.addPlaylist).toHaveBeenCalledTimes(1)
  })
  it('does not report a successful add when persistence fails', async () => {
    vi.mocked(library.addPlaylist).mockResolvedValue(playlist)
    await expect(applyRemotePlaylistCommand(command, () => ({ library, playback: false }))).rejects.toThrow('did not persist')
  })
  it('deleting an already removed playlist succeeds safely', async () => {
    expect(await applyRemotePlaylistCommand({ ...command, operation: 'delete' }, () => ({ library, playback: false }))).toBe(true)
    expect(library.removePlaylist).not.toHaveBeenCalled()
  })
})
