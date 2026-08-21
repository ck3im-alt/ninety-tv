import { describe, expect, it } from 'vitest'
import {
  normalizePpvDisplayName,
  getChannelDisplayName,
  extractProviderIdentity,
  extractRawStreamStartTime,
  buildEventStreamDisplayParts,
  formatEventStreamDisplayLine,
} from './ppvDisplayName'
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

  it('composes the contextual event-stream identity when canonical event context is available (Part L-U of the redesign task)', () => {
    const raw = 'LIVE | Deportivo – Elche | Mon 17 Aug 20:55 CEST (NO) | NO: TV2 PLAY PPV 9'
    const g = group({ name: raw, sourceOptions: [sourceOption(raw, 'NO| PPV')] })
    // startTime comes from the RAW stream's own advertised time ("20:55"),
    // not a canonical dateTimeUtc (TEAMS has none) -- see the PPV stream
    // time-source correction. Quality is omitted here too (Event Details
    // renders quality via its own pills, see StreamRow.tsx / Part X).
    expect(getChannelDisplayName(g, TEAMS)).toBe('TV2 PLAY | Deportivo - Elche | 20:55')
  })

  it('falls back to the plain normalized PPV name when no event context is supplied at all', () => {
    const raw = 'LIVE | Deportivo – Elche | Mon 17 Aug 20:55 CEST (NO) | NO: TV2 PLAY PPV 9'
    const g = group({ name: raw, sourceOptions: [sourceOption(raw, 'NO| PPV')] })
    expect(getChannelDisplayName(g)).toBe('TV2 PLAY PPV 9')
  })

  it('uses the plain merge-time-normalized playlist name for an ordinary linear channel', () => {
    const g = group({ name: 'TV 2 Sport Premium', sourceOptions: [sourceOption('TV 2 Sport Premium', 'NO| Sports')] })
    expect(getChannelDisplayName(g)).toBe('TV 2 Sport Premium')
  })
})

// PPV stream time-source correction (2026-08-21): the stream's own
// advertised start time is extracted as literal text, never parsed into a
// Date/reformatted through a timezone conversion -- a PPV stream commonly
// starts before the fixture's real kickoff (pre-match studio coverage), so
// its own advertised time is genuinely different, useful information.
describe('extractRawStreamStartTime', () => {
  it('extracts every real-world shape named explicitly', () => {
    expect(extractRawStreamStartTime('Fri 21 Aug 20:00 CEST (NO)')).toBe('20:00')
    expect(extractRawStreamStartTime('20:00')).toBe('20:00')
    expect(extractRawStreamStartTime('20.00')).toBe('20:00')
    expect(extractRawStreamStartTime('8:00 PM')).toBe('20:00')
    expect(extractRawStreamStartTime('20:00 CEST')).toBe('20:00')
    expect(extractRawStreamStartTime('21/08 20:00')).toBe('20:00')
    expect(extractRawStreamStartTime('Fri 21 Aug 20:00')).toBe('20:00')
  })

  it('converts 12-hour AM/PM to 24-hour correctly at the boundaries', () => {
    expect(extractRawStreamStartTime('12:00 AM')).toBe('00:00') // midnight
    expect(extractRawStreamStartTime('12:00 PM')).toBe('12:00') // noon
    expect(extractRawStreamStartTime('12:30 PM')).toBe('12:30')
    expect(extractRawStreamStartTime('1:00 AM')).toBe('01:00')
  })

  it('never mistakes a DD.MM(.YYYY) date for an H.MM time (dot-format ambiguity)', () => {
    expect(extractRawStreamStartTime('20.08.2026')).toBeNull()
    expect(extractRawStreamStartTime('NEXT | Arsenal - Coventry | 20.08.2026 | NO: VIAPLAY PPV 15')).toBeNull()
  })

  it('prefers a colon-time over a coincidental dot-shaped date fragment in the same string', () => {
    // The date "20.08.2026" is present but must be ignored in favor of the
    // real colon-separated time.
    expect(extractRawStreamStartTime('20.08.2026 20:00')).toBe('20:00')
  })

  it('does not extract a time from a string with none at all', () => {
    expect(extractRawStreamStartTime('VIAPLAY PPV 15')).toBeNull()
    expect(extractRawStreamStartTime('NO: TV2 PLAY PPV 9')).toBeNull()
    expect(extractRawStreamStartTime('DAZN PPV 2')).toBeNull()
  })

  it('does not mistake a quality tag or channel number for a time', () => {
    expect(extractRawStreamStartTime('8K EXCLUSIVE')).toBeNull()
    expect(extractRawStreamStartTime('Sky Sports 1')).toBeNull()
    expect(extractRawStreamStartTime('ESPN 2')).toBeNull()
  })
})

// Part R of the redesign task: strips a disposable event-slot number
// ("PPV 15") from an already-cleaned provider name, but ONLY that specific
// pattern -- never a legitimate channel number.
describe('extractProviderIdentity', () => {
  it('strips PPV/EVENT/FEED slot numbers in every real corpus shape found', () => {
    expect(extractProviderIdentity('NO: VIAPLAY PPV 15')).toBe('VIAPLAY')
    expect(extractProviderIdentity('Viaplay PPV 4')).toBe('Viaplay')
    expect(extractProviderIdentity('NO | Viaplay PPV 4', { eventTitle: 'x' })).toBe('Viaplay')
    expect(extractProviderIdentity('DAZN PPV 2')).toBe('DAZN')
    expect(extractProviderIdentity('TV2 PLAY PPV 9')).toBe('TV2 PLAY')
    expect(extractProviderIdentity('Viaplay PPV-12')).toBe('Viaplay')
    expect(extractProviderIdentity('Viaplay PPV #12')).toBe('Viaplay')
    expect(extractProviderIdentity('Viaplay EVENT 15')).toBe('Viaplay')
    expect(extractProviderIdentity('Viaplay FEED 15')).toBe('Viaplay')
  })

  it('never touches a legitimate channel identity that merely ends in a number', () => {
    expect(extractProviderIdentity('TV 2')).toBe('TV 2')
    expect(extractProviderIdentity('TV 2 Sport')).toBe('TV 2 Sport')
    expect(extractProviderIdentity('TV 2 Sport Premium')).toBe('TV 2 Sport Premium')
    expect(extractProviderIdentity('Sky Sports 1')).toBe('Sky Sports 1')
    expect(extractProviderIdentity('ESPN 2')).toBe('ESPN 2')
    expect(extractProviderIdentity('beIN SPORTS 3')).toBe('beIN SPORTS 3')
    expect(extractProviderIdentity('ITV Gold')).toBe('ITV Gold')
    expect(extractProviderIdentity('Sky Sports News LIVE')).toBe('Sky Sports News LIVE')
  })

  it('returns null when nothing usable survives normalization', () => {
    expect(extractProviderIdentity('LIVE | Deportivo – Elche | Mon 17 Aug 20:55 CEST (NO)', TEAMS)).toBeNull()
  })

  it('returns the cleaned name unchanged if stripping the slot pattern would leave nothing (bare "PPV 17")', () => {
    expect(extractProviderIdentity('PPV 17')).toBe('PPV 17')
  })
})

// Part N/O/P/Q/R of the redesign task: composes the structured contextual
// identity from canonical event data + provider extraction + an
// externally-supplied quality label (never computed here -- one source of
// truth per Part Q, see rankStreamQuality.ts).
describe('buildEventStreamDisplayParts + formatEventStreamDisplayLine', () => {
  it('the exact regression example: NEXT | PREMIER LEAGUE ARSENAL - COVENTRY | ... | NO: VIAPLAY PPV 15', () => {
    const raw = 'NEXT | PREMIER LEAGUE ARSENAL - COVENTRY | Fri 21 Aug 20:00 CEST (NO) | 8K EXCLUSIVE | NO: VIAPLAY PPV 15'
    // Canonical fixture kickoff is deliberately a DIFFERENT hour (21:00 UTC
    // rendered locally) than the raw stream's own advertised time (20:00) --
    // real user report, 2026-08-21: the PPV stream includes pre-match studio
    // coverage starting an hour before kickoff, and the displayed stream
    // time must reflect THAT, not the fixture kickoff.
    const context = { homeTeam: 'Arsenal', awayTeam: 'Coventry', dateTimeUtc: '2026-08-21T19:00:00.000Z' }
    const parts = buildEventStreamDisplayParts(raw, context, '8K')
    expect(parts.provider).toBe('VIAPLAY')
    expect(parts.eventTitle).toBe('Arsenal - Coventry')
    expect(parts.quality).toBe('8K')
    // The raw stream's own advertised time ("20:00"), NOT the canonical
    // kickoff -- no date, time-only.
    expect(parts.startTime).toBe('20:00')

    const line = formatEventStreamDisplayLine(parts)
    expect(line).not.toContain('PPV 15')
    expect(line).not.toContain(raw)
    expect(line).toBe('VIAPLAY | Arsenal - Coventry | 20:00 | 8K')
  })

  it('falls back to the canonical kickoff time-of-day (still no date) when the raw name has no extractable time at all', () => {
    const parts = buildEventStreamDisplayParts('NO: VIAPLAY PPV 15', { homeTeam: 'Arsenal', awayTeam: 'Coventry', dateTimeUtc: '2026-08-21T19:00:00.000Z' }, '8K')
    // No raw time in "NO: VIAPLAY PPV 15" -- falls back to the canonical
    // kickoff's own time-of-day, still time-only (no date segment).
    expect(parts.startTime).toMatch(/^\d{2}:\d{2}$/)
  })

  it('never lets a canonical fixture kickoff overwrite a real advertised raw stream time, even when they differ', () => {
    const raw = 'NEXT | ARSENAL - COVENTRY | Fri 21 Aug 20:00 CEST (NO) | NO: VIAPLAY PPV 15'
    // Kickoff is 21:00 UTC; raw stream says 20:00 -- they must NOT match,
    // proving this test actually exercises the divergence, not a coincidence.
    const context = { homeTeam: 'Arsenal', awayTeam: 'Coventry', dateTimeUtc: '2026-08-21T21:00:00.000Z' }
    const parts = buildEventStreamDisplayParts(raw, context, null)
    expect(parts.startTime).toBe('20:00')
  })

  it('F1/non-football events use context.eventTitle, not homeTeam/awayTeam', () => {
    const raw = 'NEXT | F1 MONACO GRAND PRIX | Sun 25 May 14:00 CEST (NO) | 4K | NO: VIAPLAY PPV 3'
    const context = { eventTitle: 'Monaco Grand Prix', dateTimeUtc: '2026-05-25T12:00:00.000Z' }
    const parts = buildEventStreamDisplayParts(raw, context, '4K')
    expect(parts.eventTitle).toBe('Monaco Grand Prix')
    expect(parts.provider).toBe('VIAPLAY')
    const line = formatEventStreamDisplayLine(parts)
    expect(line).toContain('Monaco Grand Prix')
    expect(line).toContain('VIAPLAY')
  })

  it('omits the start-time segment when no dateTimeUtc is available -- never fabricated', () => {
    const parts = buildEventStreamDisplayParts('DAZN PPV 2', { homeTeam: 'A', awayTeam: 'B' }, null)
    expect(parts.startTime).toBeNull()
    expect(formatEventStreamDisplayLine(parts)).toBe('DAZN | A - B')
  })

  it('omits the quality segment when none is known -- never invents a tier', () => {
    const parts = buildEventStreamDisplayParts('DAZN PPV 2', { homeTeam: 'A', awayTeam: 'B' }, null)
    expect(parts.quality).toBeNull()
    expect(formatEventStreamDisplayLine(parts)).not.toContain('null')
    expect(formatEventStreamDisplayLine(parts)).not.toContain('undefined')
  })

  it('omits the event-title segment when there are no teams and no event title', () => {
    const parts = buildEventStreamDisplayParts('DAZN PPV 2', undefined, null)
    expect(parts.eventTitle).toBeNull()
    expect(parts.provider).toBeNull() // extractProviderIdentity itself requires a context per its own contract
  })

  it('never produces a malformed "| | |" string for missing/incomplete metadata', () => {
    const parts = buildEventStreamDisplayParts('', {}, null)
    const line = formatEventStreamDisplayLine(parts)
    expect(line).not.toMatch(/\|\s*\|/)
    expect(line).toBe('')
  })

  it('handles every recognized quality tier passed through unchanged', () => {
    for (const quality of ['8K', 'UHD', '1080p', '720p', 'SD']) {
      const parts = buildEventStreamDisplayParts('DAZN PPV 2', { homeTeam: 'A', awayTeam: 'B' }, quality)
      expect(formatEventStreamDisplayLine(parts).endsWith(`| ${quality}`)).toBe(true)
    }
  })
})
