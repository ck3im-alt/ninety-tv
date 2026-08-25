// Resolves one Multiview pane's assignment (an event, or a plain channel)
// into its selectable candidate list — reusing the exact same
// match/build/rank pipeline as Event Details, not a parallel
// implementation. Mounted once per pane's assignmentId from MultiviewScreen
// (a renderless "resolver" per pane, independent of whether that pane's
// VIDEO subtree is currently mounted or suspended — see MultiviewPane.tsx)
// so resolution work is never redone just because a pane was
// suspended/resumed by maximize.
import { useEffect } from 'react'
import { matchChannelsForEvent } from '../../data/sports/channelMatch'
import { buildEventStreamOptions, partitionStreamOptions, rankEventStreamOptions } from '../eventDetails/buildEventStreamOptions'
import type { StreamRankingPreferences } from '../eventDetails/buildEventStreamOptions'
import { flattenTrustedCandidates, channelToMultiviewCandidates } from './multiviewCandidates'
import type { MultiviewSourceCandidate } from './multiviewCandidates'
import type { MultiviewPane } from './multiviewSession'
import type { SerialQueue } from '../../core/async/serialQueue'
import type { Channel } from '../../data/channel'
import type { XtreamCredentials } from '../../data/xtream/types'
import type { ChannelIdentityIndex } from '../../data/sports/channelIdentityIndex'

export function useMultiviewPaneResolution(
  pane: MultiviewPane,
  channels: Channel[],
  xtreamCreds: XtreamCredentials | null,
  identityIndex: ChannelIdentityIndex | null,
  favoriteChannels: ReadonlySet<string>,
  rankingPreferences: StreamRankingPreferences,
  networkFallbackQueue: SerialQueue,
  // Only ever called with a SETTLED outcome — this hook's own effect starts
  // a pane at 'loading' implicitly (the pane's own initial state, see
  // multiviewSession.ts's freshPane) and never reports that status itself.
  onResolved: (paneId: string, candidates: MultiviewSourceCandidate[], resolution: 'ready' | 'not-found') => void,
): void {
  useEffect(() => {
    let cancelled = false

    if (pane.assignment.kind === 'channel') {
      const candidates = channelToMultiviewCandidates(pane.assignment.channel)
      onResolved(pane.id, candidates, candidates.length > 0 ? 'ready' : 'not-found')
      return
    }

    const event = pane.assignment.event

    async function resolve() {
      // Free/local stages only, first — safe to run for every pane
      // concurrently, same precedent as useHomeFeed's liveNow matching.
      let { matches } = await matchChannelsForEvent(event, channels, xtreamCreds, identityIndex, { allowNetworkFallback: false })
      if (matches.length === 0) {
        // Nothing free found anything — only NOW does this pane need the
        // Xtream EPG network stage, and only one such probe runs at a time
        // across the whole Multiview session (see MultiviewScreen's shared
        // queue instance).
        try {
          const result = await networkFallbackQueue.run(() =>
            matchChannelsForEvent(event, channels, xtreamCreds, identityIndex, { allowNetworkFallback: true }),
          )
          matches = result.matches
        } catch {
          matches = []
        }
      }
      if (cancelled) return

      const options = buildEventStreamOptions(matches, favoriteChannels, {
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        eventTitle: event.title,
        dateTimeUtc: event.dateTimeUtc,
      })
      const partitioned = partitionStreamOptions(rankEventStreamOptions(options, rankingPreferences))
      const candidates = flattenTrustedCandidates(partitioned)
      onResolved(pane.id, candidates, candidates.length > 0 ? 'ready' : 'not-found')
    }

    void resolve()
    return () => {
      cancelled = true
    }
    // Re-resolves only when this pane's assignment actually changes (a real
    // Add/Replace — see multiviewSession.ts's assignmentId) — not on every
    // render, and not because sibling panes/pane count changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.assignmentId])
}
