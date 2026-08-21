import { useEffect, useMemo, useRef, useState } from 'react'
import { FocusContext, useFocusable, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { createHtmlVideoPlayer } from '../../core/player'
import type { PlayerState, SubtitleTrack } from '../../core/player'
import type { ChannelSource } from '../../data/channel'
import { useBackHandler, useFocusScrollIntoView, useModalFocusScope } from '../../core/platform'
import type { Channel } from '../../data/channel'
import { estimateQualityTier, qualityTierLabel } from '../eventDetails/rankStreamQuality'
import { formatEventStreamDisplayLine } from '../eventDetails/ppvDisplayName'
import type { EventStreamDisplayParts } from '../eventDetails/ppvDisplayName'
import './ChannelPlayerScreen.css'

interface Props {
  channels: Channel[]
  initialSourceLabel?: string
  // Contextual event-stream display identity from Event Details' StreamRow
  // (see App.tsx's watchChannel) — undefined for every other watch path
  // (Home, Browse, Favorites, Recent), which keep today's exact
  // selected?.name behavior untouched. See Part V/W of the redesign task.
  initialDisplayParts?: EventStreamDisplayParts
  onBack: () => void
}

const OVERLAY_FOCUS_KEY = 'player-overlay'
const TOOLBAR_FOCUS_KEY = 'player-toolbar'
const SOURCE_TOGGLE_FOCUS_KEY = 'player-source-toggle'
const SUBTITLES_TOGGLE_FOCUS_KEY = 'player-subtitles-toggle'
const SOURCE_POPUP_FOCUS_KEY = 'player-source-popup'
const SUBTITLES_POPUP_FOCUS_KEY = 'player-subtitles-popup'
const OVERLAY_IDLE_MS = 6000

function sourceIndexFor(channel: Channel | null, label?: string): number {
  if (!channel || !label) return 0
  const index = channel.sources.findIndex((s) => s.label === label)
  return index === -1 ? 0 : index
}

// Only compares the fields this screen actually reads in its JSX — status,
// error (code/message), muted, subtitleTracks, activeSubtitleTrack.
// Deliberately excludes currentTime/duration: fixing this at the shared
// PlayerState type (or splitting playback telemetry out of it) would touch
// a contract documented as staying stable for a future Tizen AVPlay
// implementation, for no benefit today — this is the only PlayerState
// subscriber in the app (PreviewPlayer, the other createHtmlVideoPlayer()
// consumer, never subscribes to state at all).
function playerUiStateEqual(a: PlayerState, b: PlayerState): boolean {
  if (a === b) return true
  if (a.status !== b.status) return false
  if (a.muted !== b.muted) return false
  if (a.activeSubtitleTrack !== b.activeSubtitleTrack) return false
  if ((a.error?.code ?? null) !== (b.error?.code ?? null)) return false
  if ((a.error?.message ?? null) !== (b.error?.message ?? null)) return false
  if (a.subtitleTracks.length !== b.subtitleTracks.length) return false
  for (let i = 0; i < a.subtitleTracks.length; i++) {
    if (a.subtitleTracks[i].id !== b.subtitleTracks[i].id) return false
    if (a.subtitleTracks[i].label !== b.subtitleTracks[i].label) return false
  }
  return true
}

function ToolbarButton({
  focusKey,
  icon,
  label,
  onSelect,
  active = false,
}: {
  focusKey?: string
  icon: string
  label: string
  onSelect: () => void
  active?: boolean
}) {
  const { ref, focused } = useFocusable({ focusKey, onEnterPress: onSelect })
  return (
    <button ref={ref} className={`toolbar-btn ${focused ? 'focused' : ''} ${active ? 'active' : ''}`} onClick={onSelect}>
      <span className="toolbar-btn-icon">{icon}</span>
      <span className="toolbar-btn-label">{label}</span>
    </button>
  )
}

function OptionRow({
  focusKey,
  chip,
  label,
  active,
  onSelect,
}: {
  focusKey?: string
  chip: string
  label: string
  active: boolean
  onSelect: () => void
}) {
  const { ref, focused } = useFocusable({ focusKey, onEnterPress: onSelect })
  useFocusScrollIntoView(ref, focused)
  return (
    <div ref={ref} className={`option-row ${focused ? 'focused' : ''}`} onClick={onSelect}>
      <span className="option-row-chip">{chip}</span>
      <span className="option-row-label">{label}</span>
      {active && <span className="option-row-check">✓</span>}
    </div>
  )
}

// Extracted into its own component (not inline JSX in the toolbar, as it
// used to be) specifically so it only MOUNTS while actually open — the
// inline version called useFocusable() unconditionally in
// ChannelPlayerScreen's own body, which meant this container was always a
// registered focusable component (with a null DOM node while closed) even
// when never rendered. useModalFocusScope's capture/restore lifecycle also
// depends on a real mount/unmount boundary to fire at the right time.
function SourcePopup({
  sources,
  sourceIndex,
  onSelectSource,
  onClose,
}: {
  sources: ChannelSource[]
  sourceIndex: number
  onSelectSource: (index: number) => void
  onClose: () => void
}) {
  // Focus the currently selected source if it exists, otherwise the first
  // one — never just "the popup container" (which would fall back to
  // norigin's geometry-based child search rather than the deliberate
  // choice this popup actually wants).
  const preferredChildFocusKey = sources[sourceIndex] ? `player-source-option-${sourceIndex}` : sources[0] ? 'player-source-option-0' : undefined
  const { ref, focusKey } = useModalFocusScope({ focusKey: SOURCE_POPUP_FOCUS_KEY, onClose, preferredChildFocusKey })
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="options-popup">
        <div className="options-group">
          {sources.length > 0 ? (
            sources.map((source, index) => (
              <OptionRow
                key={source.label + index}
                focusKey={`player-source-option-${index}`}
                chip={source.label}
                label={source.label}
                active={index === sourceIndex}
                onSelect={() => onSelectSource(index)}
              />
            ))
          ) : (
            <p className="options-empty">No sources available for this channel.</p>
          )}
        </div>
      </div>
    </FocusContext.Provider>
  )
}

function SubtitlesPopup({
  tracks,
  activeTrack,
  onSelectTrack,
  onClose,
}: {
  tracks: SubtitleTrack[]
  activeTrack: string | null
  onSelectTrack: (id: string | null) => void
  onClose: () => void
}) {
  const preferredChildFocusKey = activeTrack === null ? 'player-subtitle-option-off' : `player-subtitle-option-${activeTrack}`
  const { ref, focusKey } = useModalFocusScope({ focusKey: SUBTITLES_POPUP_FOCUS_KEY, onClose, preferredChildFocusKey })
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="options-popup">
        <div className="options-group">
          {tracks.length > 0 ? (
            <>
              <OptionRow focusKey="player-subtitle-option-off" chip="OFF" label="Off" active={activeTrack === null} onSelect={() => onSelectTrack(null)} />
              {tracks.map((track) => (
                <OptionRow
                  key={track.id}
                  focusKey={`player-subtitle-option-${track.id}`}
                  chip="CC"
                  label={track.label}
                  active={activeTrack === track.id}
                  onSelect={() => onSelectTrack(track.id)}
                />
              ))}
            </>
          ) : (
            <p className="options-empty">No subtitles available for this channel — the stream doesn't declare any subtitle track.</p>
          )}
        </div>
      </div>
    </FocusContext.Provider>
  )
}

export function ChannelPlayerScreen({ channels, initialSourceLabel, initialDisplayParts, onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const player = useMemo(() => createHtmlVideoPlayer(), [])
  const [selected] = useState<Channel | null>(channels[0] ?? null)
  const [sourceIndex, setSourceIndex] = useState(() => sourceIndexFor(channels[0] ?? null, initialSourceLabel))
  const [playerState, setPlayerState] = useState<PlayerState>(player.getState())
  const [menuVisible, setMenuVisible] = useState(false)
  const [sourcePopupOpen, setSourcePopupOpen] = useState(false)
  const [subtitlesPopupOpen, setSubtitlesPopupOpen] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Whether the user has explicitly muted playback via the toolbar — once
  // set, the auto-unmute-on-interaction effect below backs off and leaves
  // the choice to them.
  const userMutedRef = useRef(false)
  // Autoplay policy (browser + Tizen) only allows audible playback after a
  // real user gesture, which is why the <video> starts `muted`. This tracks
  // whether such a gesture has happened yet so we know it's safe to unmute.
  // Starts true, not false: this screen only ever mounts as the direct
  // result of an explicit Enter/click on a channel (see watchChannel() in
  // App.tsx) — that gesture already happened, just on the PREVIOUS screen,
  // before this component (and the keydown/pointerdown listener below)
  // existed to observe it. Waiting for a second, redundant press here was
  // exactly why full-screen playback stayed muted until the user did
  // something after arriving.
  const hasInteractedRef = useRef(true)

  const { ref: overlayRef, focusKey: overlayFocusKey } = useFocusable({ focusKey: OVERLAY_FOCUS_KEY, trackChildren: true })
  const { ref: toolbarRef, focusKey: toolbarFocusKey } = useFocusable({ focusKey: TOOLBAR_FOCUS_KEY, trackChildren: true })

  const closePopups = () => {
    setSourcePopupOpen(false)
    setSubtitlesPopupOpen(false)
  }

  // Single source of truth for "hide the OSD" — the idle timeout used to
  // have its OWN inline copy of this (setMenuVisible + closePopups, with NO
  // focus handling at all) instead of calling this function, which is how
  // an idle timeout firing while a Source/Subtitle OptionRow had focus
  // could leave spatial focus pointing at a component that had just been
  // removed (both the option AND its popup unmount together, so there was
  // nothing left for the library's own autoRestoreFocus safety net to land
  // on either). Landing on TOOLBAR_FOCUS_KEY here (a real, always-mounted
  // — see the pre-focus effect below — anchor) instead of the previous
  // ROOT_FOCUS_KEY also fixes a second bug: ROOT_FOCUS_KEY resolution only
  // ever considers currently-mounted forceFocus components, and nothing on
  // this screen uses forceFocus, so that call was silently a no-op.
  function hideMenu() {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    setMenuVisible(false)
    closePopups()
    void setFocus(TOOLBAR_FOCUS_KEY)
  }

  function scheduleIdleHide() {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(hideMenu, OVERLAY_IDLE_MS)
  }

  function showMenu() {
    setMenuVisible(true)
    scheduleIdleHide()
  }

  function closeSourcePopup() {
    setSourcePopupOpen(false)
    // Keeps the overlay open and gives the user the full window again —
    // without this, closing a popup via Back could leave a much shorter
    // (or already-expired) idle window than a fresh interaction should get.
    scheduleIdleHide()
  }

  function closeSubtitlesPopup() {
    setSubtitlesPopupOpen(false)
    scheduleIdleHide()
  }

  // Unlike every other screen here, nothing on this one uses forceFocus —
  // the overlay starts hidden and there's nothing else to land on. Without
  // this, the very first remote press after arriving only reveals the
  // overlay (via the "any key shows the menu" listener below) without
  // actually moving focus anywhere, since spatial nav has nothing focused
  // yet to navigate from — so it silently eats one press before the
  // toolbar becomes usable. Pre-focusing the toolbar (even while it's still
  // visually hidden) means the first press already lands on Channel List.
  useEffect(() => {
    void setFocus(TOOLBAR_FOCUS_KEY)
  }, [])

  useEffect(() => {
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [])

  // Popups own Back while they're open — see SourcePopup/SubtitlesPopup's
  // useModalFocusScope, which registers strictly AFTER (so takes LIFO
  // priority over) this handler while mounted. So this only ever needs to
  // handle "hide the OSD" and "leave the player"; the old anyPopupOpen
  // branch here was fully redundant with that once popups became real
  // mount/unmount-scoped components.
  useBackHandler(() => {
    if (menuVisible) {
      hideMenu()
      return true
    }
    onBack()
    return true
  })

  // Any remote/keyboard press while the OSD is hidden should reveal it,
  // matching normal TV player behavior. While it's already visible, the
  // same press must instead just REFRESH the idle window — previously this
  // only called showMenu() in the `!menuVisible` branch, so normal arrow-
  // key/Enter activity while actively using the toolbar or a popup did
  // nothing to the timer, and the OSD could disappear mid-interaction.
  useEffect(() => {
    const onKeyDown = () => {
      if (menuVisible) scheduleIdleHide()
      else showMenu()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuVisible])

  // Any remote/keyboard or pointer press counts as the user gesture that
  // autoplay policy requires before audio can play — record it once, then
  // let the effect below unmute as soon as it's also safe (playback started).
  useEffect(() => {
    const markInteracted = () => {
      hasInteractedRef.current = true
    }
    window.addEventListener('keydown', markInteracted)
    window.addEventListener('pointerdown', markInteracted)
    return () => {
      window.removeEventListener('keydown', markInteracted)
      window.removeEventListener('pointerdown', markInteracted)
    }
  }, [])

  useEffect(() => {
    if (videoRef.current) player.attach(videoRef.current)
    // The player emits a new PlayerState on every native `timeupdate`
    // (~4x/sec during playback) for currentTime/duration alone — fields
    // this screen never reads in its JSX (grep confirms zero uses). Setting
    // state directly from every emission forced a full re-render on every
    // tick; comparing only the fields this component actually cares about
    // (status/error/mute/subtitles) means React bails out of re-rendering
    // for pure playback-clock ticks, while those fields still update
    // immediately, with no debounce.
    const unsubscribe = player.subscribe((next) => {
      setPlayerState((prev) => (playerUiStateEqual(prev, next) ? prev : next))
    })
    return () => {
      unsubscribe()
      player.dispose()
    }
  }, [player])

  // Starts muted to satisfy autoplay policy, then unmutes itself the moment
  // both conditions are true: a real user gesture has happened, and playback
  // has actually started (so there's something audible to unmute into). If
  // the user explicitly muted via the toolbar, that choice wins and this
  // backs off. Runs on every status/muted change so it also catches e.g. a
  // channel switch resuming playback after the user has already interacted.
  useEffect(() => {
    if (playerState.status === 'playing' && playerState.muted && hasInteractedRef.current && !userMutedRef.current) {
      player.setMuted(false)
    }
  }, [playerState.status, playerState.muted, player])

  const activeSource = selected?.sources[sourceIndex] ?? selected?.sources[0]

  // Full contextual line (provider | event | time | quality — see Part Y's
  // regression example) for the overlay header, recomputed from the
  // CURRENTLY ACTIVE source every render rather than the tier baked in at
  // watch-time — see Part W ("active source quality in player"): if the
  // user switches from 8K to 1080p mid-session, the overlay must not keep
  // claiming 8K. null (not initialDisplayParts's own possibly-stale
  // quality) when there's no active source to measure yet. Only used when
  // initialDisplayParts actually carries a real provider identity (i.e.
  // this playback came from Event Details with usable event context) --
  // every other watch path falls through to the existing selected?.name
  // rendering below, completely unchanged.
  const liveDisplayLine =
    initialDisplayParts?.provider && selected && activeSource
      ? formatEventStreamDisplayLine({
          ...initialDisplayParts,
          quality: qualityTierLabel(estimateQualityTier({ channel: selected, source: activeSource })),
        })
      : null

  useEffect(() => {
    if (!activeSource) return
    void player.load(activeSource.url).then(() => player.play())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource?.url, player])

  // Automatic local failover (blueprint section 42): a source that fails to
  // start is a dead end for the user otherwise — they'd have to notice the
  // error, open the Source popup, and manually try another quality. Instead,
  // step through the channel's remaining untried sources in playlist order
  // until one works or all have been tried, at which point the error is left
  // showing since there's nothing left to try automatically.
  const triedSourceIndices = useRef<Set<number>>(new Set())
  const [allSourcesFailed, setAllSourcesFailed] = useState(false)

  useEffect(() => {
    triedSourceIndices.current = new Set()
    setAllSourcesFailed(false)
  }, [selected])

  useEffect(() => {
    if (playerState.status !== 'error' || !selected || selected.sources.length === 0) return
    triedSourceIndices.current.add(sourceIndex)
    const nextIndex = selected.sources.findIndex((_, i) => !triedSourceIndices.current.has(i))
    if (nextIndex !== -1) {
      setSourceIndex(nextIndex)
    } else {
      setAllSourcesFailed(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerState.status])

  const isPaused = playerState.status === 'paused'
  const hasSubtitles = playerState.subtitleTracks.length > 0

  return (
    <main className="channel-player">
      <video ref={videoRef} className="video-el" autoPlay muted />

      <FocusContext.Provider value={overlayFocusKey}>
        <div
          ref={overlayRef}
          className={`player-overlay ${menuVisible ? 'visible' : 'hidden'}`}
          onMouseMove={showMenu}
          onFocus={showMenu}
        >
          <div className="overlay-top">
            <div className="overlay-channel-info">
              <span className="overlay-channel-name">{liveDisplayLine ?? selected?.name ?? 'No channel'}</span>
              {!liveDisplayLine && selected?.groupTitle && <span className="overlay-channel-group">{selected.groupTitle}</span>}
            </div>
          </div>

          {playerState.error && (
            <p className="player-error">
              {allSourcesFailed
                ? selected && selected.sources.length > 1
                  ? `All ${selected.sources.length} sources for this channel failed to play.`
                  : 'This channel failed to play.'
                : `${playerState.error.message} — trying another source…`}
            </p>
          )}

          <FocusContext.Provider value={toolbarFocusKey}>
            <div ref={toolbarRef} className="toolbar">
              <ToolbarButton icon="☰" label="Channel List" onSelect={onBack} />

              <ToolbarButton
                icon={isPaused ? '▶' : '❚❚'}
                label={isPaused ? 'Play' : 'Pause'}
                onSelect={() => (isPaused ? player.play() : player.pause())}
              />

              <ToolbarButton icon="((•))" label="Sync Live" onSelect={() => player.seekToLive()} />

              <ToolbarButton
                icon={playerState.muted ? '🔇' : '🔊'}
                label={playerState.muted ? 'Unmute' : 'Mute'}
                onSelect={() => {
                  const next = !playerState.muted
                  userMutedRef.current = next
                  hasInteractedRef.current = true
                  player.setMuted(next)
                }}
              />

              <div className="toolbar-item">
                <ToolbarButton
                  focusKey={SOURCE_TOGGLE_FOCUS_KEY}
                  icon="🖥"
                  label="Source"
                  active={sourcePopupOpen}
                  onSelect={() => {
                    setSubtitlesPopupOpen(false)
                    setSourcePopupOpen((open) => !open)
                  }}
                />
                {sourcePopupOpen && selected && (
                  <SourcePopup
                    sources={selected.sources}
                    sourceIndex={sourceIndex}
                    onSelectSource={(index) => {
                      setSourceIndex(index)
                      showMenu()
                    }}
                    onClose={closeSourcePopup}
                  />
                )}
              </div>

              <div className="toolbar-item">
                <ToolbarButton
                  focusKey={SUBTITLES_TOGGLE_FOCUS_KEY}
                  icon="CC"
                  label="Text"
                  active={subtitlesPopupOpen}
                  onSelect={() => {
                    setSourcePopupOpen(false)
                    setSubtitlesPopupOpen((open) => !open)
                  }}
                />
                {subtitlesPopupOpen && (
                  <SubtitlesPopup
                    tracks={hasSubtitles ? playerState.subtitleTracks : []}
                    activeTrack={playerState.activeSubtitleTrack}
                    onSelectTrack={(id) => {
                      player.setSubtitleTrack(id)
                      showMenu()
                    }}
                    onClose={closeSubtitlesPopup}
                  />
                )}
              </div>
            </div>
          </FocusContext.Provider>
        </div>
      </FocusContext.Provider>
    </main>
  )
}
