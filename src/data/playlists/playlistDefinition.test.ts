import { describe, expect, it } from 'vitest'
import {
  combinedGenerationId,
  defaultPlaylistName,
  isResyncable,
  playlistHostname,
  playlistSourceLabel,
  stampPlaylistProvenance,
  type PlaylistDefinition,
} from './playlistDefinition'
import type { Channel } from '../channel'
import type { PlaylistSourceRecord } from '../session'

const xtream: PlaylistSourceRecord = {
  type: 'xtream',
  server: 'https://panel.provider.example:8080',
  username: 'user',
  password: 'hunter2',
}
const m3uUrl: PlaylistSourceRecord = { type: 'm3u-url', url: 'https://lists.example.com/get.php?u=user&p=secret' }
const file: PlaylistSourceRecord = { type: 'file', fileName: 'living-room.m3u' }

function definition(overrides: Partial<PlaylistDefinition> = {}): PlaylistDefinition {
  return {
    id: 'pl-1',
    name: 'Playlist',
    source: xtream,
    createdAt: 0,
    lastSyncedAt: null,
    generationId: 'gen-1',
    channelCount: 0,
    ...overrides,
  }
}

describe('playlistHostname', () => {
  it('extracts the hostname from a full URL', () => {
    expect(playlistHostname('https://panel.provider.example:8080/get.php?x=1')).toBe('panel.provider.example')
  })

  it('accepts a scheme-less host:port the user may have typed into the server field', () => {
    expect(playlistHostname('provider.example.com:8080')).toBe('provider.example.com')
  })

  it('returns null rather than echoing back something that is not hostname-shaped', () => {
    expect(playlistHostname('not a url')).toBeNull()
    expect(playlistHostname('')).toBeNull()
  })
})

describe('playlistSourceLabel', () => {
  it('describes an Xtream playlist by host only — never username or password', () => {
    const label = playlistSourceLabel(xtream)
    expect(label).toBe('Xtream · panel.provider.example')
    expect(label).not.toContain('user')
    expect(label).not.toContain('hunter2')
  })

  it('describes an M3U URL by host only — never the credential-bearing query string', () => {
    const label = playlistSourceLabel(m3uUrl)
    expect(label).toBe('M3U URL · lists.example.com')
    expect(label).not.toContain('secret')
    expect(label).not.toContain('get.php')
  })

  it('describes a file playlist by its file name', () => {
    expect(playlistSourceLabel(file)).toBe('M3U file · living-room.m3u')
  })
})

describe('defaultPlaylistName', () => {
  it('names an Xtream/M3U playlist after its host, without the www prefix', () => {
    expect(defaultPlaylistName(xtream)).toBe('panel.provider.example')
    expect(defaultPlaylistName({ type: 'm3u-url', url: 'https://www.lists.example.com/x.m3u' })).toBe('lists.example.com')
  })

  it('names a file playlist after the file, without its extension', () => {
    expect(defaultPlaylistName(file)).toBe('living-room')
  })

  it('falls back to a numbered name when nothing safe can be derived', () => {
    expect(defaultPlaylistName({ type: 'm3u-url', url: 'not a url' }, ['a', 'b'])).toBe('Playlist 3')
  })

  it('disambiguates a second playlist from the same provider instead of duplicating the name', () => {
    expect(defaultPlaylistName(xtream, ['panel.provider.example'])).toBe('panel.provider.example (2)')
    expect(defaultPlaylistName(xtream, ['panel.provider.example', 'panel.provider.example (2)'])).toBe(
      'panel.provider.example (3)',
    )
  })
})

describe('isResyncable', () => {
  it('is true for sources Ninety can refetch on its own', () => {
    expect(isResyncable(xtream)).toBe(true)
    expect(isResyncable(m3uUrl)).toBe(true)
  })

  it('is false for a file playlist — the bytes were never kept, so an automatic resync would be a lie', () => {
    expect(isResyncable(file)).toBe(false)
  })
})

describe('stampPlaylistProvenance', () => {
  function channels(): Channel[] {
    return [
      { id: 'a', name: 'A', sources: [{ label: 'HD', url: 'u1' }, { label: 'UHD', url: 'u2' }] },
      { id: 'b', name: 'B', sources: [{ label: 'HD', url: 'u3' }] },
    ]
  }

  it('tags every source of every channel with the playlist it came from', () => {
    const stamped = stampPlaylistProvenance(channels(), 'pl-a')
    expect(stamped.flatMap((c) => c.sources.map((s) => s.playlistId))).toEqual(['pl-a', 'pl-a', 'pl-a'])
  })

  it('is idempotent — a migration that runs twice cannot corrupt provenance', () => {
    const once = stampPlaylistProvenance(channels(), 'pl-a')
    const twice = stampPlaylistProvenance(once, 'pl-a')
    expect(twice.flatMap((c) => c.sources.map((s) => s.playlistId))).toEqual(['pl-a', 'pl-a', 'pl-a'])
  })
})

describe('combinedGenerationId', () => {
  it('is null when nothing is connected', () => {
    expect(combinedGenerationId([])).toBeNull()
  })

  it('is stable for an unchanged library — a relaunch must not invalidate the identity resolution cache', () => {
    const library = [definition({ id: 'pl-1', generationId: 'g1' }), definition({ id: 'pl-2', generationId: 'g2' })]
    expect(combinedGenerationId(library)).toBe(combinedGenerationId([...library]))
  })

  it('changes when any member playlist is resynced, added, or removed', () => {
    const a = definition({ id: 'pl-1', generationId: 'g1' })
    const b = definition({ id: 'pl-2', generationId: 'g2' })
    const base = combinedGenerationId([a, b])
    expect(combinedGenerationId([a, { ...b, generationId: 'g3' }])).not.toBe(base)
    expect(combinedGenerationId([a])).not.toBe(base)
    expect(combinedGenerationId([a, b, definition({ id: 'pl-3', generationId: 'g4' })])).not.toBe(base)
  })
})
