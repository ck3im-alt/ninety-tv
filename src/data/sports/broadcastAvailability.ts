// IS THIS EVENT EXPECTED TO BE ON TV — ANYWHERE, FOR ANYONE?
//
// An objective fact about the world, decided by ninety-api out of evidence
// the TV cannot see (FotMob broadcaster listings, competition policy, EPG
// coverage across every market it tracks). This file is only the contract:
// the vocabulary, and the one safe way to read it off a payload.
//
// THREE SEPARATE QUESTIONS. This one is the middle one, and merging any two
// of them is the bug this layer exists to prevent:
//
//   1. Does the sporting event exist?           /v1/events returned it
//   2. Is it expected to be broadcast anywhere?  <- THIS FILE
//   3. Can THIS viewer actually play it?         channelMatch.ts, against
//                                                their own playlist
//
// A Champions League tie is CONFIRMED_BROADCAST and can still be unplayable
// for a viewer whose playlist carries none of the channels airing it: the
// match exists, it is televised, this person simply cannot watch it here.
// That is not a negative broadcast status and must never be recorded as one.
//
// AND THE REVERSE, WHICH IS THE EASIER MISTAKE TO MAKE: an empty
// `broadcasts` array says NOTHING about question 2. That array is narrowed
// to the viewer's own markets (see useHomeFeed's `country` parameter) and
// EPG coverage is incomplete in every market — `broadcasts.length === 0` is
// routine for events that are very much on television. The TV therefore
// never infers "not broadcast" for itself; the backend's verdict, and only
// the backend's verdict, answers question 2.
export type BroadcastAvailability =
  | 'CONFIRMED_BROADCAST'
  | 'LIKELY_BROADCAST'
  | 'UNKNOWN'
  | 'LIKELY_NOT_BROADCAST'
  | 'CONFIRMED_NOT_BROADCAST'

const KNOWN_VALUES: ReadonlySet<string> = new Set<BroadcastAvailability>([
  'CONFIRMED_BROADCAST',
  'LIKELY_BROADCAST',
  'UNKNOWN',
  'LIKELY_NOT_BROADCAST',
  'CONFIRMED_NOT_BROADCAST',
])

// THE FALLBACK IS ALWAYS 'UNKNOWN', AND THAT IS THE WHOLE POINT.
//
// Absent (a ninety-api deployment predating this feature — which is exactly
// what a TV running this build talks to until the backend ships), null, or
// a value this build has never heard of (the backend gaining a sixth
// classification before the TV is rebuilt) all resolve the same way: we do
// not know. Never a negative. A missing field must never become a false
// "this isn't on TV", because that is indistinguishable, from the viewer's
// side, from Ninety having lost the match.
export function normalizeBroadcastAvailability(value: unknown): BroadcastAvailability {
  return typeof value === 'string' && KNOWN_VALUES.has(value) ? (value as BroadcastAvailability) : 'UNKNOWN'
}

// Reads the status off an already-mapped event. Events from TheSportsDB
// (F1) never carry one at all — there is no broadcast-availability evidence
// for them anywhere — so they read as UNKNOWN and are treated exactly as
// they always have been.
export function broadcastAvailabilityOf(event: { broadcastAvailability?: BroadcastAvailability | null }): BroadcastAvailability {
  return normalizeBroadcastAvailability(event.broadcastAvailability)
}

// The two verdicts that mean "do not spend watch-oriented effort on this".
// Named rather than inlined so the negative set is defined once — every
// Home rule below (feed, hero, channel matching) keys off this same line,
// and a future sixth value cannot silently land on the wrong side of it.
export function isNegativeBroadcastAvailability(availability: BroadcastAvailability): boolean {
  return availability === 'LIKELY_NOT_BROADCAST' || availability === 'CONFIRMED_NOT_BROADCAST'
}
