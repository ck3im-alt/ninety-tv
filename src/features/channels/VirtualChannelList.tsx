// TV-safe list windowing for long channel lists (a category or a search
// result can run into the thousands against a ~30,925-channel playlist).
// Mounting one row per channel means one row per channel's worth of
// simultaneous norigin useFocusable registrations (2 per row — row + star)
// plus a scrollIntoView effect each, which does not scale.
//
// This is a small, TV-specific windowed-slice component, not a general
// virtualization library — D-pad-only navigation (no mouse-drag scrollbar to
// keep proportional) means a plain windowed slice in normal document flow,
// backed by fixed-height spacers to keep scroll geometry stable, is enough.
// Only ~windowSize + 2*overscan rows are ever mounted at once, regardless of
// total list length.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import type { Channel } from '../../data/channel'
import { ChannelRow } from './ChannelRow'
import { planWindowShift } from './virtualWindow'

const DEFAULT_WINDOW_SIZE = 30
const DEFAULT_OVERSCAN = 10
// Used only until the real row stride is measured from the DOM (see
// useLayoutEffect below) — avoids a 0-height flash before the first
// measurement lands. The real CSS row heights (68px/88px) are measured
// directly rather than hardcoded here, so this never needs to track them.
const FALLBACK_ROW_STRIDE = 64

interface VirtualChannelListProps {
  channels: Channel[] // already filtered+sorted by the caller
  favoriteChannels: Set<string>
  selectedChannelId: string | undefined
  focusKeyPrefix: string
  // WHICH LOGICAL LIST this is, as opposed to which array instance.
  //
  // Without it, this component can only tell "the user opened a different
  // category" from "the same category, rebuilt from a newer playlist
  // generation" by comparing array references — and those two situations
  // want opposite behaviour. Switching category must reset to the top;
  // a background playlist refresh must not yank a viewer who is 4,000 rows
  // deep back to row 1 and strand focus on an unmounted key.
  //
  // Callers pass something that identifies the SELECTION (country+category,
  // or the search query), never anything derived from the channel data. Left
  // undefined, this falls back to the original reference-identity behaviour.
  listKey?: string
  windowSize?: number
  overscan?: number
  onSelect: (channel: Channel) => void
  onFocusChannel: (channel: Channel) => void
  onToggleFavorite: (channelId: string) => void
  onArrowLeft?: () => void
  onArrowUpAtTop?: () => void // only absolute-index 0 gets this
  emptyMessage?: string
  forceFocusFirst?: boolean
  // Threaded straight to ChannelRow — see its own doc comment. Defaults true.
  showFavorite?: boolean
}

export function VirtualChannelList({
  channels,
  favoriteChannels,
  selectedChannelId,
  focusKeyPrefix,
  listKey,
  windowSize = DEFAULT_WINDOW_SIZE,
  overscan = DEFAULT_OVERSCAN,
  onSelect,
  onFocusChannel,
  onToggleFavorite,
  onArrowLeft,
  onArrowUpAtTop,
  emptyMessage,
  forceFocusFirst,
  showFavorite = true,
}: VirtualChannelListProps) {
  const [windowStart, setWindowStart] = useState(0)
  const [rowStride, setRowStride] = useState(FALLBACK_ROW_STRIDE)
  // Absolute index -> the row wrapper's DOM element, collected via each
  // wrapper's own callback ref below — used only to measure the real
  // pixel stride between consecutive rows (see the useLayoutEffect below),
  // never to touch focus/DOM directly otherwise.
  const rowElementsRef = useRef<Map<number, HTMLDivElement>>(new Map())
  // The focus KEY the user is conceptually moving toward, plus the absolute
  // index it belongs to; consumed by the effect below once that row has
  // actually mounted in the new window — the same "wait for the row to exist
  // before setFocus" pattern BrowseCascadeScreen's own level-keyed effect
  // uses. A key rather than a bare index because the target may be the row's
  // favourite star rather than the row itself (see the re-anchoring effect).
  const pendingFocusIndexRef = useRef<number | null>(null)
  const pendingFocusKeyRef = useRef<string | null>(null)

  // Reset the window whenever the underlying (already-filtered/sorted) list
  // identity changes, so switching category/search query never leaves a
  // stale window scrolled past the new list's end. Favoriting/unfavoriting
  // a channel while browsing an already-open category/search result no
  // longer changes `channels`' identity at all — the caller freezes that
  // list's order for the life of the dataset (see BrowseCascadeScreen's
  // channelsInCategory/searchResults) — so this effect no longer needs to
  // tell a reorder apart from a real list change; there's no reorder case
  // left to handle here.
  //
  // What it DOES have to tell apart, now that provider playlists refresh in
  // the background, is a genuinely different list from the same list rebuilt
  // for a newer generation. `listKey` answers that (see the prop); when it
  // is unchanged, the window is re-anchored on the channel the viewer was
  // standing on rather than reset, so a refresh that adds a PPV channel four
  // hundred rows above them is invisible.
  const listIdentityRef = useRef<string | undefined>(listKey)
  const selectedChannelIdRef = useRef(selectedChannelId)
  selectedChannelIdRef.current = selectedChannelId
  // Read inside the re-anchoring effect below without making the effect
  // depend on it — the effect must fire on a channels/listKey change only,
  // never because the window happened to move.
  const windowStartRef = useRef(windowStart)
  windowStartRef.current = windowStart
  useEffect(() => {
    const sameLogicalList = listKey !== undefined && listKey === listIdentityRef.current
    listIdentityRef.current = listKey
    rowElementsRef.current.clear()
    if (!sameLogicalList) {
      setWindowStart(0)
      return
    }

    // Same list, new contents. Row focus keys are positional
    // (`${prefix}-${index}`), so an insertion above the viewer would silently
    // move them to a different channel — the anchor has to be re-resolved by
    // channel id, not trusted to stay at the same index.
    const anchorId = selectedChannelIdRef.current
    const anchorIndex = anchorId ? channels.findIndex((c) => c.id === anchorId) : -1
    const mounted = Math.max(1, Math.min(channels.length, windowSize + 2 * overscan))
    const maxStartNow = Math.max(0, channels.length - mounted)
    const prev = Math.max(0, Math.min(windowStartRef.current, maxStartNow))
    if (anchorIndex === -1) {
      // The anchored channel genuinely disappeared — the viewer unfavorited
      // the row they were standing on, or a refresh dropped a PPV channel
      // that had ended.
      //
      // The window STAYS WHERE IT IS (clamped to the shorter list), and this
      // is load-bearing rather than cosmetic. Every caller recovers from a
      // removal by focusing the row that slid into the gap
      // (CategoryChannelsScreen's pickFallbackAfterRemoval effect, which
      // runs AFTER this one because React flushes passive effects
      // child-first). Resetting to row 0 here unmounted exactly the row that
      // effect was about to focus, so setFocus landed on a key with no
      // component behind it — and norigin has nothing to auto-restore from
      // once an explicit setFocus has cancelled its debounced restore.
      // Focus then stayed on that dead key permanently: arrows did nothing
      // and only the hardware Back key still worked. Keeping the window
      // means the neighbour is already mounted and the fallback is a real,
      // focusable row.
      setWindowStart(prev)
      return
    }

    // Already mounted at its new index: leave the window exactly where it is,
    // so nothing scrolls at all.
    const nextStart = anchorIndex >= prev && anchorIndex < prev + mounted ? prev : planWindowShift(anchorIndex, prev, mounted, maxStartNow).start
    setWindowStart(nextStart)

    // Only move focus if focus is actually inside THIS list — a refresh
    // landing while the viewer is on the country rail, the search field or
    // another column must not steal focus into the channel list.
    //
    // Each row owns TWO focusables: the row itself (`${prefix}-${index}`)
    // and its favourite star (`${prefix}-${index}-favorite`, see ChannelRow).
    // Both have to be re-pointed at the anchor's new index, and each has to
    // land back on ITS OWN control — moving a viewer who was on the star to
    // the row would be exactly the disruption this whole effect exists to
    // prevent.
    const current = getCurrentFocusKey()
    if (current == null || !current.startsWith(`${focusKeyPrefix}-`)) return
    const onStar = current.endsWith('-favorite')
    const anchorKey = `${focusKeyPrefix}-${anchorIndex}${onStar ? '-favorite' : ''}`
    if (current === anchorKey) return
    if (nextStart === prev) {
      // The row is mounted right now under a different index, so it can be
      // focused immediately. (Going through pendingFocusKeyRef instead
      // would deadlock: that ref is drained by an effect keyed on the window
      // moving, and the window is not moving.)
      void setFocus(anchorKey)
      return
    }
    pendingFocusIndexRef.current = anchorIndex
    pendingFocusKeyRef.current = anchorKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, listKey])

  const mountedCount = Math.max(1, Math.min(channels.length, windowSize + 2 * overscan))
  const maxStart = Math.max(0, channels.length - mountedCount)
  const clampedStart = Math.max(0, Math.min(windowStart, maxStart))
  const visibleChannels = channels.slice(clampedStart, clampedStart + mountedCount)

  // Measure the real row STRIDE (the distance from one row's top to the
  // next row's top), not just a single row's own height — this correctly
  // captures any CSS gap/margin between rows so spacer heights stay
  // accurate regardless of how the list's CSS is styled, across tens of
  // thousands of rows.
  useLayoutEffect(() => {
    const first = rowElementsRef.current.get(clampedStart)
    const second = rowElementsRef.current.get(clampedStart + 1)
    if (first && second) {
      const stride = second.offsetTop - first.offsetTop
      if (stride > 0) setRowStride(stride)
    }
    // visibleChannels.length (not the array itself) is enough to notice a
    // remeasure-worthy render — clampedStart alone would miss the very
    // first measurement, since it's already 0 on mount.
  }, [clampedStart, visibleChannels.length])

  useEffect(() => {
    const pending = pendingFocusIndexRef.current
    if (pending === null) return
    if (pending >= clampedStart && pending < clampedStart + mountedCount) {
      void setFocus(pendingFocusKeyRef.current ?? `${focusKeyPrefix}-${pending}`)
      pendingFocusIndexRef.current = null
      pendingFocusKeyRef.current = null
    }
  }, [clampedStart, mountedCount, focusKeyPrefix])

  // Re-centers the mounted window around `centerIndex` (advancing by a
  // chunk, not by one row at a time) so a fresh overscan buffer exists again
  // on both sides after the shift — this is what keeps rapid repeated D-pad
  // presses from outrunning React's ability to mount the next window: most
  // such presses land on already-mounted overscan rows and never trigger a
  // shift at all.
  function shiftWindow(centerIndex: number) {
    const { start, shifted } = planWindowShift(centerIndex, windowStart, mountedCount, maxStart)
    if (!shifted) {
      // No window movement means setWindowStart below would be a same-value
      // no-op React bails out of re-rendering for, so the effect that
      // normally calls setFocus() once a shifted window mounts would never
      // fire — the row the user is trying to reach would silently eat the
      // keypress instead of moving focus (the physical-Samsung "can't
      // scroll down through Favorites/Recently Watched" report — those
      // lists are almost always smaller than windowSize+2*overscan=50, so
      // the window never needs to move at all). planWindowShift guarantees
      // centerIndex is already inside the mounted range whenever shifted is
      // false, so focusing it directly here is always valid.
      void setFocus(`${focusKeyPrefix}-${centerIndex}`)
      return
    }
    pendingFocusIndexRef.current = centerIndex
    pendingFocusKeyRef.current = null
    setWindowStart(start)
  }

  if (channels.length === 0) {
    return emptyMessage ? <p className="empty-state">{emptyMessage}</p> : null
  }

  const topSpacerHeight = rowStride * clampedStart
  const bottomSpacerHeight = rowStride * Math.max(0, channels.length - clampedStart - mountedCount)

  return (
    <>
      {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight, flexShrink: 0 }} aria-hidden="true" />}
      {visibleChannels.map((channel, offset) => {
        const absoluteIndex = clampedStart + offset
        const isFirstOverall = absoluteIndex === 0
        const isLastOverall = absoluteIndex === channels.length - 1
        // Trigger a shift once focus moves into the outer overscan band on
        // either side (not only at the true mounted edge) — see shiftWindow
        // above for why this early trigger matters for rapid-press
        // stability. Rows in the middle of the mounted range get no
        // handler at all, so norigin's own geometry search moves focus to
        // the physically-adjacent already-mounted row exactly as it does
        // for the smaller Country/Category columns today.
        const nearTop = !isFirstOverall && absoluteIndex < clampedStart + overscan
        const nearBottom = !isLastOverall && absoluteIndex >= clampedStart + mountedCount - overscan
        return (
          <div
            // The ABSOLUTE INDEX is part of the React key, not just the
            // channel id, because this row's spatial-navigation identity is
            // positional (`${focusKeyPrefix}-${absoluteIndex}`) and norigin
            // registers that identity in a mount-only effect
            // (`addFocusable` runs with a `[]` dependency list). A row whose
            // focusKey PROP changes while the component instance survives
            // therefore stays registered under its old key — and norigin's
            // `updateFocusable` then writes this row's node and handlers
            // into whichever component already owns the new key, without
            // updating that entry's `onUpdateFocus`. The result was a
            // highlight drawn on one row while OK played the row above it.
            //
            // Reconciling by id alone was safe while `channels` only changed
            // when the viewer switched category (which resets the window and
            // remounts everything anyway). It stopped being safe when
            // provider playlists began refreshing in the background: a
            // generation that adds or drops a single PPV channel above the
            // viewer shifts every index below it. Keying on the index makes
            // such a shift a remount, which re-registers every row under the
            // key it actually renders with. Rows are cheap and stateless, and
            // at most windowSize + 2*overscan of them exist.
            key={`${absoluteIndex}:${channel.id}`}
            ref={(el) => {
              if (el) rowElementsRef.current.set(absoluteIndex, el)
              else rowElementsRef.current.delete(absoluteIndex)
            }}
          >
            <ChannelRow
              focusKey={`${focusKeyPrefix}-${absoluteIndex}`}
              channel={channel}
              active={channel.id === selectedChannelId}
              favorited={favoriteChannels.has(channel.id)}
              onSelect={() => onSelect(channel)}
              onFocus={() => onFocusChannel(channel)}
              onToggleFavorite={() => onToggleFavorite(channel.id)}
              forceFocus={forceFocusFirst && absoluteIndex === 0}
              onArrowLeft={onArrowLeft}
              onArrowUp={isFirstOverall ? onArrowUpAtTop : nearTop ? () => shiftWindow(absoluteIndex - 1) : undefined}
              onArrowDown={nearBottom ? () => shiftWindow(absoluteIndex + 1) : undefined}
              showFavorite={showFavorite}
            />
          </div>
        )
      })}
      {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight, flexShrink: 0 }} aria-hidden="true" />}
    </>
  )
}
