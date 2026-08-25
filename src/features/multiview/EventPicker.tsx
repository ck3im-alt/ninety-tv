// TV-friendly "+ Add event" picker — reuses Home's already-fetched feed
// (liveNow/tonight, see useHomeFeed.ts — zero new fetching) and its own
// card components, rather than a parallel implementation. Events first
// (live, grouped by competition, then today's upcoming); a small Channels
// tab covers the "let the user pick a raw channel" allowance, kept
// intentionally minimal per the feature spec's own Channels de-scoping.
import { useMemo, useState } from 'react'
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useModalFocusScope, useFocusScrollIntoView } from '../../core/platform'
import { LiveNowCard, ComingUpCard } from '../home/HomeScreen'
import type { HomeFeed } from '../../data/sports/useHomeFeed'
import type { SportEvent } from '../../data/sports/types'
import type { Channel } from '../../data/channel'
import './EventPicker.css'

const POPUP_FOCUS_KEY = 'event-picker'
const CLOSE_FOCUS_KEY = 'event-picker-close'

type Tab = 'events' | 'channels'

function groupByCompetition(events: SportEvent[]): { league: string; events: SportEvent[] }[] {
  const order: string[] = []
  const groups = new Map<string, SportEvent[]>()
  for (const event of events) {
    const key = event.league || event.sportLabel
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key)!.push(event)
  }
  return order.map((league) => ({ league, events: groups.get(league)! }))
}

function TabButton({ focusKey, label, active, onSelect }: { focusKey: string; label: string; active: boolean; onSelect: () => void }) {
  const { ref, focused } = useFocusable({ focusKey, onEnterPress: onSelect })
  return (
    <button ref={ref} className={`event-picker-tab ${active ? 'active' : ''} ${focused ? 'focused' : ''}`} onClick={onSelect}>
      {label}
    </button>
  )
}

function ChannelRow({ channel, onSelect }: { channel: Channel; onSelect: () => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: onSelect })
  useFocusScrollIntoView(ref, focused)
  return (
    <div ref={ref} className={`event-picker-channel-row ${focused ? 'focused' : ''}`} onClick={onSelect}>
      {channel.logo && <img className="event-picker-channel-logo" src={channel.logo} alt="" />}
      <span className="event-picker-channel-name">{channel.name}</span>
    </div>
  )
}

export interface EventPickerProps {
  feed: HomeFeed
  favoriteChannels: Channel[]
  recentChannels: Channel[]
  onSelectEvent: (event: SportEvent) => void
  onSelectChannel: (channel: Channel) => void
  onClose: () => void
}

export function EventPicker({ feed, favoriteChannels, recentChannels, onSelectEvent, onSelectChannel, onClose }: EventPickerProps) {
  const [tab, setTab] = useState<Tab>('events')
  const liveGroups = useMemo(() => groupByCompetition(feed.liveNow), [feed.liveNow])
  // Capped — this is a quick-add picker, not a full fixtures browser (Event
  // Details / Competitions already cover that in depth).
  const today = feed.tonight.slice(0, 20)
  const channels = useMemo(() => {
    const seen = new Set<string>()
    const merged: Channel[] = []
    for (const channel of [...favoriteChannels, ...recentChannels]) {
      if (seen.has(channel.id)) continue
      seen.add(channel.id)
      merged.push(channel)
    }
    return merged
  }, [favoriteChannels, recentChannels])

  const { ref, focusKey } = useModalFocusScope({
    focusKey: POPUP_FOCUS_KEY,
    onClose,
    preferredChildFocusKey: CLOSE_FOCUS_KEY,
  })
  const { ref: closeRef, focused: closeFocused } = useFocusable({ focusKey: CLOSE_FOCUS_KEY, onEnterPress: onClose })

  return (
    <div className="event-picker-overlay" onClick={onClose}>
      <FocusContext.Provider value={focusKey}>
        <div ref={ref} className="event-picker" onClick={(e) => e.stopPropagation()}>
          <div className="event-picker-header">
            <h2 className="event-picker-title">Add to Multiview</h2>
            <button ref={closeRef} className={`event-picker-close ${closeFocused ? 'focused' : ''}`} onClick={onClose}>
              ✕
            </button>
          </div>

          <div className="event-picker-tabs">
            <TabButton focusKey="event-picker-tab-events" label="Events" active={tab === 'events'} onSelect={() => setTab('events')} />
            <TabButton
              focusKey="event-picker-tab-channels"
              label="Channels"
              active={tab === 'channels'}
              onSelect={() => setTab('channels')}
            />
          </div>

          <div className="event-picker-body">
            {tab === 'events' ? (
              <>
                {liveGroups.length === 0 && today.length === 0 && <p className="event-picker-empty">Nothing live or upcoming right now.</p>}
                {liveGroups.map((group) => (
                  <section key={group.league} className="event-picker-section">
                    <h3 className="event-picker-section-title">
                      {group.league} <span className="event-picker-live-tag">LIVE</span>
                    </h3>
                    <div className="event-picker-grid">
                      {group.events.map((event) => (
                        <LiveNowCard key={event.id} event={event} onSelect={onSelectEvent} />
                      ))}
                    </div>
                  </section>
                ))}
                {today.length > 0 && (
                  <section className="event-picker-section">
                    <h3 className="event-picker-section-title">Today</h3>
                    <div className="event-picker-grid">
                      {today.map((event) => (
                        <ComingUpCard key={event.id} event={event} onSelect={onSelectEvent} />
                      ))}
                    </div>
                  </section>
                )}
              </>
            ) : (
              <section className="event-picker-section">
                {channels.length === 0 ? (
                  <p className="event-picker-empty">Favorite or recently-watched channels will show up here.</p>
                ) : (
                  <div className="event-picker-channel-list">
                    {channels.map((channel) => (
                      <ChannelRow key={channel.id} channel={channel} onSelect={() => onSelectChannel(channel)} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </FocusContext.Provider>
    </div>
  )
}
