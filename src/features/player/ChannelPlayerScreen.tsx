import { useEffect, useMemo, useRef, useState } from 'react'
import { FocusContext, useFocusable, setFocus, ROOT_FOCUS_KEY } from '@noriginmedia/norigin-spatial-navigation'
import { createHtmlVideoPlayer } from '../../core/player'
import type { PlayerState } from '../../core/player'
import { useBackHandler } from '../../core/platform'
import type { Channel } from '../../data/channel'
import './ChannelPlayerScreen.css'

interface Props {
  channels: Channel[]
  initialSourceLabel?: string
  onBack: () => void
}

const OVERLAY_FOCUS_KEY = 'player-overlay'
const TOOLBAR_FOCUS_KEY = 'player-toolbar'
const SOURCE_POPUP_FOCUS_KEY = 'player-source-popup'
const SUBTITLES_POPUP_FOCUS_KEY = 'player-subtitles-popup'
const OVERLAY_IDLE_MS = 6000

function sourceIndexFor(channel: Channel | null, label?: string): number {
  if (!channel || !label) return 0
  const index = channel.sources.findIndex((s) => s.label === label)
  return index === -1 ? 0 : index
}

function ToolbarButton({
  icon,
  label,
  onSelect,
  active = false,
}: {
  icon: string
  label: string
  onSelect: () => void
  active?: boolean
}) {
  const { ref, focused } = useFocusable({ onEnterPress: onSelect })
  return (
    <button ref={ref} className={`toolbar-btn ${focused ? 'focused' : ''} ${active ? 'active' : ''}`} onClick={onSelect}>
      <span className="toolbar-btn-icon">{icon}</span>
      <span className="toolbar-btn-label">{label}</span>
    </button>
  )
}

function OptionRow({
  chip,
  label,
  active,
  onSelect,
}: {
  chip: string
  label: string
  active: boolean
  onSelect: () => void
}) {
  const { ref, focused } = useFocusable({ onEnterPress: onSelect })
  return (
    <div ref={ref} className={`option-row ${focused ? 'focused' : ''}`} onClick={onSelect}>
      <span className="option-row-chip">{chip}</span>
      <span className="option-row-label">{label}</span>
      {active && <span className="option-row-check">✓</span>}
    </div>
  )
}

export function ChannelPlayerScreen({ channels, initialSourceLabel, onBack }: Props) {
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
  const hasInteractedRef = useRef(false)

  const { ref: overlayRef, focusKey: overlayFocusKey } = useFocusable({ focusKey: OVERLAY_FOCUS_KEY, trackChildren: true })
  const { ref: toolbarRef, focusKey: toolbarFocusKey } = useFocusable({ focusKey: TOOLBAR_FOCUS_KEY, trackChildren: true })
  const { ref: sourcePopupRef, focusKey: sourcePopupFocusKey } = useFocusable({
    focusKey: SOURCE_POPUP_FOCUS_KEY,
    trackChildren: true,
  })
  const { ref: subtitlesPopupRef, focusKey: subtitlesPopupFocusKey } = useFocusable({
    focusKey: SUBTITLES_POPUP_FOCUS_KEY,
    trackChildren: true,
  })

  const anyPopupOpen = sourcePopupOpen || subtitlesPopupOpen

  const closePopups = () => {
    setSourcePopupOpen(false)
    setSubtitlesPopupOpen(false)
  }

  const showMenu = () => {
    setMenuVisible(true)
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      setMenuVisible(false)
      closePopups()
    }, OVERLAY_IDLE_MS)
  }

  const hideMenu = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    setMenuVisible(false)
    closePopups()
    void setFocus(ROOT_FOCUS_KEY)
  }

  useEffect(() => {
    if (sourcePopupOpen) void setFocus(SOURCE_POPUP_FOCUS_KEY)
    else if (subtitlesPopupOpen) void setFocus(SUBTITLES_POPUP_FOCUS_KEY)
    else if (menuVisible) void setFocus(TOOLBAR_FOCUS_KEY)
  }, [menuVisible, sourcePopupOpen, subtitlesPopupOpen])

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

  useBackHandler(() => {
    if (anyPopupOpen) {
      closePopups()
      showMenu()
      return true
    }
    if (menuVisible) {
      hideMenu()
      return true
    }
    onBack()
    return true
  })

  // Any remote/keyboard press while the OSD is hidden should reveal it
  // instead of silently doing nothing, matching normal TV player behavior.
  useEffect(() => {
    const onKeyDown = () => {
      if (!menuVisible) showMenu()
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
    const unsubscribe = player.subscribe(setPlayerState)
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
              <span className="overlay-channel-name">{selected?.name ?? 'No channel'}</span>
              {selected?.groupTitle && <span className="overlay-channel-group">{selected.groupTitle}</span>}
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
                  icon="🖥"
                  label="Source"
                  active={sourcePopupOpen}
                  onSelect={() => {
                    setSubtitlesPopupOpen(false)
                    setSourcePopupOpen((open) => !open)
                  }}
                />
                {sourcePopupOpen && selected && (
                  <FocusContext.Provider value={sourcePopupFocusKey}>
                    <div ref={sourcePopupRef} className="options-popup">
                      <div className="options-group">
                        {selected.sources.length > 0 ? (
                          selected.sources.map((source, index) => (
                            <OptionRow
                              key={source.label + index}
                              chip={source.label}
                              label={source.label}
                              active={index === sourceIndex}
                              onSelect={() => {
                                setSourceIndex(index)
                                showMenu()
                              }}
                            />
                          ))
                        ) : (
                          <p className="options-empty">No sources available for this channel.</p>
                        )}
                      </div>
                    </div>
                  </FocusContext.Provider>
                )}
              </div>

              <div className="toolbar-item">
                <ToolbarButton
                  icon="CC"
                  label="Text"
                  active={subtitlesPopupOpen}
                  onSelect={() => {
                    setSourcePopupOpen(false)
                    setSubtitlesPopupOpen((open) => !open)
                  }}
                />
                {subtitlesPopupOpen && (
                  <FocusContext.Provider value={subtitlesPopupFocusKey}>
                    <div ref={subtitlesPopupRef} className="options-popup">
                      <div className="options-group">
                        {hasSubtitles ? (
                          <>
                            <OptionRow
                              chip="OFF"
                              label="Off"
                              active={playerState.activeSubtitleTrack === null}
                              onSelect={() => {
                                player.setSubtitleTrack(null)
                                showMenu()
                              }}
                            />
                            {playerState.subtitleTracks.map((track) => (
                              <OptionRow
                                key={track.id}
                                chip="CC"
                                label={track.label}
                                active={playerState.activeSubtitleTrack === track.id}
                                onSelect={() => {
                                  player.setSubtitleTrack(track.id)
                                  showMenu()
                                }}
                              />
                            ))}
                          </>
                        ) : (
                          <p className="options-empty">
                            No subtitles available for this channel — the stream doesn't declare any subtitle track.
                          </p>
                        )}
                      </div>
                    </div>
                  </FocusContext.Provider>
                )}
              </div>
            </div>
          </FocusContext.Provider>
        </div>
      </FocusContext.Provider>
    </main>
  )
}
