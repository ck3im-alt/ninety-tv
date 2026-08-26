import type { FeedGroup } from '../../data/sports/homeRanking'
import type { SportEvent } from '../../data/sports/types'

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
// dropped; the weekday form is left intact for the rare card that reaches
// the row from tomorrow (see useHomeFeed's late-evening fallback fetch).
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
