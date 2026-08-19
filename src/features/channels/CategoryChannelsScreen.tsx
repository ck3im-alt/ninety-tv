import { useEffect, useMemo, useRef, useState } from 'react'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import type { Channel, ChannelSource } from '../../data/channel'
import { useBackHandler } from '../../core/platform'
import { createHtmlVideoPlayer } from '../../core/player'
import { getShortEpg } from '../../data/xtream/xtreamClient'
import { extractStreamId } from '../../data/xtream/extractStreamId'
import type { XtreamCredentials, XtreamEpgListing } from '../../data/xtream/types'
import { Breadcrumb } from './Breadcrumb'
import { VirtualChannelList } from './VirtualChannelList'
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

  // Was an unmemoized [...channels].sort(...) directly in the render body —
  // re-cloned/re-sorted on every render (including every debounced preview
  // change), not just when `channels`/`favoriteChannels` actually changed.
  const filtered = useMemo(
    () =>
      [...channels].sort((a, b) => {
        const aFav = favoriteChannels.has(a.id)
        const bFav = favoriteChannels.has(b.id)
        if (aFav !== bFav) return aFav ? -1 : 1
        return 0
      }),
    [channels, favoriteChannels],
  )
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
          <VirtualChannelList
            channels={filtered}
            favoriteChannels={favoriteChannels}
            selectedChannelId={selected?.id}
            focusKeyPrefix="category-channel-row"
            onSelect={(channel) => channel.sources[0] && onWatch(channel, channel.sources[0])}
            onFocusChannel={previewDebounced}
            onToggleFavorite={onToggleFavoriteChannel}
            forceFocusFirst
            emptyMessage={emptyMessage}
          />
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
