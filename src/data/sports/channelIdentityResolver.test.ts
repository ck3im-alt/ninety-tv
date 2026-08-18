import { describe, expect, it } from 'vitest'
import { resolveChannelIdentities, type LogicalChannelResolution } from './channelIdentityResolver'
import type { Channel } from '../channel'
import type { NinetyLogicalChannel } from './ninetyApiClient'

function logical(overrides: Partial<NinetyLogicalChannel> & { id: string; name: string }): NinetyLogicalChannel {
  return {
    country: null,
    broadcast_type: 'LINEAR',
    network_name: null,
    channel_number: null,
    channel_variant: null,
    aliases: [],
    external_ids: [],
    source_names: [],
    ...overrides,
  }
}

function channel(overrides: Partial<Channel> & { id: string; name: string }): Channel {
  return {
    sources: [{ label: 'Default', url: 'http://example.invalid/stream' }],
    hasEpgChannelId: (overrides.epgChannelIds?.length ?? 0) > 0,
    ...overrides,
  }
}

function resolve(catalog: NinetyLogicalChannel[], playlist: Channel[]) {
  return resolveChannelIdentities(catalog, playlist)
}

function classificationOf(resolutions: Map<string, LogicalChannelResolution>, id: string): string {
  return resolutions.get(id)?.classification ?? 'MISSING'
}

function matchedChannelIds(resolutions: Map<string, LogicalChannelResolution>, id: string): string[] {
  return (resolutions.get(id)?.matches ?? []).map((m) => m.playlistChannelId).sort()
}

describe('external id signals', () => {
  it('a unique raw external id confirms the logical channel', () => {
    const catalog = [logical({ id: 'gb_tnt_sports_1', name: 'TNT Sports 1', external_ids: [{ source_id: 'src', source_channel_id: 'tnt.1' }] })]
    const playlist = [channel({ id: 'p1', name: 'TNT Sports 1', epgChannelIds: ['tnt.1'] })]
    const res = resolve(catalog, playlist)
    expect(classificationOf(res, 'gb_tnt_sports_1')).toBe('CONFIRMED')
    expect(matchedChannelIds(res, 'gb_tnt_sports_1')).toEqual(['p1'])
  })

  it('an external id shared across logical channels (collision) never confirms on its own', () => {
    const catalog = [
      logical({ id: 'a', name: 'Channel A', country: 'NO', external_ids: [{ source_id: 'src1', source_channel_id: 'shared' }] }),
      logical({ id: 'b', name: 'Channel B', country: 'NO', external_ids: [{ source_id: 'src2', source_channel_id: 'shared' }] }),
    ]
    // No name resemblance to either side — the collision plus a country
    // match is the only evidence, which must stay below the auto bar.
    const playlist = [channel({ id: 'p1', name: 'Unrelated Name', groupTitle: 'Norway| Sport', epgChannelIds: ['shared'] })]
    const res = resolve(catalog, playlist)
    expect(classificationOf(res, 'a')).not.toBe('CONFIRMED')
    expect(classificationOf(res, 'a')).not.toBe('STRONG')
    expect(classificationOf(res, 'b')).not.toBe('CONFIRMED')
    expect(classificationOf(res, 'b')).not.toBe('STRONG')
  })

  it('a collision does not block an otherwise-clean exact name match from confirming', () => {
    const catalog = [
      logical({ id: 'a', name: 'Channel A', external_ids: [{ source_id: 'src1', source_channel_id: 'shared' }] }),
      logical({ id: 'b', name: 'Channel B', external_ids: [{ source_id: 'src2', source_channel_id: 'shared' }] }),
    ]
    const playlist = [channel({ id: 'p1', name: 'Channel A', epgChannelIds: ['shared'] })]
    const res = resolve(catalog, playlist)
    expect(classificationOf(res, 'a')).toBe('CONFIRMED')
    expect(classificationOf(res, 'b')).not.toBe('CONFIRMED')
  })

  it('a merged channel carrying ids that each uniquely point to a DIFFERENT logical channel is ambiguous for both, not an arbitrary pick', () => {
    const catalog = [
      logical({ id: 'a', name: 'Channel A', external_ids: [{ source_id: 'src', source_channel_id: 'id-a' }] }),
      logical({ id: 'b', name: 'Channel B', external_ids: [{ source_id: 'src', source_channel_id: 'id-b' }] }),
    ]
    const playlist = [channel({ id: 'p1', name: 'Channel A', epgChannelIds: ['id-a', 'id-b'] })]
    const res = resolve(catalog, playlist)
    expect(classificationOf(res, 'a')).toBe('AMBIGUOUS')
    expect(classificationOf(res, 'b')).toBe('AMBIGUOUS')
  })

  it('id says channel 1 but the visible name explicitly says channel 2 — ambiguous, never a silent confirm', () => {
    const catalog = [
      logical({ id: 'tnt_1', name: 'TNT Sports 1', country: 'GB', external_ids: [{ source_id: 'src', source_channel_id: 'tnt.1' }] }),
      logical({ id: 'tnt_2', name: 'TNT Sports 2', country: 'GB' }),
    ]
    const playlist = [channel({ id: 'p1', name: 'TNT Sports 2', groupTitle: 'UK| Sports', epgChannelIds: ['tnt.1'] })]
    const res = resolve(catalog, playlist)
    expect(classificationOf(res, 'tnt_1')).toBe('AMBIGUOUS')
    const resolution = res.get('tnt_1')!
    expect(resolution.matches[0].negativeSignals.some((s) => s.type === 'id_name_contradiction')).toBe(true)
    // The id evidence points at tnt_1, not tnt_2 — tnt_2 gets nothing.
    expect(classificationOf(res, 'tnt_2')).toBe('NONE')
  })
})

describe('name identity signals', () => {
  it('exact canonical name confirms', () => {
    const catalog = [logical({ id: 'a', name: 'Sky Sports Main Event' })]
    const playlist = [channel({ id: 'p1', name: 'Sky Sports Main Event' })]
    const res = resolve(catalog, playlist)
    expect(classificationOf(res, 'a')).toBe('CONFIRMED')
  })

  it('exact trusted alias confirms even when the canonical name text differs', () => {
    const catalog = [logical({ id: 'a', name: 'TV 2 Sport 1', aliases: ['TV2 Sporten 1'] })]
    const playlist = [channel({ id: 'p1', name: 'TV2 Sporten 1' })]
    const res = resolve(catalog, playlist)
    expect(classificationOf(res, 'a')).toBe('CONFIRMED')
  })

  it('exact known source name confirms', () => {
    const catalog = [logical({ id: 'a', name: 'Eurosport 1', source_names: ['Eurosport 1 Norway (NO,NO)'] })]
    const playlist = [channel({ id: 'p1', name: 'Eurosport 1 Norway (NO,NO)' })]
    const res = resolve(catalog, playlist)
    expect(classificationOf(res, 'a')).toBe('CONFIRMED')
  })

  it('quality tags on playlist source names are ignored for identity', () => {
    const catalog = [logical({ id: 'a', name: 'TV4' })]
    const playlist = [channel({ id: 'p1', name: 'TV4', rawNames: ['TV4 RAW', 'TV4 FHD', 'TV4 UHD'] })]
    const res = resolve(catalog, playlist)
    expect(classificationOf(res, 'a')).toBe('CONFIRMED')
  })
})

describe('hard negative signals', () => {
  it('an explicit country conflict on both sides rejects a name-based match', () => {
    const catalog = [logical({ id: 'a', name: 'TV 2 Sport 1', country: 'NO' })]
    const playlist = [channel({ id: 'p1', name: 'TV 2 Sport 1', groupTitle: 'Denmark| Sport' })]
    const res = resolve(catalog, playlist)
    expect(classificationOf(res, 'a')).toBe('NONE')
  })

  it('a channel number conflict (TV3 Sport siblings) is never auto-matched', () => {
    const catalog = [logical({ id: 'tv3', name: 'TV3' }), logical({ id: 'tv3_plus', name: 'TV3+' }), logical({ id: 'tv3_sport', name: 'TV3 Sport' })]
    const playlist = [channel({ id: 'p1', name: 'TV3+' })]
    const res = resolve(catalog, playlist)
    expect(classificationOf(res, 'tv3_plus')).toBe('CONFIRMED')
    expect(classificationOf(res, 'tv3')).toBe('NONE')
    expect(classificationOf(res, 'tv3_sport')).toBe('NONE')
  })

  it('Arena Sport numbered siblings never cross-match, and the umbrella brand alone does not establish identity', () => {
    const catalog = [
      logical({ id: 'arena_sport_premium_1', name: 'Arena Sport Premium 1' }),
      logical({ id: 'arena_fight', name: 'Arena Fight' }),
      logical({ id: 'arena_esport', name: 'Arena eSport' }),
    ]
    const playlist = [channel({ id: 'p1', name: 'Arena Sport Premium 1' })]
    const res = resolve(catalog, playlist)
    expect(classificationOf(res, 'arena_sport_premium_1')).toBe('CONFIRMED')
    expect(classificationOf(res, 'arena_fight')).toBe('NONE')
    expect(classificationOf(res, 'arena_esport')).toBe('NONE')
  })

  it('TVP umbrella siblings sharing a root word and a coincidental number do not cross-match', () => {
    const catalog = [logical({ id: 'tvp2', name: 'TVP 2' }), logical({ id: 'tvp_historia_2', name: 'TVP Historia 2' })]
    const playlist = [channel({ id: 'p1', name: 'TVP 2' })]
    const res = resolve(catalog, playlist)
    expect(classificationOf(res, 'tvp2')).toBe('CONFIRMED')
    expect(classificationOf(res, 'tvp_historia_2')).toBe('NONE')
  })

  it('TVP umbrella siblings do not cross-match in the other direction either (catalog side carries the extra word)', () => {
    const catalog = [logical({ id: 'tvp_historia_2', name: 'TVP Historia 2' })]
    const playlist = [channel({ id: 'p1', name: 'TVP 2' })]
    const res = resolve(catalog, playlist)
    expect(classificationOf(res, 'tvp_historia_2')).toBe('NONE')
  })
})

describe('reverse collision (Part 6)', () => {
  it('one playlist channel is never automatically claimed by two different logical channels', () => {
    const catalog = [logical({ id: 'no_tv3', name: 'TV3' }), logical({ id: 'dk_tv3', name: 'TV3' })]
    const playlist = [channel({ id: 'p1', name: 'TV3' })]
    const res = resolve(catalog, playlist)
    // Both are exact-canonical-name matches with no country evidence to
    // disambiguate — neither may be silently CONFIRMED/STRONG.
    expect(classificationOf(res, 'no_tv3')).toBe('AMBIGUOUS')
    expect(classificationOf(res, 'dk_tv3')).toBe('AMBIGUOUS')
  })

  it('a decisive score gap lets the higher-scoring logical channel keep the playlist channel', () => {
    const catalog = [
      logical({ id: 'base', name: 'V Sport Premier League', country: 'NO', network_name: 'Viaplay Group' }),
      logical({ id: 'numbered', name: 'V Sport Premier League 1', country: 'NO', network_name: 'Viaplay Group' }),
    ]
    const playlist = [channel({ id: 'p1', name: 'V Sport Premier League 1', groupTitle: 'Norway| Sport' })]
    const res = resolve(catalog, playlist)
    expect(classificationOf(res, 'numbered')).toBe('CONFIRMED')
    expect(matchedChannelIds(res, 'numbered')).toEqual(['p1'])
    // The numberless base entry has no candidate left once the exact
    // match is (correctly) awarded to its own numbered logical channel.
    expect(classificationOf(res, 'base')).toBe('NONE')
  })

  it('legitimate duplicate playlist entries for the SAME logical channel are both accepted', () => {
    const catalog = [logical({ id: 'a', name: 'TNT Sports 1' })]
    const playlist = [
      channel({ id: 'p1', name: 'TNT Sports 1', groupTitle: 'UK| Sports' }),
      channel({ id: 'p2', name: 'TNT Sports 1', groupTitle: 'UK| Sports Backup' }),
    ]
    const res = resolve(catalog, playlist)
    expect(classificationOf(res, 'a')).toBe('CONFIRMED')
    expect(matchedChannelIds(res, 'a')).toEqual(['p1', 'p2'])
  })
})
