import { describe, expect, it } from 'vitest'
import { findReconnectTarget } from './reconnectTarget'
import type { PlaylistDefinition } from './playlistDefinition'
import type { PlaylistSourceRecord } from '../session'

function filePlaylist(id: string, name: string, fileName: string): PlaylistDefinition {
  return {
    id,
    name,
    source: { type: 'file', fileName },
    createdAt: 0,
    lastSyncedAt: null,
    generationId: 'gen',
    channelCount: 0,
  }
}

const MOVIES: PlaylistSourceRecord = { type: 'file', fileName: 'movies.m3u' }

describe('findReconnectTarget', () => {
  it('adopts the playlist that is waiting for exactly this file, instead of adding a duplicate beside it', () => {
    const waiting = filePlaylist('pl-file', 'movies', 'movies.m3u')
    expect(findReconnectTarget(MOVIES, [waiting])?.id).toBe('pl-file')
  })

  it('adds normally when nothing is waiting — the ordinary "add a second playlist" case', () => {
    expect(findReconnectTarget(MOVIES, [])).toBeNull()
  })

  it('never adopts on count alone: a DIFFERENT file must not overwrite the playlist that is waiting', () => {
    const waiting = filePlaylist('pl-file', 'movies', 'movies.m3u')
    expect(findReconnectTarget({ type: 'file', fileName: 'sports.m3u' }, [waiting])).toBeNull()
  })

  it('picks the matching playlist when several are waiting', () => {
    const waiting = [filePlaylist('pl-1', 'sports', 'sports.m3u'), filePlaylist('pl-2', 'movies', 'movies.m3u')]
    expect(findReconnectTarget(MOVIES, waiting)?.id).toBe('pl-2')
  })

  it('never adopts for a refetchable source — those recover themselves and are always genuine additions', () => {
    const waiting = filePlaylist('pl-file', 'movies', 'movies.m3u')
    const xtream: PlaylistSourceRecord = {
      type: 'xtream',
      server: 'https://provider.example',
      username: 'u',
      password: 'p',
    }
    expect(findReconnectTarget(xtream, [waiting])).toBeNull()
    expect(findReconnectTarget({ type: 'm3u-url', url: 'https://host.example/list.m3u' }, [waiting])).toBeNull()
  })

  it('keeps a renamed playlist adoptable — the match is on the FILE, not the display name', () => {
    const waiting = filePlaylist('pl-file', 'Dad’s films', 'movies.m3u')
    expect(findReconnectTarget(MOVIES, [waiting])?.id).toBe('pl-file')
  })
})
