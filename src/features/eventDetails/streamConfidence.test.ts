import { describe, expect, it } from 'vitest'
import { confidenceRank, matchConfidence } from './streamConfidence'
import type { ChannelMatch } from '../../data/sports/channelMatch'
import type { Channel } from '../../data/channel'

const channel: Channel = { id: 'ch-1', name: 'Channel', sources: [] }

function match(overrides: Partial<ChannelMatch>): ChannelMatch {
  return { channel, source: 'broadcasterMap', label: 'Channel', isExactMatch: false, ...overrides }
}

describe('matchConfidence', () => {
  it('is confirmed for any exact-identity match, regardless of source', () => {
    expect(matchConfidence(match({ source: 'ninety', isExactMatch: true, identityClassification: 'CONFIRMED' }))).toBe(
      'confirmed',
    )
    expect(matchConfidence(match({ source: 'broadcasterMap', isExactMatch: true }))).toBe('confirmed')
  })

  it('is likely for a Ninety STRONG match', () => {
    expect(matchConfidence(match({ source: 'ninety', isExactMatch: false, identityClassification: 'STRONG' }))).toBe(
      'likely',
    )
  })

  it('is likely for a PPV name match', () => {
    expect(matchConfidence(match({ source: 'ppvName', isExactMatch: false }))).toBe('likely')
  })

  it('is likely for a primary-stage EPG match', () => {
    expect(matchConfidence(match({ source: 'epg', isExactMatch: false }))).toBe('likely')
  })

  it('is candidate for a widened last-resort EPG match', () => {
    expect(matchConfidence(match({ source: 'epg', isExactMatch: false, isWeakEpgMatch: true }))).toBe('candidate')
  })

  it('is candidate for a loose (non-exact) broadcaster-map match', () => {
    expect(matchConfidence(match({ source: 'broadcasterMap', isExactMatch: false }))).toBe('candidate')
  })
})

describe('confidenceRank', () => {
  it('orders confirmed > likely > candidate', () => {
    expect(confidenceRank('confirmed')).toBeGreaterThan(confidenceRank('likely'))
    expect(confidenceRank('likely')).toBeGreaterThan(confidenceRank('candidate'))
  })
})
