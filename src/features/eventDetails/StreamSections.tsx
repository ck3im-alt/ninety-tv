import { useEffect, useState } from 'react'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { StreamRow } from './StreamRow'
import type { EventStreamOption } from './buildEventStreamOptions'
import type { Channel, ChannelSource } from '../../data/channel'

interface SharedRowProps {
  favoriteChannels: ReadonlySet<string>
  onToggleFavoriteChannel: (channelId: string) => void
  onWatch: (channel: Channel, source: ChannelSource) => void
}

function streamCountLabel(count: number): string {
  if (count === 1) return 'stream'
  return `${count} streams`
}

// The personalized recommendation list — the screen's main event. The #1
// row gets forceFocus (see StreamRow's own comment): once matches are
// ready, this is the initial focus target for the whole screen, not Back.
export function StreamRecommendations({ options, ...shared }: { options: EventStreamOption[] } & SharedRowProps) {
  if (options.length === 0) return null
  return (
    <section className="stream-section">
      <div className="stream-section-header">
        <h2 className="stream-section-title">
          <span className="stream-section-star" aria-hidden="true">
            ☆
          </span>
          Top {streamCountLabel(options.length)} for you
        </h2>
        <span className="stream-section-subtitle">Ranked by quality and your preferred countries</span>
      </div>
      <div className="stream-row-list">
        {options.map((option, index) => (
          <StreamRow key={option.key} option={option} variant="top" primary={index === 0} forceFocus={index === 0} {...shared} />
        ))}
      </div>
    </section>
  )
}

// Remaining trusted (confirmed/likely) matches beyond the top 3 — still
// fully playable, just lighter rows with no rank badge.
export function StreamList({ options, ...shared }: { options: EventStreamOption[] } & SharedRowProps) {
  if (options.length === 0) return null
  return (
    <section className="stream-section">
      <h2 className="stream-section-title-secondary">All other streams</h2>
      <div className="stream-row-list stream-row-list-compact">
        {options.map((option) => (
          <StreamRow key={option.key} option={option} variant="other" {...shared} />
        ))}
      </div>
    </section>
  )
}

// Loose/fuzzy candidates (see streamConfidence.ts) — collapsed by default
// once trusted matches exist (a dozen loose guesses under a confident pick
// is noise), open by default when they're all there is to show. One-way
// expand, same as the old "Show N more channels" toggle it replaces.
export function CandidateStreamList({
  options,
  defaultOpen,
  ...shared
}: { options: EventStreamOption[]; defaultOpen: boolean } & SharedRowProps) {
  const [open, setOpen] = useState(defaultOpen)
  const { ref: toggleRef, focused: toggleFocused } = useFocusable({ onEnterPress: () => setOpen(true) })
  useEffect(() => {
    if (toggleFocused) toggleRef.current?.scrollIntoView({ block: 'nearest' })
  }, [toggleFocused, toggleRef])

  if (options.length === 0) return null
  return (
    <section className="stream-section stream-section-candidates">
      <h2 className="stream-section-title-secondary">Channels that might show it</h2>
      {!open && (
        <button ref={toggleRef} className={`stream-section-toggle ${toggleFocused ? 'focused' : ''}`} onClick={() => setOpen(true)}>
          Show {options.length} channel{options.length === 1 ? '' : 's'} that might also have it
        </button>
      )}
      {open && (
        <div className="stream-row-list stream-row-list-compact">
          {options.map((option) => (
            <StreamRow key={option.key} option={option} variant="candidate" {...shared} />
          ))}
        </div>
      )}
    </section>
  )
}
