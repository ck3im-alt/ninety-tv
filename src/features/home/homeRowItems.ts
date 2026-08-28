import type { FeedGroup, HomeFeedItem } from '../../data/sports/homeRanking'
import type { SportEvent } from '../../data/sports/types'

// THE HERO ALREADY SPENT A RECOMMENDATION SLOT.
//
// Home ranks the hero and the feed from the same candidate pool (see
// homeRanking.ts's "two rankings, not one"), so the match the hero picks as
// "what would I most want to put on right now" is very often also the feed's
// first or second card — the screen's two biggest slots showing one fixture
// twice, one directly above the other.
//
// This is a PRESENTATION rule and lives here, not in the ranking: nothing
// about the order changes, one already-ranked element is removed from one
// row. The feed itself (useHomeFeed's HomeFeed.items) stays the complete
// ranked answer, which is what every other consumer — Multiview's event
// picker, the DEV ranking diagnostics — actually wants.
//
// Matched on event id, never on title. Two providers spell the same fixture
// differently ("Man Utd - Liverpool" / "Manchester United vs Liverpool"), so
// a string match would both miss the duplicate it exists to remove and,
// worse, happily remove a genuinely different fixture that shares a name.
// No hero means nothing to exclude.
export function rowItemsExcludingHero(
  items: readonly HomeFeedItem[],
  hero: Pick<SportEvent, 'id'> | null,
): HomeFeedItem[] {
  if (!hero) return [...items]
  return items.filter((item) => item.event.id !== hero.id)
}

// What ONE card in Home's "Live now & coming up" row says about itself.
//
// Pure and separate from the card component because this is the part with
// actual rules in it — which of three states a card is in, and what time
// text goes with it — while the component around it is markup. It is also
// the only place that turns Ninety's product decision "a match that hasn't
// kicked off is never labelled LIVE" into code.
//
// The ORDER of the row is not decided here: it is already fixed by
// data/sports/homeRanking.ts's rankHomeFeed (live, then starting soon, then
// later today), which is where the ranking rules belong. This file only
// decides how each item presents itself.
export type CardStatus =
  // Really in play, per ninety-api's live feed. `clock` is only ever
  // present for real live data — a heuristically-live event (see
  // SportEvent.isLiveHeuristic) has no clock and must never be shown one.
  | { kind: 'live'; clock?: string }
  // Kicks off within the hour. A DISTINCT state from live, deliberately:
  // the match has not started, and saying "LIVE" for a build-up show is a
  // claim the app can't back up. Carries the kickoff time because "starting
  // soon" alone leaves the viewer doing arithmetic.
  | { kind: 'starting-soon'; time: string }
  // On later. Just the kickoff time, as before.
  | { kind: 'time'; time: string }

// SportEvent.timeLabel is already the app-wide formatted kickoff ("Today
// 21:00" / "Sat 21:00" — see mapEvent.ts). Inside Home's row every card is
// today by construction, so the "Today " prefix is pure noise and is
// dropped; the weekday form is left intact for the cards that reach the row
// from a later day (see Home's density expansion, homeFeedDensity.ts, whose
// horizon stops one day short of a week so that weekday can never be
// today's).
export function cardTimeText(event: Pick<SportEvent, 'timeLabel'>): string {
  return event.timeLabel.replace(/^Today /, '')
}

export function eventCardStatus(event: SportEvent, group: FeedGroup): CardStatus {
  if (group === 'live') {
    return { kind: 'live', clock: event.isLiveHeuristic ? undefined : event.liveClock }
  }
  if (group === 'starting-soon') {
    return { kind: 'starting-soon', time: cardTimeText(event) }
  }
  return { kind: 'time', time: cardTimeText(event) }
}

// The badge's text, in the same uppercase voice as the existing LIVE badge
// (which is a literal, not a text-transform). Kept next to the state above
// so the two can't disagree about the separator or the casing.
export function startingSoonLabel(status: Extract<CardStatus, { kind: 'starting-soon' }>): string {
  return status.time ? `STARTING SOON · ${status.time}` : 'STARTING SOON'
}
