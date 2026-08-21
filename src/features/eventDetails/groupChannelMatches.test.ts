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
