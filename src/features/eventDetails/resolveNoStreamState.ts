// WHAT NINETY ACTUALLY KNOWS WHEN IT HAS NO STREAM TO OFFER.
//
// "No TV channel has been reported for this event yet." was one line of
// plain text standing in for three genuinely different situations, and it
// was wrong in two of them. Which one the viewer is in is decided here,
// purely, so the copy can be read in a test rather than inferred from a
// rendered tree.
//
// THE THREE QUESTIONS, KEPT SEPARATE (see broadcastAvailability.ts, which
// makes the same point about the layer below this one):
//
//   Is it on TV anywhere?          the backend's objective verdict
//   Who is showing it?             event.broadcasts, resolved to stations
//   Can THIS viewer play it?       channelMatch, against their own playlist
//
// A fixture can be CONFIRMED_BROADCAST, have three named broadcasters, and
// still be unplayable here because none of them are in this playlist. That
// is not "no TV channel reported"; it is the opposite, and it is the state
// the viewer most needs told apart from the others — it is the one where
// Ninety knows something useful and used to say nothing.
import { isNegativeBroadcastAvailability, type BroadcastAvailability } from '../../data/sports/broadcastAvailability'
import type { BroadcastStationInfo } from '../../data/sports/channelMatch'

export type NoStreamStateKind =
  // Ninety knows who is showing it; none of those channels could be
  // confidently matched to this playlist.
  | 'known-broadcasters'
  // Nobody has been reported yet, and the backend has not concluded
  // anything either way.
  | 'unknown'
  // The backend's own verdict is that this is not expected on television.
  | 'not-broadcast'

export interface NoStreamStateModel {
  kind: NoStreamStateKind
  title: string
  body: string
  // Whether "Refresh playlist" is an honest offer. FALSE for
  // 'not-broadcast': there is no channel to find, and inviting the viewer
  // to keep refreshing for one would be a lie the screen cannot back up.
  //
  // There is deliberately no "why this can happen" explainer alongside it.
  // A first pass carried three lines of possible causes under the actions;
  // reviewed on the TV they read as a wall of hedging under a screen that
  // has already said the useful part in one sentence, and none of the three
  // changed what the viewer would do next. The two actions ARE the answer
  // to "why" — try a refresh, or go and look.
  offersRefresh: boolean
  // The canonical broadcasters, for 'known-broadcasters' only. INFORMATION,
  // never stream candidates: these are precisely the ones that did NOT
  // produce a trusted match.
  stations: readonly BroadcastStationInfo[]
}

// Only used when the backend's own wording is short enough to read from a
// sofa and reads as a sentence rather than a diagnostic. Anything longer, or
// anything that looks like an identifier (SCREAMING_SNAKE verdicts, ids,
// stack-ish punctuation), is dropped in favour of Ninety's own copy —
// `broadcastAvailabilityReason` is documented as a diagnostic field, and
// piping a diagnostic straight onto a TV screen is how backend vocabulary
// leaks into a product.
const MAX_REASON_LENGTH = 120

export function usableAvailabilityReason(reason: string | undefined): string | null {
  if (!reason) return null
  const trimmed = reason.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_REASON_LENGTH) return null
  if (/^[A-Z0-9_]+$/.test(trimmed)) return null
  if (/[{}<>|\\]|::|_[A-Z]/.test(trimmed)) return null
  return trimmed
}

export function resolveNoStreamState({
  apiStations,
  availability,
  availabilityReason,
}: {
  apiStations: readonly BroadcastStationInfo[]
  availability: BroadcastAvailability
  availabilityReason?: string
}): NoStreamStateModel {
  // STATIONS WIN, whatever the verdict says. If the resolver came back with
  // named broadcasters then the event demonstrably is on television, and the
  // useful thing to show the viewer is who is showing it — not a verdict
  // that disagrees with the evidence sitting next to it.
  if (apiStations.length > 0) {
    return {
      kind: 'known-broadcasters',
      title: 'No matching channel found',
      body: "Ninety found where this event is being shown, but couldn't confidently match those channels to your playlist.",
      offersRefresh: true,
      stations: apiStations,
    }
  }

  if (isNegativeBroadcastAvailability(availability)) {
    return {
      kind: 'not-broadcast',
      title: 'Not expected on TV',
      // The backend's own sentence when it is genuinely product copy,
      // Ninety's when it is not — never the raw field.
      body: usableAvailabilityReason(availabilityReason) ?? 'Ninety has no TV coverage on record for this event.',
      offersRefresh: false,
      stations: [],
    }
  }

  return {
    kind: 'unknown',
    title: 'No TV channel found for this event',
    body: 'Channels often appear closer to the event.',
    offersRefresh: true,
    stations: [],
  }
}

// A station Ninety could see SOME playlist channels for, but not confidently
// enough to call any of them the match (resolver classification AMBIGUOUS —
// see channelIdentityResolver.ts). Those names are worth showing as a hint
// and are never, under any circumstance, promoted to a playable stream: the
// whole point of the AMBIGUOUS tier is that Ninety does not know which of
// them is right, and guessing would put the wrong match behind a Watch
// button. This function only decides whether there is a hint to render.
export function ambiguousPlaylistHints(station: BroadcastStationInfo): readonly string[] {
  if (station.identityClassification !== 'AMBIGUOUS') return []
  return station.ambiguousPlaylistChannelNames ?? []
}
