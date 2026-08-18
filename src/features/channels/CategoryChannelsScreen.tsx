import { useEffect, useMemo, useRef, useState } from 'react'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import type { Channel, ChannelSource } from '../../data/channel'
import { useBackHandler } from '../../core/platform'
import { createHtmlVideoPlayer } from '../../core/player'
import { getShortEpg } from '../../data/xtream/xtreamClient'
import { extractStreamId } from '../../data/xtream/extractStreamId'
import type { XtreamCredentials, XtreamEpgListing } from '../../data/xtream/types'
import { Breadcrumb } from './Breadcrumb'
import './CategoryChannelsScreen.css'

interface Props {
  country: string
  category: string // mergedLabel — may be "" (the country's general/unlabeled category)
  channels: Channel[] // already filtered to this country+category by the caller
  xtreamCreds: XtreamCredentials | null
  favoriteChannels: Set<string>
  onToggleFavoriteChannel: (channelId: string) => void
  onWatch: (channel: Channel, source: ChannelSource) => void
  onBack: () => void
  // Overrides the country/category-derived title and breadcrumb — used to
  // reuse this screen for the flat Favorites / Recently Watched lists,
  // which aren't scoped to a single country+category.
  title?: string
  breadcrumb?: string[]
  emptyMessage?: string
}

export function ChannelRow({
  channel,
  active,
  favorited,
  onSelect,
  onToggleFavorite,
  forceFocus,
  onFocus,
  onArrowLeft,
  onArrowUp,
}: {
  channel: Channel
  active: boolean
  favorited: boolean
  onSelect: () => void
  onToggleFavorite: () => void
  // The initial-focus target norigin's setFocus(ROOT_FOCUS_KEY) lands on —
  // set on the first row so arrow keys have something to navigate from.
  forceFocus?: boolean
  // Fires as the row gains keyboard/remote focus (arrow-scrolling), not
  // just on Enter — lets the preview pane show live as you scroll instead
  // of requiring a commit press first.
  onFocus?: () => void
  // Left-arrow steps back to the previous cascade column instead of the
  // default spatial-nav search, which — since this row also nests a
  // focusable favorite star — can otherwise land on that star instead of
  // leaving the column at all.
  onArrowLeft?: () => void
  // Up-arrow from the topmost row steps out to the toolbar above (Filter/
  // Recently Watched/Favorites).
  onArrowUp?: () => void
}) {
  const { ref, focused } = useFocusable({
    onEnterPress: onSelect,
    onFocus,
    forceFocus,
    onArrowPress: (direction) => {
      if (direction === 'left' && onArrowLeft) {
        onArrowLeft()
        return false
      }
      if (direction === 'up' && onArrowUp) {
        onArrowUp()
        return false
      }
      return true
    },
  })
  const { ref: starRef, focused: starFocused } = useFocusable({ onEnterPress: onToggleFavorite })

  // Spatial nav moves focus but never scrolls its container for you.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [focused, ref])

  return (
    <div ref={ref} className={`ch-row ${active ? 'active' : ''} ${focused ? 'focused' : ''}`} onClick={onSelect}>
      <div className="ch-row-logo">
        {channel.logo ? <img src={channel.logo} alt="" /> : <span className="ch-row-logo-fallback">{channel.name.slice(0, 2).toUpperCase()}</span>}
      </div>
      <span className="ch-row-name">{channel.name}</span>
      {channel.sources.length > 1 ? (
        <span className="ch-row-source-count">{channel.sources.length} sources</span>
      ) : (
        channel.sources[0] && <span className="ch-row-source-count">{channel.sources[0].label}</span>
      )}
      <button
        ref={starRef}
        className={`ch-row-favorite ${favorited ? 'active' : ''} ${starFocused ? 'focused' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onToggleFavorite()
        }}
        aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
      >
        {favorited ? '★' : '☆'}
      </button>
    </div>
  )
}

function formatTime(datetime: string): string {
  // Xtream returns "YYYY-MM-DD HH:mm:ss" server-local — just want HH:mm.
  const match = datetime.match(/(\d{2}):(\d{2}):\d{2}$/)
  return match ? `${match[1]}:${match[2]}` : datetime
}

type EpgState = { status: 'idle' | 'loading' | 'unavailable' | 'error'; listings: XtreamEpgListing[] }

export function EpgSection({ source, xtreamCreds }: { source: ChannelSource | undefined; xtreamCreds: XtreamCredentials | null }) {
  const [state, setState] = useState<EpgState>({ status: 'idle', listings: [] })

  useEffect(() => {
    if (!source || !xtreamCreds) {
      setState({ status: 'unavailable', listings: [] })
      return
    }
    const streamId = extractStreamId(source.url)
    if (streamId === null) {
      setState({ status: 'unavailable', listings: [] })
      return
    }
    let cancelled = false
    setState({ status: 'loading', listings: [] })
    getShortEpg(xtreamCreds, streamId, 4)
      .then((listings) => {
        if (!cancelled) setState({ status: listings.length ? 'idle' : 'unavailable', listings })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', listings: [] })
      })
    return () => {
      cancelled = true
    }
  }, [source, xtreamCreds])

  if (state.status === 'unavailable') {
    return <p className="info-note">EPG isn't available for this source (either a plain M3U playlist, or the panel has no schedule data for this channel).</p>
  }
  if (state.status === 'error') return <p className="info-note">Couldn't load EPG for this channel.</p>
  if (state.status === 'loading') return <p className="info-note">Loading programme guide…</p>

  const [now, ...rest] = state.listings
  // This panel never scrolls (TV screen) — capped so "Up Next" can never
  // push the Watch/Favorite buttons out of the fixed-height panel.
  const upcoming = rest.slice(0, 2)

  return (
    <div className="epg-section">
      {now && (
        <div className="epg-now">
          <span className="epg-now-badge">NOW</span>
          <div className="epg-now-info">
            <p className="epg-title">{now.title}</p>
            <p className="epg-time">
              {formatTime(now.start)}–{formatTime(now.end)}
            </p>
          </div>
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="epg-upcoming">
          <h3 className="sources-title">Up Next</h3>
          {upcoming.map((entry) => (
            <div key={entry.id} className="epg-row">
              <span className="epg-row-time">{formatTime(entry.start)}</span>
              <span className="epg-row-title">{entry.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Small muted live preview of whatever channel is currently selected while
// browsing — a separate `Player` instance from the full-screen one in
// ChannelPlayerScreen, torn down/recreated with this screen's lifetime.
export function PreviewPlayer({ source }: { source: ChannelSource | undefined }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const player = useMemo(() => createHtmlVideoPlayer(), [])

  useEffect(() => {
    if (videoRef.current) player.attach(videoRef.current)
    return () => player.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player])

  useEffect(() => {
    if (!source) return
    void player.load(source.url).then(() => player.play())
  }, [source, player])

  return <video ref={videoRef} className="preview-video" muted autoPlay />
}

export function InfoPanel({
  channel,
  xtreamCreds,
  favorited,
  onToggleFavorite,
  onWatch,
}: {
  channel: Channel | null
  xtreamCreds: XtreamCredentials | null
  favorited: boolean
  onToggleFavorite: () => void
  onWatch: (channel: Channel, source: ChannelSource) => void
}) {
  const { ref: watchRef, focused: watchFocused } = useFocusable({
    onEnterPress: () => channel && onWatch(channel, channel.sources[0]),
  })
  const { ref: favRef, focused: favFocused } = useFocusable({ onEnterPress: onToggleFavorite })

  if (!channel) return <aside className="info-panel empty">Select a channel</aside>

  const activeSource = channel.sources[0]

  return (
    <aside className="info-panel">
      <PreviewPlayer source={activeSource} />

      <h2 className="info-name">{channel.name}</h2>

      <EpgSection source={activeSource} xtreamCreds={xtreamCreds} />

      <div className="info-actions">
        <button ref={watchRef} className={`watch-btn ${watchFocused ? 'focused' : ''}`} onClick={() => onWatch(channel, activeSource)}>
          ▶ Watch
        </button>
        <button ref={favRef} className={`fav-btn ${favFocused ? 'focused' : ''} ${favorited ? 'active' : ''}`} onClick={onToggleFavorite}>
          {favorited ? '★ Favorited' : '☆ Add to Favorites'}
        </button>
      </div>
    </aside>
  )
}

export function CategoryChannelsScreen({
  country,
  category,
  channels,
  xtreamCreds,
  favoriteChannels,
  onToggleFavoriteChannel,
  onWatch,
  onBack,
  title: titleOverride,
  breadcrumb,
  emptyMessage,
}: Props) {
  const [selected, setSelected] = useState<Channel | null>(channels[0] ?? null)

  // Scrolling through the list previews live, but the preview pane actually
  // loads and plays the stream and fetches its EPG on every change — firing
  // that on every row passed while fast-scrolling floods the player with
  // stream loads and makes both video and EPG feel slow/laggy. Debounced so
  // the preview only loads once the user actually pauses on a row.
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function previewDebounced(channel: Channel) {
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => setSelected(channel), 250)
  }
  useEffect(() => {
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current)
    }
  }, [])

  useBackHandler(() => {
    onBack()
    return true
  })

  const filtered = [...channels].sort((a, b) => {
    const aFav = favoriteChannels.has(a.id)
    const bFav = favoriteChannels.has(b.id)
    if (aFav !== bFav) return aFav ? -1 : 1
    return 0
  })
  const title = titleOverride ?? (category || 'General')

  return (
    <main className="category-channels">
      <div className="category-header">
        <div>
          <h1 className="category-title">{titleOverride ?? `${title} Channels`}</h1>
          <Breadcrumb items={breadcrumb ?? ['Channels', country, title]} />
        </div>
        <button className="back-link" onClick={onBack}>
          ← Back
        </button>
      </div>
      <div className="split">
        <div className="ch-list">
          {filtered.map((channel, index) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              active={channel.id === selected?.id}
              favorited={favoriteChannels.has(channel.id)}
              onSelect={() => channel.sources[0] && onWatch(channel, channel.sources[0])}
              onFocus={() => previewDebounced(channel)}
              onToggleFavorite={() => onToggleFavoriteChannel(channel.id)}
              forceFocus={index === 0}
            />
          ))}
          {filtered.length === 0 && emptyMessage && <p className="empty-state">{emptyMessage}</p>}
        </div>
        <InfoPanel
          channel={selected}
          xtreamCreds={xtreamCreds}
          favorited={selected ? favoriteChannels.has(selected.id) : false}
          onToggleFavorite={() => selected && onToggleFavoriteChannel(selected.id)}
          onWatch={onWatch}
        />
      </div>
    </main>
  )
}
