// The multi-playlist edge case that matters most: two providers carrying
// the same logical channel must produce ONE browse row with BOTH streams,
// each still attributable to the playlist that serves it.
import { describe, expect, it } from 'vitest'
import { combinePlaylistChannels } from './combinePlaylistChannels'
import { mergeChannelSources } from '../../features/channels/mergeChannels'
import { stampPlaylistProvenance } from './playlistDefinition'
import type { Channel } from '../channel'
import type { RawChannel } from '../rawChannel'

function playlist(playlistId: string, raw: RawChannel[]): { playlistId: string; channels: Channel[] } {
  return { playlistId, channels: stampPlaylistProvenance(mergeChannelSources(raw), playlistId) }
}

const tntFhd: RawChannel = {
  id: '1',
  name: 'UK | TNT SPORTS 1 FHD',
  groupTitle: 'UK| Sports',
  url: 'http://a.example/live/ua/pa/101.ts',
  epgChannelId: 'tnt1.uk',
}
const tntUhd: RawChannel = {
  id: '2',
  name: 'UK | TNT SPORT 1 UHD',
  groupTitle: 'UK| Sports',
  url: 'http://b.example/live/ub/pb/202.ts',
}
const tv2NoA: RawChannel = { id: '3', name: 'NO | TV 2 Sport Premium FHD', groupTitle: 'NO| Sports', url: 'http://a.example/live/ua/pa/303.ts' }
const tv2NoB: RawChannel = { id: '4', name: 'NO | TV 2 Sport Premium HD', groupTitle: 'NO| Sports', url: 'http://b.example/live/ub/pb/404.ts' }
const bOnly: RawChannel = { id: '5', name: 'DE | Sky Sport 1', groupTitle: 'DE| Sports', url: 'http://b.example/live/ub/pb/505.ts' }

describe('combinePlaylistChannels', () => {
  it('returns the SAME array reference for a single playlist — a warmed ChannelIndex must survive', () => {
    const only = playlist('pl-a', [tntFhd])
    expect(combinePlaylistChannels([only])).toBe(only.channels)
  })

  it('is empty for an empty library', () => {
    expect(combinePlaylistChannels([])).toEqual([])
  })

  it('collapses the same logical channel from two playlists into one row that keeps BOTH streams', () => {
    const combined = combinePlaylistChannels([playlist('pl-a', [tntFhd]), playlist('pl-b', [tntUhd])])

    expect(combined).toHaveLength(1)
    expect(combined[0].sources.map((s) => s.playlistId)).toEqual(['pl-a', 'pl-b'])
    expect(combined[0].sources.map((s) => s.url)).toEqual([tntFhd.url, tntUhd.url])
  })

  it('keeps each source resolvable to its own playlist — the invariant per-playlist EPG depends on', () => {
    const combined = combinePlaylistChannels([playlist('pl-a', [tv2NoA]), playlist('pl-b', [tv2NoB])])
    const byPlaylist = new Map(combined[0].sources.map((s) => [s.playlistId, s.url]))
    expect(byPlaylist.get('pl-a')).toBe(tv2NoA.url)
    expect(byPlaylist.get('pl-b')).toBe(tv2NoB.url)
  })

  it('rolls EPG ids and raw names up across playlists, and recomputes hasEpgChannelId from the merged list', () => {
    const combined = combinePlaylistChannels([playlist('pl-a', [tntFhd]), playlist('pl-b', [tntUhd])])
    expect(combined[0].epgChannelIds).toEqual(['tnt1.uk'])
    expect(combined[0].rawNames).toEqual([tntFhd.name, tntUhd.name])
    expect(combined[0].hasEpgChannelId).toBe(true)
  })

  it('does not mutate either playlist’s own cached channels while merging', () => {
    const a = playlist('pl-a', [tntFhd])
    const b = playlist('pl-b', [tntUhd])
    combinePlaylistChannels([a, b])
    expect(a.channels[0].sources).toHaveLength(1)
    expect(b.channels[0].sources).toHaveLength(1)
  })

  it('keeps a channel only one playlist carries', () => {
    const combined = combinePlaylistChannels([playlist('pl-a', [tntFhd]), playlist('pl-b', [tntUhd, bOnly])])
    expect(combined.map((c) => c.name)).toEqual(['TNT SPORTS 1', 'Sky Sport 1'])
  })

  it('preserves library order and each playlist’s own order — adding a playlist never reshuffles the first', () => {
    const a = playlist('pl-a', [tntFhd, tv2NoA])
    const b = playlist('pl-b', [bOnly, tntUhd])
    expect(combinePlaylistChannels([a, b]).map((c) => c.name)).toEqual(['TNT SPORTS 1', 'TV 2 Sport Premium', 'Sky Sport 1'])
  })

  it('removing a playlist leaves channels the OTHER playlist still supplies, with only its own source gone', () => {
    const a = playlist('pl-a', [tntFhd, tv2NoA])
    const b = playlist('pl-b', [tntUhd])
    expect(combinePlaylistChannels([a, b])[0].sources).toHaveLength(2)

    // Removal is a rebuild from the remaining playlists, exactly as a fresh
    // launch would produce.
    const afterRemovingA = combinePlaylistChannels([b])
    expect(afterRemovingA).toHaveLength(1)
    // B's own canonical name for the channel, not A's — display identity
    // comes from whichever playlist actually still carries it.
    expect(afterRemovingA[0].name).toBe('TNT SPORT 1')
    expect(afterRemovingA[0].sources.map((s) => s.playlistId)).toEqual(['pl-b'])
  })

  it('deduplicates a genuinely identical URL, but never two different providers’ URLs', () => {
    const shared: RawChannel = { ...tntFhd, id: '9' }
    const combined = combinePlaylistChannels([playlist('pl-a', [tntFhd]), playlist('pl-b', [shared])])
    expect(combined[0].sources).toHaveLength(1)
  })
})
