// The subtlest way multi-playlist support can break: Xtream stream ids are
// numeric and panel-local, so stream 123 exists on essentially every panel.
// Sending playlist B's stream id to playlist A's panel does not fail — it
// returns A's programme for an unrelated channel. These tests pin that down.
import { describe, expect, it } from 'vitest'
import { createXtreamCredentialResolver, firstXtreamSource, NO_XTREAM_CREDENTIALS, xtreamSources } from './xtreamResolver'
import { extractStreamId } from '../xtream/extractStreamId'
import type { PlaylistDefinition } from './playlistDefinition'
import type { Channel } from '../channel'

function definition(id: string, source: PlaylistDefinition['source']): PlaylistDefinition {
  return { id, name: id, source, createdAt: 0, lastSyncedAt: null, generationId: 'g', channelCount: 0 }
}

const playlistA = definition('pl-a', { type: 'xtream', server: 'https://server-a.example', username: 'username-a', password: 'pw-a' })
const playlistB = definition('pl-b', { type: 'xtream', server: 'https://server-b.example', username: 'username-b', password: 'pw-b' })
const m3uPlaylist = definition('pl-m3u', { type: 'm3u-url', url: 'https://lists.example/playlist.m3u' })
const filePlaylist = definition('pl-file', { type: 'file', fileName: 'x.m3u' })

describe('createXtreamCredentialResolver', () => {
  it('resolves each source to ITS OWN playlist’s credentials', () => {
    const resolver = createXtreamCredentialResolver([playlistA, playlistB])
    expect(resolver.forSource({ label: 'HD', url: 'u', playlistId: 'pl-a' })).toEqual({
      server: 'https://server-a.example',
      username: 'username-a',
      password: 'pw-a',
    })
    expect(resolver.forSource({ label: 'HD', url: 'u', playlistId: 'pl-b' })).toEqual({
      server: 'https://server-b.example',
      username: 'username-b',
      password: 'pw-b',
    })
  })

  it('never hands one playlist’s credentials to another playlist’s stream, even at the same stream id', () => {
    const resolver = createXtreamCredentialResolver([playlistA, playlistB])
    const sameStreamIdOnA = { label: 'HD', url: 'http://server-a.example/live/username-a/pw-a/123.ts', playlistId: 'pl-a' }
    const sameStreamIdOnB = { label: 'HD', url: 'http://server-b.example/live/username-b/pw-b/123.ts', playlistId: 'pl-b' }
    expect(resolver.forSource(sameStreamIdOnA)?.username).toBe('username-a')
    expect(resolver.forSource(sameStreamIdOnB)?.username).toBe('username-b')
  })

  it('returns null for a non-Xtream playlist’s source — plain M3U and file playlists have no EPG API', () => {
    const resolver = createXtreamCredentialResolver([playlistA, m3uPlaylist, filePlaylist])
    expect(resolver.forSource({ label: 'HD', url: 'u', playlistId: 'pl-m3u' })).toBeNull()
    expect(resolver.forSource({ label: 'HD', url: 'u', playlistId: 'pl-file' })).toBeNull()
  })

  it('returns null for a source with no or unknown provenance rather than guessing a playlist', () => {
    const resolver = createXtreamCredentialResolver([playlistA])
    expect(resolver.forSource({ label: 'HD', url: 'u' })).toBeNull()
    expect(resolver.forSource({ label: 'HD', url: 'u', playlistId: 'pl-gone' })).toBeNull()
    expect(resolver.forSource(undefined)).toBeNull()
  })

  it('reports hasAny so callers can skip an entire EPG stage when no Xtream playlist is connected', () => {
    expect(createXtreamCredentialResolver([playlistA]).hasAny).toBe(true)
    expect(createXtreamCredentialResolver([m3uPlaylist, filePlaylist]).hasAny).toBe(false)
    expect(createXtreamCredentialResolver([]).hasAny).toBe(false)
    expect(NO_XTREAM_CREDENTIALS.hasAny).toBe(false)
  })
})

describe('firstXtreamSource', () => {
  const resolver = createXtreamCredentialResolver([playlistA, m3uPlaylist])

  it('skips a non-Xtream source to find the one that can actually answer an EPG query', () => {
    // Exactly the cross-playlist merge case: sources[0] belongs to the plain
    // M3U playlist, the Xtream stream is second. Taking sources[0] would
    // silently drop EPG for a channel that has it.
    const channel: Channel = {
      id: 'c',
      name: 'TNT Sports 1',
      sources: [
        { label: 'HD', url: 'https://lists.example/stream.ts', playlistId: 'pl-m3u' },
        { label: 'UHD', url: 'http://server-a.example/live/username-a/pw-a/456.ts', playlistId: 'pl-a' },
      ],
    }
    expect(firstXtreamSource(channel, resolver, extractStreamId)).toMatchObject({
      streamId: 456,
      creds: { username: 'username-a' },
    })
  })

  it('returns null when no source belongs to an Xtream playlist', () => {
    const channel: Channel = { id: 'c', name: 'X', sources: [{ label: 'HD', url: 'https://lists.example/a.ts', playlistId: 'pl-m3u' }] }
    expect(firstXtreamSource(channel, resolver, extractStreamId)).toBeNull()
  })

  it('returns null when an Xtream source’s URL carries no recoverable stream id', () => {
    const channel: Channel = { id: 'c', name: 'X', sources: [{ label: 'HD', url: 'http://server-a.example/odd/path', playlistId: 'pl-a' }] }
    expect(firstXtreamSource(channel, resolver, extractStreamId)).toBeNull()
  })
})

describe('xtreamSources', () => {
  it('returns every queryable source with its own panel credentials', () => {
    const resolver = createXtreamCredentialResolver([playlistA, playlistB, m3uPlaylist])
    const channel: Channel = {
      id: 'merged',
      name: 'Merged Sports',
      sources: [
        { label: 'A', url: 'http://server-a.example/live/u/p/101.ts', playlistId: 'pl-a' },
        { label: 'M3U', url: 'http://lists.example/102.ts', playlistId: 'pl-m3u' },
        { label: 'B', url: 'http://server-b.example/live/u/p/103.ts', playlistId: 'pl-b' },
      ],
    }

    expect(xtreamSources(channel, resolver, extractStreamId).map(({ streamId, creds }) => [streamId, creds.username])).toEqual([
      [101, 'username-a'],
      [103, 'username-b'],
    ])
  })
})
