import { useEffect, useMemo, useRef, useState } from 'react'
import { FocusContext, useFocusable, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import type { Channel, ChannelSource } from '../../data/channel'
import type { XtreamCredentials, XtreamEpgListing } from '../../data/xtream/types'
import type { ChannelIndex } from '../../data/channelIndex'
import { useBackHandler } from '../../core/platform'
import { preloadPlayerEngine } from '../../core/player'
import { getShortEpg } from '../../data/xtream/xtreamClient'
import { extractStreamId } from '../../data/xtream/extractStreamId'
import { flagSrc } from '../../data/countryCodes'
import { categoryFavoriteKey, sortFavoritesFirst } from './favorites'
import { ListRow } from './ListRow'
import { SearchField } from './SearchField'
import { Breadcrumb } from './Breadcrumb'
import { PreviewPlayer } from './CategoryChannelsScreen'
import { VirtualChannelList } from './VirtualChannelList'
import { useDebouncedValue } from './useDebouncedValue'
import { markPerf, measurePerf } from '../../core/perf/devPerf'
import './BrowseCascadeScreen.css'

// How long focus has to rest on a channel before PreviewCard actually starts
// a stream load — see PreviewCard below. Fast-scrolling past several rows
// in under this window never starts a single stream load. Kept short (not
// the old 250ms) because this is the one number that gates how soon moving
// video actually starts after focus settles — on physical Tizen hardware
// that 250ms read as real, felt latency on top of the stream's own startup
// time.
const PREVIEW_MEDIA_DEBOUNCE_MS = 100
// EPG has no bearing on when video starts, so it can stay lazier — no
// reason to spend the extra network round-trip budget sooner than this.
const PREVIEW_EPG_DEBOUNCE_MS = 250

// Primary Channels browsing screen — Country → Category → Channel →
// Preview, each a column of its own that stays visible once revealed
// (nothing collapses/hides going back), with column proportions that shift
// as more columns come into play. Selecting an entry commits it (turns it
// green) and reveals/populates the next column, but does NOT jump preview
// straight to the first channel — that only appears once a channel itself
// is explicitly selected, matching the three reference states:
//   1 (country+category) → 2 (+channels, none picked yet) → 3 (+preview).
// Replaced the old screen-per-level flow (ChannelsRootScreen →
// CountryCategoriesScreen → CategoryChannelsScreen).

export type CascadeLevel = 'country' | 'category' | 'channel' | 'preview'
type Level = CascadeLevel

const COUNTRY_COL_FOCUS_KEY = 'cascade-countries'
const CATEGORY_COL_FOCUS_KEY = 'cascade-categories'
const CHANNEL_COL_FOCUS_KEY = 'cascade-channels'
const SEARCH_COL_FOCUS_KEY = 'cascade-search-results'
// Filter/Recently Watched/Favorites — the search input itself isn't in this
// region (see SearchField: no on-screen keyboard yet, so it isn't a
// spatial-nav target). Geometry-based nav alone doesn't reliably reach this
// row from the columns below or the top nav above (it's off to the right,
// doesn't horizontally overlap the narrow Countries column), so up/down
// into and out of it is wired explicitly — see the row components' arrow
// handlers below.
const TOOLBAR_FOCUS_KEY = 'cascade-toolbar'
const OTHER = 'Other'

interface Props {
  // Prepared/indexed view of the playlist, built once per playlist
  // generation (see data/channelIndex.ts) — every country/category/channel
  // lookup below reads from this instead of rescanning the full playlist on
  // every focus move. The raw Channel[] itself isn't needed here — every
  // use in this screen goes through the index.
  channelIndex: ChannelIndex
  xtreamCreds: XtreamCredentials | null
  hiddenCountries: Set<string>
  // Composite `${country}::${category}` keys (categoryFavoriteKey) — a
  // category is hidden per-country, not globally, since the same label can
  // mean different things in different countries' lineups.
  hiddenCategories: Set<string>
  favoriteCategories: Set<string>
  onToggleFavoriteCategory: (key: string) => void
  favoriteChannels: Set<string>
  onToggleFavoriteChannel: (channelId: string) => void
  onWatch: (channel: Channel, source: ChannelSource) => void
  onOpenFavorites: () => void
  onOpenRecent: () => void
  onOpenFilter: () => void
  onExit: () => void
  // Lifted to App so the drill-down path (country/category/channel/level)
  // survives navigating away to watch a channel full-screen and coming
  // back — this screen would otherwise reset to the top on remount.
  level: Level
  onLevelChange: (level: Level) => void
  selectedCountry: string | null
  onSelectedCountryChange: (country: string | null) => void
  selectedCategory: string | null
  onSelectedCategoryChange: (category: string | null) => void
  selectedChannel: Channel | null
  onSelectedChannelChange: (channel: Channel | null) => void
}

// Down steps into the Countries column — the toolbar sits above all three
// cascade columns but only lines up horizontally with none of them, so
// default geometry-based nav can't be relied on to land there.
function toolbarArrowPress(direction: string): boolean {
  if (direction === 'down') {
    void setFocus(COUNTRY_COL_FOCUS_KEY)
    return false
  }
  return true
}

function FilterButton({ onOpen }: { onOpen: () => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: onOpen, onArrowPress: toolbarArrowPress })
  return (
    <button ref={ref} className={`filter-btn ${focused ? 'focused' : ''}`} onClick={onOpen} title="Show or hide entire countries or categories from the lists below">
      Filter Countries &amp; Categories
    </button>
  )
}

function BarButton({ label, onSelect }: { label: string; onSelect: () => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: onSelect, onArrowPress: toolbarArrowPress })
  return (
    <button ref={ref} className={`filter-btn ${focused ? 'focused' : ''}`} onClick={onSelect}>
      {label}
    </button>
  )
}

function formatTime(datetime: string): string {
  // Xtream returns "YYYY-MM-DD HH:mm:ss" server-local — just want HH:mm.
  const match = datetime.match(/(\d{2}):(\d{2}):\d{2}$/)
  return match ? `${match[1]}:${match[2]}` : datetime
}

type EpgState = { status: 'idle' | 'loading' | 'unavailable' | 'error'; listings: XtreamEpgListing[] }

// Own EPG fetch (deliberately not sharing CategoryChannelsScreen's
// EpgSection component) since the card layout here — subtitle line +
// "Next N" list, no NOW badge — reads differently from the classic panel.
function usePreviewEpg(source: ChannelSource | undefined, xtreamCreds: XtreamCredentials | null): EpgState {
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

  return state
}

function PreviewCard({
  channel,
  xtreamCreds,
  favorited,
  onToggleFavorite,
  onWatch,
  onFocusPreview,
}: {
  channel: Channel
  xtreamCreds: XtreamCredentials | null
  favorited: boolean
  onToggleFavorite: () => void
  onWatch: (channel: Channel, source: ChannelSource) => void
  onFocusPreview: () => void
}) {
  // DEV-perf: the instant D-pad focus actually lands on a channel — see
  // PreviewPlayer's 'preview:load-start'/'preview:playing' marks for what
  // this gets measured against.
  useEffect(() => {
    markPerf('preview:focus')
  }, [channel.id])

  // `channel` here is already the IMMEDIATE focus target (BrowseCascadeScreen
  // no longer debounces selection itself — see selectChannel below), so the
  // name/actions below track focus with zero delay. Only the expensive parts
  // — starting a stream load, fetching EPG — stay debounced, via these
  // locally-lagged copies, so fast-scrolling still never fires either per
  // row. Media and EPG are debounced separately and by different amounts —
  // only the media debounce gates when moving video actually starts, so
  // it's kept short; EPG has no bearing on that and can stay lazier.
  const debouncedMediaChannel = useDebouncedValue(channel, PREVIEW_MEDIA_DEBOUNCE_MS)
  const isPending = channel.id !== debouncedMediaChannel.id
  const mediaSource = isPending ? undefined : debouncedMediaChannel.sources[0]

  const debouncedEpgChannel = useDebouncedValue(channel, PREVIEW_EPG_DEBOUNCE_MS)
  const isEpgPending = channel.id !== debouncedEpgChannel.id
  const epgSource = isEpgPending ? undefined : debouncedEpgChannel.sources[0]
  const epg = usePreviewEpg(epgSource, xtreamCreds)

  // Watch/Favorite always act on the immediate `channel`/its own first
  // source, never the debounced one — pressing Enter mid-fast-scroll must
  // play what's actually focused right now, not whatever the preview
  // pipeline has caught up to.
  const watchSource = channel.sources[0]
  const { ref: watchRef, focused: watchFocused } = useFocusable({
    onEnterPress: () => watchSource && onWatch(channel, watchSource),
    onFocus: onFocusPreview,
  })
  const { ref: favRef, focused: favFocused } = useFocusable({ onEnterPress: onToggleFavorite, onFocus: onFocusPreview })

  const [now, ...rest] = epg.listings
  const upcoming = rest.slice(0, 3)

  return (
    <aside className="cascade-preview">
      <PreviewPlayer source={mediaSource} />
      <h2 className="preview-name">{channel.name}</h2>
      {!isEpgPending && now && <p className="preview-subtitle">{now.title}</p>}
      {!isEpgPending && epg.status === 'unavailable' && !now && (
        <p className="preview-subtitle muted">No programme guide for this channel.</p>
      )}

      {!isEpgPending && upcoming.length > 0 && (
        <div className="preview-next">
          <h3 className="preview-next-title">Next {upcoming.length}</h3>
          {upcoming.map((entry) => (
            <div key={entry.id} className="preview-next-row">
              <span className="preview-next-time">{formatTime(entry.start)}</span>
              <span className="preview-next-name">{entry.title}</span>
            </div>
          ))}
        </div>
      )}

      <div className="preview-actions">
        <button
          ref={watchRef}
          className={`watch-btn ${watchFocused ? 'focused' : ''}`}
          onClick={() => watchSource && onWatch(channel, watchSource)}
        >
          Watch
        </button>
        <button ref={favRef} className={`fav-btn ${favFocused ? 'focused' : ''} ${favorited ? 'active' : ''}`} onClick={onToggleFavorite}>
          {favorited ? '★ Favorited' : '☆ Add to Favorites'}
        </button>
      </div>
    </aside>
  )
}

export function BrowseCascadeScreen({
  channelIndex,
  xtreamCreds,
  hiddenCountries,
  hiddenCategories,
  favoriteCategories,
  onToggleFavoriteCategory,
  favoriteChannels,
  onToggleFavoriteChannel,
  onWatch,
  onOpenFavorites,
  onOpenRecent,
  onOpenFilter,
  onExit,
  level,
  onLevelChange: setLevel,
  selectedCountry,
  onSelectedCountryChange: setSelectedCountry,
  selectedCategory,
  onSelectedCategoryChange: setSelectedCategory,
  selectedChannel,
  onSelectedChannelChange: setSelectedChannel,
}: Props) {
  // Search is channels-only and global (not scoped to the selected
  // country/category) — a channel name can turn up in several
  // countries/categories at once, so narrowing the country/category lists
  // themselves instead would hide most of the actual matches. While
  // searching, the browsing columns are replaced by a flat results list +
  // preview instead. Kept local (not lifted like the rest) — resetting the
  // search on remount is fine/expected.
  const [query, setQuery] = useState('')

  const isSearching = query.trim() !== ''

  // DEV-perf: companion to App.tsx's markPerf('channels:open-start') fired
  // when the user presses "Channels" — this fires once this screen has
  // actually mounted and rendered.
  useEffect(() => {
    markPerf('channels:open-end')
    measurePerf('channels:open', 'channels:open-start', 'channels:open-end')
  }, [])

  useBackHandler(() => {
    if (isSearching) {
      setQuery('')
      return true
    }
    if (level === 'preview') {
      setLevel('channel')
      return true
    }
    if (level === 'channel') {
      setLevel('category')
      return true
    }
    if (level === 'category') {
      setLevel('country')
      return true
    }
    onExit()
    return true
  })

  // Read by searchResults/channelsInCategory's sortFavoritesFirst calls
  // below, but deliberately NOT a useMemo dependency for either — see
  // those. Updated every render (cheap: one assignment) so the sort always
  // has the latest favorite state available the moment a NEW dataset needs
  // sorting, without favoriteChannels itself being a trigger that resorts
  // an already-open category/search result on every toggle.
  const favoriteChannelsRef = useRef(favoriteChannels)
  favoriteChannelsRef.current = favoriteChannels

  // Search recompute is debounced (~200ms) so fast typing doesn't run a
  // playlist-wide scan per keystroke — but `isSearching` itself (which swaps
  // the whole columns block for the search-results block) stays keyed off
  // the RAW query, so the UI switches to search mode the instant the first
  // character is typed. See ChannelIndex.search — one O(n) pass over
  // precomputed folded names, not a fresh .toLowerCase() per channel.
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const searchDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (searchDebounceTimer.current) clearTimeout(searchDebounceTimer.current)
    searchDebounceTimer.current = setTimeout(() => setDebouncedQuery(query), 200)
    return () => {
      if (searchDebounceTimer.current) clearTimeout(searchDebounceTimer.current)
    }
  }, [query])

  // Favorites-first order is computed once per (channelIndex, query) pair
  // and held fixed after that — favoriteChannels is deliberately not a
  // dependency here (see favoriteChannelsRef above). Toggling a favorite
  // while a search result is open must not re-sort it out from under the
  // user's focus; starting a NEW query still gets a fresh favorites-first
  // order, using whatever is favorited at that moment.
  const searchResults = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    if (!q) return []
    return sortFavoritesFirst(channelIndex.search(q), (c) => favoriteChannelsRef.current.has(c.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelIndex, debouncedQuery])

  // Countries/categories/channels-in-category all read from the prepared
  // ChannelIndex (built once per playlist generation — see
  // data/channelIndex.ts) instead of rescanning the full `channels` array
  // and re-parseCategory-ing every channel on every focus movement. Each of
  // these is now O(k) (k = countries, or categories/channels within ONE
  // country) rather than O(playlist size).
  const countries = useMemo(() => {
    return channelIndex
      .getCountries()
      .filter((c) => !hiddenCountries.has(c.name))
      .sort((a, b) => (a.name === OTHER ? 1 : b.name === OTHER ? -1 : b.count - a.count))
  }, [channelIndex, hiddenCountries])

  // Speculatively warm whichever player-engine chunk (mpegts.js/hls.js) this
  // playlist actually needs, once, as soon as Channels opens — well before
  // the user focuses a channel and PreviewPlayer's real load() needs it.
  // Without this, the FIRST preview of a session pays for fetching/parsing/
  // evaluating that chunk on top of the real stream startup latency, which
  // on physical Tizen hardware is exactly the kind of "why is this slow"
  // gap this whole pass is about closing. Sampled from one real channel's
  // URL (not both engines unconditionally) since an Xtream playlist is
  // effectively all-MPEG-TS or all-HLS, not a mix — see isMpegTsSource's
  // own comment in htmlVideoPlayer.ts.
  useEffect(() => {
    const sampleUrl = channelIndex.getChannelsForCountry(countries[0]?.name ?? '')[0]?.sources[0]?.url
    if (sampleUrl) preloadPlayerEngine(sampleUrl)
    // Deliberately once per playlist generation, not on every countries
    // change (e.g. a Filter toggle) — the engine a playlist needs doesn't
    // change, and re-importing an already-cached module is a no-op anyway,
    // so re-running this would just be redundant, not incorrect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelIndex])

  const { regularCategories, ppvCategories } = useMemo(() => {
    if (!selectedCountry) return { regularCategories: [], ppvCategories: [] }
    const all = channelIndex
      .getCategoriesForCountry(selectedCountry)
      .filter((c) => !hiddenCategories.has(categoryFavoriteKey(selectedCountry, c.label)))
    const sortWithFavorites = (a: { label: string; count: number }, b: { label: string; count: number }) => {
      const aFav = favoriteCategories.has(categoryFavoriteKey(selectedCountry, a.label))
      const bFav = favoriteCategories.has(categoryFavoriteKey(selectedCountry, b.label))
      if (aFav !== bFav) return aFav ? -1 : 1
      return b.count - a.count
    }
    return {
      regularCategories: all.filter((c) => !c.isPpv).sort(sortWithFavorites),
      ppvCategories: all.filter((c) => c.isPpv).sort(sortWithFavorites),
    }
  }, [channelIndex, selectedCountry, hiddenCategories, favoriteCategories])

  // selectedCategory === null means nothing selected yet (-> []);
  // selectedCategory === '' means the country's general/unlabeled bucket —
  // these are deliberately distinct, do not conflate them.
  // Same freeze as searchResults above: favorites-first order is computed
  // once per (channelIndex, country, category) and held fixed — favoriting
  // Viasport 1 while browsing must not send it to the top and push
  // Viasport 2/3/4 down a row underneath the user's remote. Switching
  // category/country still gets a fresh favorites-first order.
  const channelsInCategory = useMemo(() => {
    if (!selectedCountry || selectedCategory === null) return []
    return sortFavoritesFirst(channelIndex.getChannelsForCategory(selectedCountry, selectedCategory), (c) =>
      favoriteChannelsRef.current.has(c.id),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelIndex, selectedCountry, selectedCategory])

  // Previewing (scrolling with arrows) updates the next column's contents
  // immediately, without moving focus/level there — that only happens on
  // Enter (see selectCountry/selectCategory below). Fires on every arrow
  // move through the country/category lists, not just on commit.
  function previewCountry(name: string) {
    if (name === selectedCountry) return
    markPerf('cascade:country-to-category-start')
    setSelectedCategory(null)
    setSelectedChannel(null)
    setSelectedCountry(name)
  }

  function previewCategory(label: string) {
    if (label === selectedCategory) return
    markPerf('cascade:category-to-channel-start')
    setSelectedChannel(null)
    setSelectedCategory(label)
  }

  function selectCountry(name: string) {
    previewCountry(name)
    setLevel('category')
  }

  function selectCategory(label: string) {
    previewCategory(label)
    setLevel('channel')
  }

  // Focus moving to a channel updates the selection — and with it the
  // Preview column's existence, the channel name, and the highlighted row —
  // immediately, not after a debounce. Previously this itself was the
  // debounced step, which meant the Preview column didn't even mount until
  // 250ms after the user stopped scrolling, making perceived latency worse
  // than the actual stream startup time. The expensive part (starting a
  // stream load, fetching EPG) is debounced separately, inside PreviewCard,
  // so fast-scrolling still never fires either of those per row.
  function selectChannel(channel: Channel) {
    setSelectedChannel(channel)
  }

  // Enter on a channel row jumps straight into full-screen playback — no
  // need to land on the preview pane's Watch button first. Matches
  // PreviewCard's own default source choice: whichever source is first.
  function watchChannel(channel: Channel) {
    const source = channel.sources[0]
    if (source) onWatch(channel, source)
  }

  const { ref: toolbarRef, focusKey: toolbarFocusKey } = useFocusable({
    focusKey: TOOLBAR_FOCUS_KEY,
    trackChildren: true,
  })

  // forceFocus: the initial-focus target norigin's setFocus(ROOT_FOCUS_KEY)
  // lands on — without one, arrow keys have nothing to navigate from.
  const { ref: countryColRef, focusKey: countryColFocusKey } = useFocusable({
    focusKey: COUNTRY_COL_FOCUS_KEY,
    trackChildren: true,
    forceFocus: true,
  })
  const { ref: categoryColRef, focusKey: categoryColFocusKey } = useFocusable({
    focusKey: CATEGORY_COL_FOCUS_KEY,
    trackChildren: true,
  })
  const { ref: channelColRef, focusKey: channelColFocusKey } = useFocusable({
    focusKey: CHANNEL_COL_FOCUS_KEY,
    trackChildren: true,
  })
  const { ref: searchColRef, focusKey: searchColFocusKey } = useFocusable({
    focusKey: SEARCH_COL_FOCUS_KEY,
    trackChildren: true,
  })

  // Moving focus to the newly revealed column has to wait for that column's
  // rows to actually be in the DOM — calling setFocus synchronously right
  // after the setState above races the render and can land on a node that's
  // about to be unmounted (or hasn't mounted yet), leaving nothing focused.
  // Declared after the useFocusable calls above: hooks in one component run
  // their effects in declaration order, and this needs the column
  // containers' own registration effects to have already run — otherwise
  // setFocus targets a container that isn't registered yet and lands on
  // nothing usable.
  useEffect(() => {
    if (level === 'country') void setFocus(COUNTRY_COL_FOCUS_KEY)
    else if (level === 'category') void setFocus(CATEGORY_COL_FOCUS_KEY)
    else if (level === 'channel') void setFocus(CHANNEL_COL_FOCUS_KEY)
  }, [level])

  useEffect(() => {
    if (isSearching) void setFocus(SEARCH_COL_FOCUS_KEY)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSearching])

  // A country is always pre-selected once the list loads, so there's
  // something focused/highlighted to navigate from with a remote (or a
  // keyboard standing in for one) instead of landing on an empty screen.
  // Only sets the selection, not the level/focus — the country column
  // keeps keyboard focus so up/down still moves between countries.
  useEffect(() => {
    if (selectedCountry === null && countries.length > 0) {
      setSelectedCountry(countries[0].name)
    }
  }, [countries, selectedCountry, setSelectedCountry])

  // DEV-perf: country-focus -> updated category presentation, and
  // category-focus -> updated channel presentation (§13 instrumentation —
  // these are the two transitions the O(N)->O(k) ChannelIndex rewrite above
  // exists to make cheap).
  useEffect(() => {
    markPerf('cascade:country-to-category-end')
    measurePerf('cascade:country-to-category', 'cascade:country-to-category-start', 'cascade:country-to-category-end')
  }, [regularCategories, ppvCategories])

  useEffect(() => {
    markPerf('cascade:category-to-channel-end')
    measurePerf('cascade:category-to-channel', 'cascade:category-to-channel-start', 'cascade:category-to-channel-end')
  }, [channelsInCategory])

  const colCount = 1 + (selectedCountry ? 1 : 0) + (selectedCategory !== null ? 1 : 0) + (selectedChannel ? 1 : 0)
  const searchColCount = 1 + (selectedChannel ? 1 : 0)

  return (
    <main className="browse-cascade">
      <div className="cascade-header">
        <div>
          <h1 className="cascade-title">Channels</h1>
          <Breadcrumb
            items={[
              'Channels',
              ...(selectedCountry ? [selectedCountry] : []),
              ...(selectedCategory !== null ? [selectedCategory || 'General'] : []),
            ]}
          />
        </div>
      </div>

      <FocusContext.Provider value={toolbarFocusKey}>
        <div ref={toolbarRef} className="cascade-search-row">
          <SearchField value={query} onChange={setQuery} placeholder="Search channels" />
          <FilterButton onOpen={onOpenFilter} />
          <BarButton label="Recently Watched" onSelect={onOpenRecent} />
          <BarButton label="Favorites" onSelect={onOpenFavorites} />
        </div>
      </FocusContext.Provider>

      {isSearching ? (
        <div className="cascade-columns" data-cols={searchColCount}>
          <FocusContext.Provider value={searchColFocusKey}>
            <div ref={searchColRef} className="cascade-col channels">
              <div className="cascade-col-header">
                <span>Channels matching “{query}”</span>
              </div>
              <div className="cascade-list">
                <VirtualChannelList
                  channels={searchResults}
                  favoriteChannels={favoriteChannels}
                  selectedChannelId={selectedChannel?.id}
                  focusKeyPrefix="cascade-search-row"
                  onSelect={watchChannel}
                  onFocusChannel={selectChannel}
                  onToggleFavorite={onToggleFavoriteChannel}
                  emptyMessage={`No channels match "${query}".`}
                />
              </div>
            </div>
          </FocusContext.Provider>

          {selectedChannel && (
            <PreviewCard
              channel={selectedChannel}
              xtreamCreds={xtreamCreds}
              favorited={favoriteChannels.has(selectedChannel.id)}
              onToggleFavorite={() => onToggleFavoriteChannel(selectedChannel.id)}
              onWatch={onWatch}
              onFocusPreview={() => setLevel('preview')}
            />
          )}
        </div>
      ) : (
        <div className="cascade-columns" data-cols={colCount}>
          <FocusContext.Provider value={countryColFocusKey}>
            <div ref={countryColRef} className="cascade-col country">
              <div className="cascade-col-header">
                <span>Countries</span>
              </div>
              <div className="cascade-list">
                {countries.map((country, index) => (
                  <ListRow
                    key={country.name}
                    icon={country.code && flagSrc(country.code) ? <img className="flag-icon" src={flagSrc(country.code)!} alt="" /> : undefined}
                    label={country.name}
                    count={country.count}
                    active={country.name === selectedCountry}
                    onSelect={() => selectCountry(country.name)}
                    onFocus={() => previewCountry(country.name)}
                    onArrowUp={index === 0 ? () => void setFocus(TOOLBAR_FOCUS_KEY) : undefined}
                  />
                ))}
              </div>
            </div>
          </FocusContext.Provider>

          {selectedCountry && (
            <FocusContext.Provider value={categoryColFocusKey}>
              <div ref={categoryColRef} className="cascade-col category">
                <div className="cascade-col-header">
                  <span>Categories</span>
                </div>
                <div className="cascade-list">
                  {regularCategories.map((category, index) => (
                    <ListRow
                      key={category.label || '(general)'}
                      label={category.label || 'General'}
                      count={category.count}
                      active={category.label === selectedCategory}
                      onSelect={() => selectCategory(category.label)}
                      onFocus={() => previewCategory(category.label)}
                      onArrowLeft={() => void setFocus(COUNTRY_COL_FOCUS_KEY)}
                      onArrowUp={index === 0 ? () => void setFocus(TOOLBAR_FOCUS_KEY) : undefined}
                      favorited={favoriteCategories.has(categoryFavoriteKey(selectedCountry, category.label))}
                      onToggleFavorite={() => onToggleFavoriteCategory(categoryFavoriteKey(selectedCountry, category.label))}
                    />
                  ))}
                  {ppvCategories.length > 0 && (
                    <>
                      <h2 className="section-title ppv-title">Pay-Per-View</h2>
                      {ppvCategories.map((category, index) => (
                        <ListRow
                          key={category.label}
                          label={category.label}
                          count={category.count}
                          active={category.label === selectedCategory}
                          onSelect={() => selectCategory(category.label)}
                          onFocus={() => previewCategory(category.label)}
                          onArrowLeft={() => void setFocus(COUNTRY_COL_FOCUS_KEY)}
                          onArrowUp={
                            index === 0 && regularCategories.length === 0 ? () => void setFocus(TOOLBAR_FOCUS_KEY) : undefined
                          }
                          favorited={favoriteCategories.has(categoryFavoriteKey(selectedCountry, category.label))}
                          onToggleFavorite={() => onToggleFavoriteCategory(categoryFavoriteKey(selectedCountry, category.label))}
                        />
                      ))}
                    </>
                  )}
                </div>
              </div>
            </FocusContext.Provider>
          )}

          {selectedCountry && selectedCategory !== null && (
            <FocusContext.Provider value={channelColFocusKey}>
              <div ref={channelColRef} className="cascade-col channels">
                <div className="cascade-col-header">
                  <span>Channels</span>
                </div>
                <div className="cascade-list">
                  <VirtualChannelList
                    channels={channelsInCategory}
                    favoriteChannels={favoriteChannels}
                    selectedChannelId={selectedChannel?.id}
                    focusKeyPrefix="cascade-channel-row"
                    onSelect={watchChannel}
                    onFocusChannel={selectChannel}
                    onToggleFavorite={onToggleFavoriteChannel}
                    onArrowLeft={() => void setFocus(CATEGORY_COL_FOCUS_KEY)}
                    onArrowUpAtTop={() => void setFocus(TOOLBAR_FOCUS_KEY)}
                    emptyMessage="No channels in this category."
                  />
                </div>
              </div>
            </FocusContext.Provider>
          )}

          {selectedChannel && (
            <PreviewCard
              channel={selectedChannel}
              xtreamCreds={xtreamCreds}
              favorited={favoriteChannels.has(selectedChannel.id)}
              onToggleFavorite={() => onToggleFavoriteChannel(selectedChannel.id)}
              onWatch={onWatch}
              onFocusPreview={() => setLevel('preview')}
            />
          )}
        </div>
      )}
    </main>
  )
}
