import { useEffect, useMemo, useRef, useState } from 'react'
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import type { Channel, ChannelSource } from '../../data/channel'
import { useBackHandler, useFocusScrollIntoView, pickFallbackAfterRemoval } from '../../core/platform'
import { createHtmlVideoPlayer } from '../../core/player'
import { getShortEpg } from '../../data/xtream/xtreamClient'
import { extractStreamId } from '../../data/xtream/extractStreamId'
import type { XtreamCredentials, XtreamEpgListing } from '../../data/xtream/types'
import { Breadcrumb } from './Breadcrumb'
import { VirtualChannelList } from './VirtualChannelList'
import { useDebouncedValue } from './useDebouncedValue'
import { markPerf, measurePerf } from '../../core/perf/devPerf'
import './CategoryChannelsScreen.css'

// How long focus has to rest on a channel before the actual stream load
// fires — see PreviewPlayer/InfoPanel below. Fast-scrolling past several
// rows in under this window never starts a single stream load. Kept short
// (not the old 250ms) because this is the one number that gates how soon
// moving video actually starts after focus settles — on physical Tizen
// hardware that 250ms read as real, felt latency on top of the stream's
// own startup time.
const PREVIEW_MEDIA_DEBOUNCE_MS = 100
// EPG has no bearing on when video starts, so it can stay lazier — no
// reason to spend the extra network round-trip budget sooner than this.
const PREVIEW_EPG_DEBOUNCE_MS = 250

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
//
// Rendered inside a fixed-16:9 `.preview-video-frame` wrapper rather than
// sizing the `<video>` itself off `aspect-ratio` + intrinsic dimensions —
// a replaced element's intrinsic size is only known once its metadata
// loads, so sizing straight off the video caused the whole preview panel to
// visibly resize the instant playback actually started. The frame's size is
// fixed by CSS alone (see BrowseCascadeScreen.css / CategoryChannelsScreen
// .css), so it never moves regardless of the video's own load state.
//
// `source` undefined covers two distinct callers' cases the same way —
// deliberately: a channel with no playable source at all, and (via
// PreviewCard/InfoPanel below) a focus change still waiting out its preview
// debounce — both mean "nothing to actually show right now", so both get
// the same opaque loading cover rather than leaving whatever the frame
// happened to be showing before visible underneath (which, for the
// debounce case, would be the PREVIOUS channel's live picture under the
// newly-focused channel's name — misleading).
export function PreviewPlayer({ source }: { source: ChannelSource | undefined }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const player = useMemo(() => createHtmlVideoPlayer(), [])

  useEffect(() => {
    if (videoRef.current) player.attach(videoRef.current)
    return () => player.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player])

  // DEV-perf: 'preview:focus' is marked by PreviewCard/InfoPanel the instant
  // D-pad focus lands on a channel (see those components) — measuring from
  // there to here captures the real, physically-noticed "why hasn't the
  // picture changed yet" latency: focus-settle debounce + engine dynamic
  // import + stream startup, not just the debounce in isolation.
  useEffect(() => {
    if (!source) return
    markPerf('preview:load-start')
    measurePerf('preview:focus-to-load', 'preview:focus', 'preview:load-start')
    void player.load(source.url).then(() => player.play())
  }, [source, player])

  useEffect(() => {
    return player.subscribe((state) => {
      if (state.status !== 'playing') return
      markPerf('preview:playing')
      measurePerf('preview:load-to-playing', 'preview:load-start', 'preview:playing')
      measurePerf('preview:focus-to-playing', 'preview:focus', 'preview:playing')
    })
  }, [player])

  return (
    <div className="preview-video-frame">
      <video ref={videoRef} className="preview-video" muted autoPlay />
      {!source && <div className="preview-video-loading" aria-hidden="true" />}
    </div>
  )
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
  // `focusable: channel != null` — when nothing is selected (an empty
  // Favorites/Recently Watched list), the early return below never renders
  // these buttons at all, but the useFocusable HOOK CALL still runs
  // (Rules of Hooks) with `ref.current` forever null. Without this guard
  // that registered a real, invisible, zero-geometry spatial-nav target at
  // the origin — the exact "registers focusable actions with no DOM
  // target" bug this whole pass is about eliminating.
  const { ref: watchRef, focused: watchFocused } = useFocusable({
    focusable: channel != null,
    onEnterPress: () => channel && onWatch(channel, channel.sources[0]),
  })
  const { ref: favRef, focused: favFocused } = useFocusable({ focusable: channel != null, onEnterPress: onToggleFavorite })

  // DEV-perf: the instant D-pad focus actually lands on a channel — see
  // PreviewPlayer's 'preview:load-start'/'preview:playing' marks for what
  // this gets measured against.
  useEffect(() => {
    markPerf('preview:focus')
  }, [channel?.id])

  // `channel` itself (name, Watch/Favorite target) tracks focus immediately
  // — only the expensive parts (stream load, EPG fetch) lag behind via
  // these debounced copies, so fast-scrolling never starts either per row.
  // Compared by id, not reference — `channel` is only null while nothing in
  // the list is focused yet (see CategoryChannelsScreen's initial state),
  // which never happens once the list has rows.
  //
  // Media and EPG are debounced separately and by different amounts: only
  // the media debounce gates when moving video actually starts, so it's
  // kept short; EPG has no bearing on that and can stay lazier.
  const debouncedMediaChannel = useDebouncedValue(channel, PREVIEW_MEDIA_DEBOUNCE_MS)
  const isMediaPending = channel?.id !== debouncedMediaChannel?.id
  const mediaSource = isMediaPending ? undefined : debouncedMediaChannel?.sources[0]

  const debouncedEpgChannel = useDebouncedValue(channel, PREVIEW_EPG_DEBOUNCE_MS)
  const isEpgPending = channel?.id !== debouncedEpgChannel?.id
  const epgSource = isEpgPending ? undefined : debouncedEpgChannel?.sources[0]

  if (!channel) return <aside className="info-panel empty">Select a channel</aside>

  const activeSource = channel.sources[0]

  return (
    <aside className="info-panel">
      <PreviewPlayer source={mediaSource} />

      <h2 className="info-name">{channel.name}</h2>

      {!isEpgPending && <EpgSection source={epgSource} xtreamCreds={xtreamCreds} />}

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

const BACK_FOCUS_KEY = 'category-channels-back'

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

  const { ref: screenRef, focusKey: screenFocusKey } = useFocusable({
    focusKey: 'category-channels-screen',
    trackChildren: true,
  })

  // Selection itself updates immediately on every focus move — it drives
  // the channel name and Watch/Favorite actions in InfoPanel, which must
  // track focus instantly, not lag behind a debounce. The expensive part
  // (starting a stream load, fetching EPG) is debounced separately, inside
  // InfoPanel/PreviewPlayer, so fast-scrolling still doesn't fire either of
  // those per row.
  function onFocusChannel(channel: Channel) {
    setSelected(channel)
  }

  // Removing the currently-focused/selected channel out from under the
  // user — e.g. unfavoriting it from THIS Favorites screen — unmounts its
  // row. Fall back to whatever slid into its place, or the previous row if
  // it was last, or Back if the list is now empty entirely. Without this,
  // `selected` (and spatial focus) kept pointing at a channel no longer in
  // `channels`, which either froze arrow navigation (dead focus key) or, at
  // best, left InfoPanel showing a channel that no longer has a row.
  const prevChannelsRef = useRef(channels)
  useEffect(() => {
    if (selected && !channels.some((c) => c.id === selected.id)) {
      const previousIndex = prevChannelsRef.current.findIndex((c) => c.id === selected.id)
      const fallback = previousIndex === -1 ? null : pickFallbackAfterRemoval(previousIndex, channels)
      setSelected(fallback?.item ?? null)
      void setFocus(fallback ? `category-channel-row-${fallback.index}` : BACK_FOCUS_KEY)
    }
    prevChannelsRef.current = channels
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels])

  useBackHandler(() => {
    onBack()
    return true
  })

  const { ref: backRef, focused: backFocused } = useFocusable({
    focusKey: BACK_FOCUS_KEY,
    // Deterministic initial target for an empty list (see the header
    // requirement: remote navigation must never start dead) — VirtualChannelList
    // renders no focusable rows at all when `channels` is empty, so Back
    // would otherwise be the only thing on screen but not actually focused.
    forceFocus: channels.length === 0,
    onEnterPress: onBack,
  })
  useFocusScrollIntoView(backRef, backFocused)

  const title = titleOverride ?? (category || 'General')

  return (
    <FocusContext.Provider value={screenFocusKey}>
      <main ref={screenRef} className="category-channels">
        <div className="category-header">
          <div>
            <h1 className="category-title">{titleOverride ?? `${title} Channels`}</h1>
            <Breadcrumb items={breadcrumb ?? ['Channels', country, title]} />
          </div>
          <button ref={backRef} className={`back-link ${backFocused ? 'focused' : ''}`} onClick={onBack}>
            ← Back
          </button>
        </div>
        <div className="split">
          <div className="ch-list">
            <VirtualChannelList
              channels={channels}
              favoriteChannels={favoriteChannels}
              selectedChannelId={selected?.id}
              focusKeyPrefix="category-channel-row"
              onSelect={(channel) => channel.sources[0] && onWatch(channel, channel.sources[0])}
              onFocusChannel={onFocusChannel}
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
    </FocusContext.Provider>
  )
}
