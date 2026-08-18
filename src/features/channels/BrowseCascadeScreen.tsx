import { useEffect, useMemo, useRef, useState } from 'react'
import { FocusContext, useFocusable, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import type { Channel, ChannelSource } from '../../data/channel'
import type { XtreamCredentials, XtreamEpgListing } from '../../data/xtream/types'
import { useBackHandler } from '../../core/platform'
import { getShortEpg } from '../../data/xtream/xtreamClient'
import { extractStreamId } from '../../data/xtream/extractStreamId'
import { flagSrc } from '../../data/countryCodes'
import { parseCategory, isPpvCategory } from './parseCategory'
import { categoryFavoriteKey } from './favorites'
import { ListRow } from './ListRow'
import { SearchField } from './SearchField'
import { Breadcrumb } from './Breadcrumb'
import { ChannelRow, PreviewPlayer } from './CategoryChannelsScreen'
import './BrowseCascadeScreen.css'

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
  channels: Channel[]
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
  const source = channel.sources[0]
  const epg = usePreviewEpg(source, xtreamCreds)

  const { ref: watchRef, focused: watchFocused } = useFocusable({
    onEnterPress: () => source && onWatch(channel, source),
    onFocus: onFocusPreview,
  })
  const { ref: favRef, focused: favFocused } = useFocusable({ onEnterPress: onToggleFavorite, onFocus: onFocusPreview })

  const [now, ...rest] = epg.listings
  const upcoming = rest.slice(0, 3)

  return (
    <aside className="cascade-preview">
      <PreviewPlayer source={source} />
      <h2 className="preview-name">{channel.name}</h2>
      {now && <p className="preview-subtitle">{now.title}</p>}
      {epg.status === 'unavailable' && !now && <p className="preview-subtitle muted">No programme guide for this channel.</p>}

      {upcoming.length > 0 && (
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
        <button ref={watchRef} className={`watch-btn ${watchFocused ? 'focused' : ''}`} onClick={() => source && onWatch(channel, source)}>
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
  channels,
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

  const searchResults = useMemo(() => {
    if (!isSearching) return []
    const q = query.toLowerCase()
    return channels
      .filter((c) => c.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const aFav = favoriteChannels.has(a.id)
        const bFav = favoriteChannels.has(b.id)
        if (aFav !== bFav) return aFav ? -1 : 1
        return 0
      })
  }, [channels, isSearching, query, favoriteChannels])

  const countries = useMemo(() => {
    const entries = new Map<string, { code: string | null; count: number }>()
    for (const channel of channels) {
      const { countryName, countryCode } = parseCategory(channel.groupTitle || '')
      const key = countryName ?? OTHER
      const existing = entries.get(key)
      entries.set(key, { code: countryCode, count: (existing?.count ?? 0) + 1 })
    }
    return [...entries.entries()]
      .map(([name, { code, count }]) => ({ name, code, count }))
      .filter((c) => !hiddenCountries.has(c.name))
      .sort((a, b) => (a.name === OTHER ? 1 : b.name === OTHER ? -1 : b.count - a.count))
  }, [channels, hiddenCountries])

  const { regularCategories, ppvCategories } = useMemo(() => {
    if (!selectedCountry) return { regularCategories: [], ppvCategories: [] }
    const counts = new Map<string, number>()
    const ppvLabels = new Set<string>()
    for (const channel of channels) {
      const parsed = parseCategory(channel.groupTitle || '')
      if ((parsed.countryName ?? OTHER) !== selectedCountry) continue
      if (hiddenCategories.has(categoryFavoriteKey(selectedCountry, parsed.mergedLabel))) continue
      counts.set(parsed.mergedLabel, (counts.get(parsed.mergedLabel) ?? 0) + 1)
      if (isPpvCategory(parsed)) ppvLabels.add(parsed.mergedLabel)
    }
    const all = [...counts.entries()].map(([label, count]) => ({ label, count }))
    const sortWithFavorites = (a: { label: string; count: number }, b: { label: string; count: number }) => {
      const aFav = favoriteCategories.has(categoryFavoriteKey(selectedCountry, a.label))
      const bFav = favoriteCategories.has(categoryFavoriteKey(selectedCountry, b.label))
      if (aFav !== bFav) return aFav ? -1 : 1
      return b.count - a.count
    }
    return {
      regularCategories: all.filter((c) => !ppvLabels.has(c.label)).sort(sortWithFavorites),
      ppvCategories: all.filter((c) => ppvLabels.has(c.label)).sort(sortWithFavorites),
    }
  }, [channels, selectedCountry, hiddenCategories, favoriteCategories])

  const channelsInCategory = useMemo(() => {
    if (!selectedCountry || selectedCategory === null) return []
    return channels
      .filter((c) => {
        const parsed = parseCategory(c.groupTitle || '')
        return (parsed.countryName ?? OTHER) === selectedCountry && parsed.mergedLabel === selectedCategory
      })
      .sort((a, b) => {
        const aFav = favoriteChannels.has(a.id)
        const bFav = favoriteChannels.has(b.id)
        if (aFav !== bFav) return aFav ? -1 : 1
        return 0
      })
  }, [channels, selectedCountry, selectedCategory, favoriteChannels])

  // Previewing (scrolling with arrows) updates the next column's contents
  // immediately, without moving focus/level there — that only happens on
  // Enter (see selectCountry/selectCategory below). Fires on every arrow
  // move through the country/category lists, not just on commit.
  function previewCountry(name: string) {
    if (name === selectedCountry) return
    setSelectedCategory(null)
    setSelectedChannel(null)
    setSelectedCountry(name)
  }

  function previewCategory(label: string) {
    if (label === selectedCategory) return
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

  function selectChannel(channel: Channel) {
    setSelectedChannel(channel)
  }

  // Scrolling through the channel list previews live (see selectChannel
  // above), but the preview pane actually loads and plays the stream and
  // fetches its EPG on every change — firing that on every single row
  // passed while fast-scrolling floods the player with stream loads and
  // makes both video and EPG feel slow/laggy. Debounced so the preview
  // only loads once the user actually pauses on a row.
  const previewChannelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function previewChannelDebounced(channel: Channel) {
    if (previewChannelTimer.current) clearTimeout(previewChannelTimer.current)
    previewChannelTimer.current = setTimeout(() => selectChannel(channel), 250)
  }
  useEffect(() => {
    return () => {
      if (previewChannelTimer.current) clearTimeout(previewChannelTimer.current)
    }
  }, [])

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
                {searchResults.map((channel) => (
                  <ChannelRow
                    key={channel.id}
                    channel={channel}
                    active={channel.id === selectedChannel?.id}
                    favorited={favoriteChannels.has(channel.id)}
                    onSelect={() => watchChannel(channel)}
                    onFocus={() => previewChannelDebounced(channel)}
                    onToggleFavorite={() => onToggleFavoriteChannel(channel.id)}
                  />
                ))}
                {searchResults.length === 0 && <p className="empty-state">No channels match “{query}”.</p>}
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
                  {channelsInCategory.map((channel, index) => (
                    <ChannelRow
                      key={channel.id}
                      channel={channel}
                      active={channel.id === selectedChannel?.id}
                      favorited={favoriteChannels.has(channel.id)}
                      onSelect={() => watchChannel(channel)}
                      onFocus={() => previewChannelDebounced(channel)}
                      onArrowLeft={() => void setFocus(CATEGORY_COL_FOCUS_KEY)}
                      onArrowUp={index === 0 ? () => void setFocus(TOOLBAR_FOCUS_KEY) : undefined}
                      onToggleFavorite={() => onToggleFavoriteChannel(channel.id)}
                    />
                  ))}
                  {channelsInCategory.length === 0 && <p className="empty-state">No channels in this category.</p>}
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
