// Which of the three empty states the viewer is in, and what it is allowed
// to claim. The screen's rendering is covered in
// EventDetailsScreen.noStream.test.tsx; this is the decision itself.
import { describe, expect, it } from 'vitest'
import { ambiguousPlaylistHints, resolveNoStreamState, usableAvailabilityReason } from './resolveNoStreamState'
import type { BroadcastStationInfo } from '../../data/sports/channelMatch'

const station = (over: Partial<BroadcastStationInfo> = {}): BroadcastStationInfo => ({
  name: 'TNT Sports 1',
  country: 'GB',
  logicalChannelId: 'gb_tnt_sports_1',
  ...over,
})

describe('resolveNoStreamState', () => {
  it('says the broadcasters are known when ninety-api named any', () => {
    const state = resolveNoStreamState({ apiStations: [station()], availability: 'UNKNOWN' })
    expect(state.kind).toBe('known-broadcasters')
    expect(state.title).toBe('No matching channel found')
    expect(state.stations).toHaveLength(1)
    expect(state.offersRefresh).toBe(true)
  })

  // THE DISTINCTION THE OLD ONE-LINER ERASED: "nobody has told us" and "we
  // know exactly who, we just cannot find them in your playlist" are
  // different facts, and only one of them is the viewer's problem to act on.
  it('does not confuse a known broadcaster with no data at all', () => {
    const known = resolveNoStreamState({ apiStations: [station()], availability: 'UNKNOWN' })
    const unknown = resolveNoStreamState({ apiStations: [], availability: 'UNKNOWN' })
    expect(known.kind).not.toBe(unknown.kind)
    expect(known.title).not.toBe(unknown.title)
  })

  it('falls back to the unknown state when nothing has been reported', () => {
    const state = resolveNoStreamState({ apiStations: [], availability: 'UNKNOWN' })
    expect(state.kind).toBe('unknown')
    expect(state.title).toBe('No TV channel found for this event')
    expect(state.offersRefresh).toBe(true)
    expect(state.stations).toHaveLength(0)
  })

  // AN EMPTY `broadcasts` ARRAY IS NOT A NEGATIVE. It is routine for events
  // that are very much on television (see broadcastAvailability.ts), so the
  // absence of stations alone must never resolve to "not televised".
  it('never infers "not broadcast" from missing broadcasters alone', () => {
    for (const availability of ['UNKNOWN', 'CONFIRMED_BROADCAST', 'LIKELY_BROADCAST'] as const) {
      expect(resolveNoStreamState({ apiStations: [], availability }).kind).toBe('unknown')
    }
  })

  it('tells the truth for a fixture the backend says is not expected on TV', () => {
    for (const availability of ['LIKELY_NOT_BROADCAST', 'CONFIRMED_NOT_BROADCAST'] as const) {
      const state = resolveNoStreamState({ apiStations: [], availability })
      expect(state.kind).toBe('not-broadcast')
      // Refreshing cannot conjure a broadcast that is not happening, so the
      // screen must not suggest it.
      expect(state.offersRefresh).toBe(false)
    }
  })

  // Evidence beats a verdict that disagrees with it: if the resolver came
  // back with named broadcasters then the event demonstrably IS on TV.
  it('prefers named broadcasters over a negative verdict', () => {
    const state = resolveNoStreamState({ apiStations: [station()], availability: 'CONFIRMED_NOT_BROADCAST' })
    expect(state.kind).toBe('known-broadcasters')
  })
})

describe('usableAvailabilityReason — backend text is not product copy', () => {
  it('uses a real sentence', () => {
    expect(usableAvailabilityReason('This competition is not televised in your region.')).toBe(
      'This competition is not televised in your region.',
    )
  })

  it('rejects a bare verdict token', () => {
    expect(usableAvailabilityReason('CONFIRMED_NOT_BROADCAST')).toBeNull()
    expect(usableAvailabilityReason('NO_POLICY_MATCH')).toBeNull()
  })

  it('rejects anything that looks like a diagnostic rather than a sentence', () => {
    expect(usableAvailabilityReason('policy::no_coverage')).toBeNull()
    expect(usableAvailabilityReason('reason={competition_policy}')).toBeNull()
  })

  it('rejects an essay — this is a TV screen', () => {
    expect(usableAvailabilityReason('x'.repeat(200))).toBeNull()
  })

  it('handles absence', () => {
    expect(usableAvailabilityReason(undefined)).toBeNull()
    expect(usableAvailabilityReason('   ')).toBeNull()
  })

  it('is used as the body only when it passes', () => {
    const good = resolveNoStreamState({
      apiStations: [],
      availability: 'CONFIRMED_NOT_BROADCAST',
      availabilityReason: 'No broadcaster holds rights in your region.',
    })
    expect(good.body).toBe('No broadcaster holds rights in your region.')

    const bad = resolveNoStreamState({
      apiStations: [],
      availability: 'CONFIRMED_NOT_BROADCAST',
      availabilityReason: 'CONFIRMED_NOT_BROADCAST',
    })
    expect(bad.body).toBe('Ninety has no TV coverage on record for this event.')
  })
})

describe('ambiguousPlaylistHints', () => {
  it('offers the names behind an AMBIGUOUS classification', () => {
    const s = station({ identityClassification: 'AMBIGUOUS', ambiguousPlaylistChannelNames: ['TNT 1', 'TNT ONE'] })
    expect(ambiguousPlaylistHints(s)).toEqual(['TNT 1', 'TNT ONE'])
  })

  // Every other tier means something different. NONE is "we could not find
  // it at all", and CONFIRMED/STRONG would have produced a real match and
  // never reached this screen — showing playlist names for any of them would
  // be inventing a hint out of nothing.
  it('offers nothing for any other classification', () => {
    expect(ambiguousPlaylistHints(station({ identityClassification: 'NONE' }))).toEqual([])
    expect(ambiguousPlaylistHints(station({ identityClassification: 'CONFIRMED' }))).toEqual([])
    expect(ambiguousPlaylistHints(station())).toEqual([])
  })

  it('tolerates an AMBIGUOUS station with no names attached', () => {
    expect(ambiguousPlaylistHints(station({ identityClassification: 'AMBIGUOUS' }))).toEqual([])
  })
})
