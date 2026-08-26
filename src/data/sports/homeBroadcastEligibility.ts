// WHAT HOME DOES WITH THE BACKEND'S BROADCAST VERDICT.
//
// broadcastAvailability.ts answers "is this expected to be on TV anywhere?".
// This file answers the product question that follows from it: given that
// verdict, may the event reach Home's feed, may it become the hero, and is
// it worth spending a local channel lookup on?
//
// Three separate answers, deliberately — they do not move together:
//
//   FEED     "your club is playing tonight" is worth saying even when
//            Ninety cannot offer you a picture.
//   HERO     the hero is what you should put on RIGHT NOW. An event with no
//            expected broadcast is never that, favorite club or not.
//   MATCHING searching the viewer's playlist for a channel airing a match
//            no broadcaster is expected to carry is pure wasted work — a
//            preliminary FA Cup tie should cost zero match attempts.
//
// A GATE, NOT A SCORE. Every rule here is structural. Broadcast
// availability deliberately contributes NOTHING to HOME_WEIGHTS: expressed
// as points, "+100 favorite team" would sooner or later out-argue "this
// match is not televised", which is not a trade-off that makes sense at any
// exchange rate. See homePersonalization.ts's own header for the same
// argument applied to the hero's time window.
//
// The default is always inclusion. Only a verdict the backend actually
// stated can remove anything; absent, null and unrecognized all read as
// UNKNOWN, which behaves exactly as Home behaved before this layer existed
// (see broadcastAvailability.ts). That is what makes shipping this build
// against a backend that does not send the field yet a no-op.
import { broadcastAvailabilityOf, isNegativeBroadcastAvailability, type BroadcastAvailability } from './broadcastAvailability'
import { isFavoriteTeamEvent, type PersonalizationContext } from './homePersonalization'
import type { SportEvent } from './types'

// May this event appear in Home's "Live now & coming up" feed?
//
// CONFIRMED_BROADCAST / LIKELY_BROADCAST / UNKNOWN -> yes.
// LIKELY_NOT_BROADCAST -> only as informational content, and only when one
//   of the viewer's EXPLICIT favorite clubs is playing. A favorited
//   COMPETITION is deliberately not enough: "I follow the FA Cup" cannot be
//   read as "show me every untelevised preliminary tie in it", whereas "my
//   club is playing" is a fact the viewer wants regardless of coverage.
// CONFIRMED_NOT_BROADCAST -> never, favorite or not. Home is watch-oriented;
//   a fixture that definitively is not being broadcast has nothing to offer
//   here, and remains Schedule and Event Details territory (both of which
//   still list it in full — see useTodaysSchedule.ts).
export function isHomeFeedBroadcastEligible(event: SportEvent, context: PersonalizationContext): boolean {
  const availability = broadcastAvailabilityOf(event)
  if (availability === 'CONFIRMED_NOT_BROADCAST') return false
  if (availability === 'LIKELY_NOT_BROADCAST') return isFavoriteTeamEvent(event, context)
  return true
}

// May this event become the Home hero?
//
// Context-free on purpose: the favorite-team exception above buys a place in
// the FEED and nothing more. The hero is the app's single "put this on now"
// recommendation, and pointing it at a match no one is expected to be
// broadcasting is a dead end no amount of personal relevance redeems.
//
// This is the ONLY broadcast rule the hero has. Everything else about hero
// selection — the 60-minute window, live-vs-soon sharing one pool, the
// earliest-kickoff fallback — is untouched by this layer (see homeRanking.ts).
export function isHeroBroadcastEligible(event: SportEvent): boolean {
  return !isNegativeBroadcastAvailability(broadcastAvailabilityOf(event))
}

// Is it worth checking the viewer's own playlist for a channel airing this?
//
// The efficiency half of the feature. Both negative verdicts short-circuit:
// LIKELY_NOT_BROADCAST included, even for a favorite club that IS still
// shown in the feed — that card is informational, so there is nothing for a
// match to unlock, and a "Watch Now" it produced would lead nowhere.
//
// UNKNOWN is emphatically NOT short-circuited. Absence of evidence is not a
// negative verdict, and skipping matching for it would silently make every
// event a not-yet-upgraded backend returns unplayable.
export function isChannelMatchBroadcastEligible(event: SportEvent): boolean {
  return !isNegativeBroadcastAvailability(broadcastAvailabilityOf(event))
}

// All three answers plus the inputs behind them, for the dev-only Home
// diagnostic (see useHomeFeed's __ninetyBroadcastEligibility). Composed from
// the same predicates the real code path calls, never a parallel
// reimplementation that could report a decision Home did not actually make.
export interface HomeBroadcastEligibility {
  availability: BroadcastAvailability
  reason?: string
  isFavoriteTeam: boolean
  feedEligible: boolean
  heroEligible: boolean
  channelMatchingSkipped: boolean
}

export function homeBroadcastEligibility(event: SportEvent, context: PersonalizationContext): HomeBroadcastEligibility {
  return {
    availability: broadcastAvailabilityOf(event),
    reason: event.broadcastAvailabilityReason,
    isFavoriteTeam: isFavoriteTeamEvent(event, context),
    feedEligible: isHomeFeedBroadcastEligible(event, context),
    heroEligible: isHeroBroadcastEligible(event),
    channelMatchingSkipped: !isChannelMatchBroadcastEligible(event),
  }
}
