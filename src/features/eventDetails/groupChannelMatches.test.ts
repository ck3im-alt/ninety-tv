import { describe, expect, it } from 'vitest'
import { groupChannelMatches } from './groupChannelMatches'
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
