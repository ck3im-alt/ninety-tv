// The cross-playlist invariants the rest of the app quietly depends on,
// exercised end-to-end through the REAL storage/merge/combine path rather
// than asserted on hand-built literals:
//
//   1. every playable source in the combined runtime catalog carries the
//      playlist it came from (provenance is what makes per-source Xtream
//      credentials possible at all — see xtreamResolver.ts)
//   2. removing one playlist leaves the other playlist's streams alive,
//      including on a channel BOTH carried
//   3. the country/category vocabulary Settings and the Channels filter work
//      in is the union across connected playlists, and shrinks back when one
//      is removed
//   4. a favorite whose only supplier was removed neither crashes nor
//      resurrects phantom content, and comes back if that playlist does
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeLocalStorage } from '../../core/storage/testFakeLocalStorage'
import type { StoredPlaylistChannelsRecord } from '../../core/storage/idbPlaylistChannelStore'

const store = new Map<string, StoredPlaylistChannelsRecord>()
vi.mock('../../core/storage/idbPlaylistChannelStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/storage/idbPlaylistChannelStore')>()
  return {
    ...actual,
    readPlaylistChannels: async (id: string) => store.get(id) ?? null,
    writePlaylistChannels: async (record: StoredPlaylistChannelsRecord) => {
      store.set(record.playlistId, record)
      return true
    },
    removePlaylistChannels: async (id: string) => {
      store.delete(id)
      return true
    },
    listPlaylistChannelKeys: async () => [...store.keys()],
  }
})

import { commitPlaylistChannels, hydratePlaylistLibrary } from './playlistLibrary'
import { markMigratedFromSinglePlaylist, savePlaylistLibrary } from './playlistLibraryStore'
import { combinePlaylistChannels, type LoadedPlaylistChannels } from './combinePlaylistChannels'
import { createXtreamCredentialResolver } from './xtreamResolver'
import { mergeChannelSources } from '../../features/channels/mergeChannels'
import { getChannelIndex } from '../channelIndex'
import type { Channel } from '../channel'
import type { PlaylistDefinition } from './playlistDefinition'

// Playlist A: a Nordic provider. Playlist B: a UK/US provider that ALSO
// carries TNT Sports 1, at a different quality and from its own panel.
const PLAYLIST_A: PlaylistDefinition = {
  id: 'pl-a',
  name: 'Provider A',
  source: { type: 'xtream', server: 'https://server-a.example', username: 'username-a', password: 'pw-a' },
  createdAt: 0,
  lastSyncedAt: null,
  generationId: '',
  channelCount: 0,
}

const PLAYLIST_B: PlaylistDefinition = {
  ...PLAYLIST_A,
  id: 'pl-b',
  name: 'Provider B',
  source: { type: 'xtream', server: 'https://server-b.example', username: 'username-b', password: 'pw-b' },
}

// Both panels number this stream 123 — panel-local numeric stream ids are
// exactly why provenance has to survive into the combined catalog.
function channelsA(): Channel[] {
  return mergeChannelSources([
    { id: 'a1', name: 'NO | TNT SPORTS 1 FHD', groupTitle: 'NO| Sports', url: 'https://server-a.example/live/username-a/pw-a/123.ts' },
    { id: 'a2', name: 'NO | NRK 1', groupTitle: 'NO| General', url: 'https://server-a.example/live/username-a/pw-a/2.ts' },
    { id: 'a3', name: 'SE | SVT 1', groupTitle: 'SE| General', url: 'https://server-a.example/live/username-a/pw-a/3.ts' },
    // Prefixed GB, where playlist B prefixes the same market UK — the two
    // must not become two visible countries once combined.
    { id: 'a4', name: 'GB | ITV 1', groupTitle: 'GB| General', url: 'https://server-a.example/live/username-a/pw-a/4.ts' },
  ])
}

function channelsB(): Channel[] {
  return mergeChannelSources([
    { id: 'b1', name: 'NO | TNT SPORTS 1 UHD', groupTitle: 'NO| Sports', url: 'https://server-b.example/live/username-b/pw-b/123.ts' },
    { id: 'b2', name: 'UK | BBC ONE', groupTitle: 'UK| General', url: 'https://server-b.example/live/username-b/pw-b/9.ts' },
    { id: 'b3', name: 'US | ESPN', groupTitle: 'USA| Sports', url: 'https://server-b.example/live/username-b/pw-b/10.ts' },
  ])
}

// Puts both playlists through the same gate production uses — the channels
// go in unstamped, exactly as the parsers produce them.
async function connectBoth(): Promise<{ playlists: PlaylistDefinition[]; loaded: LoadedPlaylistChannels[] }> {
  const a = await commitPlaylistChannels(PLAYLIST_A, PLAYLIST_A.source, channelsA())
  const b = await commitPlaylistChannels(PLAYLIST_B, PLAYLIST_B.source, channelsB())
  savePlaylistLibrary([a.playlist, b.playlist])
  return {
    playlists: [a.playlist, b.playlist],
    loaded: [
      { playlistId: a.playlist.id, channels: a.channels },
      { playlistId: b.playlist.id, channels: b.channels },
    ],
  }
}

function untaggedSources(channels: readonly Channel[]): string[] {
  return channels.flatMap((channel) => channel.sources.filter((s) => !s.playlistId).map((s) => `${channel.name}:${s.url}`))
}

function countryNames(channels: Channel[]): string[] {
  return getChannelIndex(channels)
    .getCountries()
    .map((c) => c.name)
    .sort()
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
  store.clear()
  markMigratedFromSinglePlaylist()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('provenance survives the whole runtime path', () => {
  it('leaves no untagged source in the combined catalog, connect through combine', async () => {
    const { loaded } = await connectBoth()
    expect(untaggedSources(combinePlaylistChannels(loaded))).toEqual([])
  })

  it('leaves no untagged source after a reload — what is written to IndexedDB is already stamped', async () => {
    await connectBoth()
    const hydrated = await hydratePlaylistLibrary()
    expect(hydrated.loaded).toHaveLength(2)
    expect(untaggedSources(combinePlaylistChannels(hydrated.loaded))).toEqual([])
  })

  it('resolves each merged source to ITS OWN panel, never the other playlist’s, at the same stream id', async () => {
    const { playlists, loaded } = await connectBoth()
    const combined = combinePlaylistChannels(loaded)
    const tnt = combined.find((c) => c.name.includes('TNT'))!
    expect(tnt.sources).toHaveLength(2)

    const resolver = createXtreamCredentialResolver(playlists)
    const servers = tnt.sources.map((source) => resolver.forSource(source)?.server)
    expect(new Set(servers)).toEqual(new Set(['https://server-a.example', 'https://server-b.example']))
    // Each source's own URL and its resolved panel agree — the failure this
    // guards against is silent: the wrong panel answers happily.
    for (const source of tnt.sources) {
      expect(source.url.startsWith(resolver.forSource(source)!.server)).toBe(true)
    }
  })
})

describe('removing one playlist', () => {
  it('keeps the other playlist’s stream on a channel BOTH carried', async () => {
    const { loaded } = await connectBoth()
    const withoutA = combinePlaylistChannels(loaded.filter((l) => l.playlistId !== 'pl-a'))
    const tnt = withoutA.find((c) => c.name.includes('TNT'))!
    expect(tnt.sources.map((s) => s.playlistId)).toEqual(['pl-b'])
    expect(untaggedSources(withoutA)).toEqual([])
  })

  it('shrinks the country vocabulary Settings and the Channels filter work in', async () => {
    const { loaded } = await connectBoth()
    expect(countryNames(combinePlaylistChannels(loaded))).toEqual([
      'Norway',
      'Sweden',
      'United Kingdom',
      'United States',
    ])
    expect(countryNames(combinePlaylistChannels(loaded.filter((l) => l.playlistId !== 'pl-b')))).toEqual([
      'Norway',
      'Sweden',
      'United Kingdom',
    ])
  })

  it('collapses one playlist’s GB prefix and the other’s UK into a single visible country', () => {
    // Both spellings, one from each playlist — parseCategory's display name
    // is the key the index buckets on, so the alias never doubles the row.
    const combined = combinePlaylistChannels([
      { playlistId: 'pl-a', channels: channelsA() },
      { playlistId: 'pl-b', channels: channelsB() },
    ])
    expect(countryNames(combined).filter((name) => name === 'United Kingdom')).toHaveLength(1)
    const uk = getChannelIndex(combined)
      .getCountries()
      .find((c) => c.name === 'United Kingdom')!
    expect(uk.count).toBe(2)
  })
})

describe('favorites across a playlist removal', () => {
  it('a channel BOTH playlists supply stays resolvable when one is removed', async () => {
    const { loaded } = await connectBoth()
    const combined = combinePlaylistChannels(loaded)
    const tntId = combined.find((c) => c.name.includes('TNT'))!.id
    const favorites = new Set([tntId])

    const withoutA = getChannelIndex(combinePlaylistChannels(loaded.filter((l) => l.playlistId !== 'pl-a')))
    expect(withoutA.getChannelsByIdsInPlaylistOrder(favorites).map((c) => c.id)).toEqual([tntId])
  })

  it('a favorite whose only supplier is gone resolves to nothing rather than crashing or inventing a row', async () => {
    const { loaded } = await connectBoth()
    const combined = combinePlaylistChannels(loaded)
    const espnId = combined.find((c) => c.name.includes('ESPN'))!.id
    const favorites = new Set([espnId])

    const withoutB = getChannelIndex(combinePlaylistChannels(loaded.filter((l) => l.playlistId !== 'pl-b')))
    expect(withoutB.getChannelsByIdsInPlaylistOrder(favorites)).toEqual([])
    expect(withoutB.getChannelById(espnId)).toBeUndefined()
    // The stored preference is untouched, which is what makes it come back.
    expect([...favorites]).toEqual([espnId])
  })

  it('re-adding the playlist restores the favorite — the id is derived, not per-playlist', async () => {
    const { loaded } = await connectBoth()
    const combined = combinePlaylistChannels(loaded)
    const espnId = combined.find((c) => c.name.includes('ESPN'))!.id

    const b = await commitPlaylistChannels(PLAYLIST_B, PLAYLIST_B.source, channelsB())
    const readded = getChannelIndex(
      combinePlaylistChannels([
        ...loaded.filter((l) => l.playlistId !== 'pl-b'),
        { playlistId: b.playlist.id, channels: b.channels },
      ]),
    )
    expect(readded.getChannelsByIdsInPlaylistOrder(new Set([espnId])).map((c) => c.id)).toEqual([espnId])
  })
})
