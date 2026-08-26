import { describe, expect, it } from 'vitest'
import { groupChannelMatches } from './groupChannelMatches'
import { getChannelDisplayName } from './ppvDisplayName'
import type { Channel } from '../../data/channel'
import type { ChannelMatch } from '../../data/sports/channelMatch'

function channel(overrides: Partial<Channel> & { id: string; name: string }): Channel {
  return { sources: [{ label: 'Default', url: `http://example.com/${overrides.id}` }], ...overrides }
}

function ppvMatch(id: string, rawName: string, groupTitle: string): ChannelMatch {
  return { channel: channel({ id, name: rawName, groupTitle }), source: 'ppvName', label: rawName, isExactMatch: false }
}

describe('groupChannelMatches PPV quality-variant grouping', () => {
  it('merges same-slot PPV entries that differ only by an embedded quality tag into one group', () => {
    const raw = (tag: string) => `LIVE | RAYO VALLECANO - DEPORTIVO ALAVES | Thu 20 Aug 21:00 CEST | ${tag} | NO: TV2 PLAY PPV 20`
    const matches: ChannelMatch[] = [
      ppvMatch('ch-8k', raw('8K EXCLUSIVE'), 'NO| PPV'),
      ppvMatch('ch-fhd', raw('FHD'), 'NO| PPV'),
      ppvMatch('ch-hd', raw('HD'), 'NO| PPV'),
    ]

    const groups = groupChannelMatches(matches)

    expect(groups).toHaveLength(1)
    expect(groups[0].sourceOptions).toHaveLength(3)
  })

  it('keeps genuinely distinct PPV slots as separate groups', () => {
    const matches: ChannelMatch[] = [
      ppvMatch('ch-20', 'LIVE | TEAM A - TEAM B | NO: TV2 PLAY PPV 20', 'NO| PPV'),
      ppvMatch('ch-21', 'LIVE | TEAM C - TEAM D | NO: TV2 PLAY PPV 21', 'NO| PPV'),
    ]

    const groups = groupChannelMatches(matches)

    expect(groups).toHaveLength(2)
  })

  // Part U of the redesign task, verbatim regression: two different
  // one-off event streams from the SAME provider ("Arsenal - Coventry ...
  // VIAPLAY PPV 15" and "Liverpool - Chelsea ... VIAPLAY PPV 16") must
  // stay as two independently selectable groups even though the NEW
  // contextual display normalizer (extractProviderIdentity, see
  // ppvDisplayName.ts) shows BOTH as just "VIAPLAY" for display. Grouping
  // identity (normalizePpvDisplayName, unchanged) intentionally keeps the
  // slot number; only the separate DISPLAY layer strips it.
  it('two different one-off events from the same provider never collapse into one group, even though their contextual display names are identical', () => {
    const arsenalCoventry = 'NEXT | PREMIER LEAGUE ARSENAL - COVENTRY | Fri 21 Aug 20:00 CEST (NO) | 8K EXCLUSIVE | NO: VIAPLAY PPV 15'
    const liverpoolChelsea = 'NEXT | PREMIER LEAGUE LIVERPOOL - CHELSEA | Fri 21 Aug 20:00 CEST (NO) | 8K EXCLUSIVE | NO: VIAPLAY PPV 16'
    const matches: ChannelMatch[] = [ppvMatch('ch-15', arsenalCoventry, 'NO| PPV'), ppvMatch('ch-16', liverpoolChelsea, 'NO| PPV')]

    const groups = groupChannelMatches(matches)
    expect(groups).toHaveLength(2)

    const arsenalDisplay = getChannelDisplayName(groups[0], { homeTeam: 'Arsenal', awayTeam: 'Coventry' })
    const liverpoolDisplay = getChannelDisplayName(groups[1], { homeTeam: 'Liverpool', awayTeam: 'Chelsea' })
    // Both raw names advertise the same "20:00" -- the display's own
    // raw-extracted start time (see the PPV time-source correction) is
    // identical between the two, same as the provider name; only the slot
    // number distinguishes the underlying groups, exactly as intended.
    expect(arsenalDisplay).toBe('VIAPLAY | Arsenal - Coventry | 20:00')
    expect(liverpoolDisplay).toBe('VIAPLAY | Liverpool - Chelsea | 20:00')
    // Same provider, but the two lines (and the groups behind them) are
    // still distinguishable -- never collapsed into one selectable stream.
    expect(arsenalDisplay).not.toBe(liverpoolDisplay)
  })

  it('keeps PPV entries from different countries separate even with the same slot name', () => {
    const matches: ChannelMatch[] = [
      ppvMatch('ch-no', 'LIVE | TEAM A - TEAM B | NO: TV2 PLAY PPV 20', 'NO| PPV'),
      ppvMatch('ch-se', 'LIVE | TEAM A - TEAM B | SE: TV2 PLAY PPV 20', 'SE| PPV'),
    ]

    const groups = groupChannelMatches(matches)

    expect(groups).toHaveLength(2)
  })
})

describe('groupChannelMatches non-PPV grouping (regression)', () => {
  it('still merges the same real channel split across quality-tagged sibling categories', () => {
    const matches: ChannelMatch[] = [
      { channel: channel({ id: 'ch-1', name: 'TNT Sports 1', groupTitle: 'UK| Sports HD' }), source: 'broadcasterMap', label: 'TNT Sports 1', isExactMatch: true },
      { channel: channel({ id: 'ch-2', name: 'TNT Sports 1', groupTitle: 'UK| Sports RAW' }), source: 'broadcasterMap', label: 'TNT Sports 1', isExactMatch: true },
    ]

    const groups = groupChannelMatches(matches)

    expect(groups).toHaveLength(1)
    expect(groups[0].sourceOptions).toHaveLength(2)
  })

  it('keeps unrelated non-PPV channels as separate groups', () => {
    const matches: ChannelMatch[] = [
      { channel: channel({ id: 'ch-1', name: 'TNT Sports 1', groupTitle: 'UK| Sports' }), source: 'broadcasterMap', label: 'TNT Sports 1', isExactMatch: true },
      { channel: channel({ id: 'ch-2', name: 'Sky Sports Main Event', groupTitle: 'UK| Sports' }), source: 'broadcasterMap', label: 'Sky Sports Main Event', isExactMatch: true },
    ]

    const groups = groupChannelMatches(matches)

    expect(groups).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------
// Ninety logical-channel identity grouping (stream-dedupe task, Part 1).
// The reported bug: Event Details showed "TV 2 Sport 1" twice under NORWAY
// and "TNT Sports 1" twice under UNITED KINGDOM, because two playlist
// entries that ninety-api's resolver had already CONFIRMED as the same
// logical channel were regrouped afterwards by playlist TEXT, which
// disagreed ("TV2 SPORT 1" vs "TV 2 SPORT 1", a stray decorative glyph
// leaving "TNT SPORTS 1 HD ◉" un-normalized).
// ---------------------------------------------------------------------

function ninetyMatch(
  id: string,
  name: string,
  groupTitle: string,
  logicalChannelId: string,
  overrides: Partial<ChannelMatch> = {},
): ChannelMatch {
  return {
    channel: channel({ id, name, groupTitle }),
    source: 'ninety',
    label: 'Canonical Broadcast Name',
    isExactMatch: true,
    identityClassification: 'CONFIRMED',
    logicalChannelId,
    ...overrides,
  }
}

describe('groupChannelMatches Ninety logical-channel identity', () => {
  it('collapses two differently-spelled playlist channels that resolved to the SAME logical channel into one group', () => {
    const matches = [
      ninetyMatch('p1', 'TV2 SPORT 1', 'NO| Sports', 'no_tv2_sport_1'),
      ninetyMatch('p2', 'TV 2 SPORT 1', 'NO| Sports', 'no_tv2_sport_1'),
    ]

    const groups = groupChannelMatches(matches)

    expect(groups).toHaveLength(1)
    expect(groups[0].sourceOptions).toHaveLength(2)
    expect(groups[0].logicalChannelId).toBe('no_tv2_sport_1')
  })

  it('collapses the real TNT case, where a decorative glyph left one name un-normalized', () => {
    const matches = [
      ninetyMatch('p1', 'TNT SPORTS 1', 'UK| Sports', 'gb_tnt_sports_1'),
      ninetyMatch('p2', 'TNT SPORTS 1 HD ◉', 'UK| Sports', 'gb_tnt_sports_1'),
    ]

    expect(groupChannelMatches(matches)).toHaveLength(1)
  })

  it('collapses across differently-spelled country prefixes for the same market (NO vs NOR)', () => {
    const matches = [
      ninetyMatch('p1', 'TV2 SPORT 1', 'NO| Sports', 'no_tv2_sport_1'),
      ninetyMatch('p2', 'TV 2 SPORT 1', 'NOR | Sports', 'no_tv2_sport_1'),
    ]

    expect(groupChannelMatches(matches)).toHaveLength(1)
  })

  it('scopes the logical group to the ninety-reported broadcast country when the playlist category has none', () => {
    const matches = [
      ninetyMatch('p1', 'TV2 SPORT 1', 'Sports', 'no_tv2_sport_1', { broadcastCountry: 'NO' }),
      ninetyMatch('p2', 'TV 2 SPORT 1', 'NO| Sports', 'no_tv2_sport_1', { broadcastCountry: 'NO' }),
    ]

    expect(groupChannelMatches(matches)).toHaveLength(1)
  })

  it('never merges different logical channels (TNT Sports 1 vs TNT Sports 2)', () => {
    const matches = [
      ninetyMatch('p1', 'TNT SPORTS 1', 'UK| Sports', 'gb_tnt_sports_1'),
      ninetyMatch('p2', 'TNT SPORTS 2', 'UK| Sports', 'gb_tnt_sports_2'),
    ]

    expect(groupChannelMatches(matches)).toHaveLength(2)
  })

  it('never merges numbered siblings (V Sport Premier League 1 vs 2) that resolved to different logical channels', () => {
    const matches = [
      ninetyMatch('p1', 'V SPORT PREMIER LEAGUE 1', 'SE| Sports', 'se_v_sport_pl_1'),
      ninetyMatch('p2', 'V SPORT PREMIER LEAGUE 2', 'SE| Sports', 'se_v_sport_pl_2'),
    ]

    expect(groupChannelMatches(matches)).toHaveLength(2)
  })

  it('never merges the same logical channel across genuinely different playlist countries', () => {
    const matches = [
      ninetyMatch('p1', 'EUROSPORT 1', 'NO| Sports', 'eurosport_1'),
      ninetyMatch('p2', 'EUROSPORT 1', 'SE| Sports', 'eurosport_1'),
    ]

    expect(groupChannelMatches(matches)).toHaveLength(2)
  })

  it('keeps text grouping for matches with no logical identity at all', () => {
    const matches: ChannelMatch[] = [
      { channel: channel({ id: 'p1', name: 'TNT Sports 1', groupTitle: 'UK| Sports HD' }), source: 'broadcasterMap', label: 'TNT Sports 1', isExactMatch: true },
      { channel: channel({ id: 'p2', name: 'TNT Sports 1', groupTitle: 'UK| Sports RAW' }), source: 'broadcasterMap', label: 'TNT Sports 1', isExactMatch: true },
      { channel: channel({ id: 'p3', name: 'TNT Sports 2', groupTitle: 'UK| Sports' }), source: 'broadcasterMap', label: 'TNT Sports 2', isExactMatch: true },
    ]

    const groups = groupChannelMatches(matches)

    expect(groups).toHaveLength(2)
    expect(groups[0].sourceOptions).toHaveLength(2)
  })

  // Adding the logical layer must not SPLIT what text grouping already
  // merged: a channel resolved by Ninety and an identically-named sibling
  // matched only by a weaker stage share one row, exactly as before.
  it('absorbs a same-named non-ninety match into the logical group instead of splitting it out', () => {
    const matches: ChannelMatch[] = [
      ninetyMatch('p1', 'TNT SPORTS 1', 'UK| Sports', 'gb_tnt_sports_1'),
      { channel: channel({ id: 'p2', name: 'TNT Sports 1', groupTitle: 'UK| Sports' }), source: 'broadcasterMap', label: 'TNT Sports 1', isExactMatch: true },
    ]

    const groups = groupChannelMatches(matches)

    expect(groups).toHaveLength(1)
    expect(groups[0].logicalChannelId).toBe('gb_tnt_sports_1')
    expect(groups[0].sourceOptions).toHaveLength(2)
  })

  // Part 2: logical identity must never reach the PPV/event path — a
  // provider's logical channel says nothing about WHICH one-off event a
  // given PPV slot carries.
  it('never merges two different one-off events that resolved to the same provider logical channel', () => {
    const matches = [
      ninetyMatch('p1', 'NEXT | ARSENAL - COVENTRY | Fri 21 Aug 20:00 CEST (NO) | NO: VIAPLAY PPV 15', 'NO| PPV', 'no_viaplay'),
      ninetyMatch('p2', 'NEXT | LIVERPOOL - CHELSEA | Fri 21 Aug 20:00 CEST (NO) | NO: VIAPLAY PPV 16', 'NO| PPV', 'no_viaplay'),
    ]

    expect(groupChannelMatches(matches, { homeTeam: 'Arsenal', awayTeam: 'Coventry' })).toHaveLength(2)
  })

  // ...while real quality mirrors of THIS fixture from that same provider
  // still collapse, slot numbers and all — the merge Part 2 requires be
  // preserved.
  it('still merges same-provider mirrors of the SAME fixture published under different PPV slots', () => {
    const matches = [
      ninetyMatch('p1', 'NEXT | ARSENAL - COVENTRY | Fri 21 Aug 20:00 CEST (NO) | 8K EXCLUSIVE | NO: VIAPLAY PPV 15', 'NO| PPV', 'no_viaplay'),
      ninetyMatch('p2', 'NEXT | ARSENAL - COVENTRY | Fri 21 Aug 20:00 CEST (NO) | FHD | NO: VIAPLAY PPV 16', 'NO| PPV', 'no_viaplay'),
    ]

    expect(groupChannelMatches(matches, { homeTeam: 'Arsenal', awayTeam: 'Coventry' })).toHaveLength(1)
  })
})
