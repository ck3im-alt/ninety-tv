import { describe, expect, it } from 'vitest'
import { normalizePpvDisplayName, getChannelDisplayName } from './ppvDisplayName'
import type { MatchGroup, SourceOption } from './groupChannelMatches'
import type { Channel } from '../../data/channel'

const TEAMS = { homeTeam: 'Deportivo', awayTeam: 'Elche' }

function channel(name: string, groupTitle?: string): Channel {
  return { id: name, name, groupTitle, sources: [{ label: 'Default', url: `http://example.com/${name}` }] }
}

function sourceOption(name: string, groupTitle?: string): SourceOption {
  const ch = channel(name, groupTitle)
  return { channel: ch, source: ch.sources[0] }
}

function group(overrides: Partial<MatchGroup> = {}): MatchGroup {
  return {
    key: 'g',
    name: 'Raw Playlist Name',
    isExactMatch: false,
    confidence: 'likely',
    label: 'Raw Playlist Name',
    sourceOptions: [sourceOption('Raw Playlist Name')],
    ...overrides,
  }
}

describe('normalizePpvDisplayName', () => {
  it('reduces a long raw PPV title down to the provider/channel slot', () => {
    const raw = 'LIVE | DEPORTIVO – ELCHE | Mon 17 Aug 20:55 CEST (NO) | 8K EXCLUSIVE | NO: TV2 PLAY PPV 9'
    expect(normalizePpvDisplayName(raw, TEAMS)).toBe('TV2 PLAY PPV 9')
  })

  it('strips a leading country-code prefix on the provider segment', () => {
    expect(normalizePpvDisplayName('NO: Viaplay PPV 4')).toBe('Viaplay PPV 4')
  })

  it('strips a leading country-code prefix given as its own pipe segment', () => {
    expect(normalizePpvDisplayName('Some Event | NO | Viaplay PPV 4', { homeTeam: 'Some', awayTeam: 'Event' })).toBe(
      'Viaplay PPV 4',
    )
  })

  it('handles fancy-Unicode LIVE/quality noise around a provider slot', () => {
    // ᴸᴵⱽᴱ folds to LIVE (modifier-letter glyphs, see fancyUnicode.ts)
    const raw = 'ᴸᴵⱽᴱ | Deportivo vs Elche | DAZN PPV 2'
    expect(normalizePpvDisplayName(raw, TEAMS)).toBe('DAZN PPV 2')
  })

  it('falls back to a restrained placeholder when no provider slot survives', () => {
    const raw = 'LIVE | Deportivo – Elche | Mon 17 Aug 20:55 CEST (NO)'
    expect(normalizePpvDisplayName(raw, TEAMS)).toBe('PPV Event')
  })

  it('falls back to the placeholder for an entirely empty/noise name', () => {
    expect(normalizePpvDisplayName('LIVE | 8K EXCLUSIVE')).toBe('PPV Event')
  })

  it('leaves an ordinary linear channel name untouched', () => {
    expect(normalizePpvDisplayName('Arena Sport 1')).toBe('Arena Sport 1')
  })

  it('does not mangle real branding that happens to contain a quality/marketing-like word', () => {
    expect(normalizePpvDisplayName('TV 2 Sport Premium')).toBe('TV 2 Sport Premium')
    expect(normalizePpvDisplayName('ITV Gold')).toBe('ITV Gold')
  })

  it('preserves legitimate "LIVE" branding that is not a standalone noise segment', () => {
    expect(normalizePpvDisplayName('Sky Sports News LIVE')).toBe('Sky Sports News LIVE')
  })

  // Real-sanitized playlist entries from fixtures/channel-identity/cases.json
  // (the Channel Identity Resolver's own gold dataset) — a category whose
  // label happens to contain the word "PPV" but is actually a normal
  // mislabeled category (a Disney+ VOD bucket, a sports-news channel), not
  // a real one-off event stream. These must pass through unmangled since
  // nothing in them looks like actual noise.
  it('passes real mislabeled-PPV-category channel names through unchanged', () => {
    expect(normalizePpvDisplayName('TV3+')).toBe('TV3+')
    expect(normalizePpvDisplayName('VIAPLAY SPORT NEWS')).toBe('VIAPLAY SPORT NEWS')
    expect(normalizePpvDisplayName('VIAPLAY SPORT')).toBe('VIAPLAY SPORT')
  })

  it('works with no team/event context supplied at all', () => {
    expect(normalizePpvDisplayName('PPV 17')).toBe('PPV 17')
    expect(normalizePpvDisplayName('LIVE | Some Match | DAZN PPV 2')).toBe('DAZN PPV 2')
  })

  it('leaves a plain already-clean PPV name unchanged', () => {
    expect(normalizePpvDisplayName('PPV 17')).toBe('PPV 17')
    expect(normalizePpvDisplayName('Viaplay PPV 4')).toBe('Viaplay PPV 4')
  })
})

describe('getChannelDisplayName', () => {
  it('prefers the canonical Ninety broadcaster name when the group has one', () => {
    const g = group({ canonicalBroadcastName: 'TV 2 Sport Premium', name: 'SE| TV2 Sport Prem 1 UHD' })
    expect(getChannelDisplayName(g)).toBe('TV 2 Sport Premium')
  })

  it('runs the PPV normalizer for a group whose representative channel is PPV-categorized', () => {
    const raw = 'LIVE | Deportivo – Elche | Mon 17 Aug 20:55 CEST (NO) | NO: TV2 PLAY PPV 9'
    const g = group({ name: raw, sourceOptions: [sourceOption(raw, 'NO| PPV')] })
    expect(getChannelDisplayName(g, TEAMS)).toBe('TV2 PLAY PPV 9')
  })

  it('uses the plain merge-time-normalized playlist name for an ordinary linear channel', () => {
    const g = group({ name: 'TV 2 Sport Premium', sourceOptions: [sourceOption('TV 2 Sport Premium', 'NO| Sports')] })
    expect(getChannelDisplayName(g)).toBe('TV 2 Sport Premium')
  })
})
