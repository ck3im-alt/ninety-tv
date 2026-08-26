import { useEffect, useRef, useState } from 'react'
import { FocusContext, useFocusable, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { usePlayerSession } from '../../core/player'
import type { SubtitleTrack } from '../../core/player'
import type { ChannelSource } from '../../data/channel'
import { useBackHandler, useFocusScrollIntoView, useModalFocusScope } from '../../core/platform'
import type { Channel } from '../../data/channel'
import { estimateQualityTier, qualityTierLabel } from '../eventDetails/rankStreamQuality'
import { formatEventStreamDisplayLine } from '../eventDetails/ppvDisplayName'
import type { EventPlaybackGroup } from '../eventDetails/eventPlaybackGroup'
import type { PlaybackCandidate } from '../eventDetails/buildEventStreamOptions'
import './ChannelPlayerScreen.css'

interface Props {
  channels: Channel[]
  initialSourceLabel?: string
  // The whole logical stream group Event Details handed over — every
  // quality variant of ONE broadcaster/event feed, best-first, possibly
  // spanning more than one playlist Channel (see eventPlaybackGroup.ts).
  // Undefined for every other watch path (Home, Browse, Favorites, Recent),
  // which still play a single Channel's own sources exactly as before.
  playbackGroup?: EventPlaybackGroup
  onBack: () => void
  // "Add to Multiview" — undefined on any path that shouldn't offer it
  // (there currently is none, but kept optional so a future restricted
  // entry point could omit it without a dead/always-registered toolbar
  // button — same precedent as onOpenAdmin in TopNav). Receives the exact
  // (channel, source) currently playing; App.tsx already knows the
  // originating SportEvent (if any) itself, see watchChannel/playingEvent.
  onAddToMultiview?: (channel: Channel, source: ChannelSource) => void
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

// ONE row in the Quality/Source menu — i.e. one thing the viewer can
// actually choose — together with every stream that can serve it. The two
// levels are deliberately separate:
//
// - `label`/`qualityLabel` are what the viewer sees and picks. Two 1080p
//   feeds are ONE choice: "1080p" twice is the same answer to the only
//   question being asked.
// - `candidates` are interchangeable ways to deliver that choice (a second
//   provider's feed, the same channel from another playlist). They are real
//   playback assets — failover material — and must never be discarded just
//   because they'd be redundant on screen.
//
// The channel is carried per-CANDIDATE, not once for the whole screen: a
// stream group from Event Details can span several playlist Channel objects
// that Ninety resolved to the SAME logical broadcaster (see
// eventPlaybackGroup.ts), so "which channel is playing" is a property of
// the active candidate.
interface PlaybackChoice {
  label: string
  qualityLabel: string | null
  candidates: PlaybackCandidate[]
}

// One flattened entry per candidate, in choice order — the shape the
// session controller works in (it addresses sources by a flat index).
// `choiceIndex` is what maps a playing source back to the menu row it
// belongs to, and doubles as the controller's failover GROUP id (see
// PlayerSessionOptions.sourceGroups): failover exhausts a choice's own
// candidates before moving to a different choice, so switching to a mirror
// never silently changes the quality the viewer selected.
interface PlaybackEntry extends PlaybackCandidate {
  choiceIndex: number
}

// An ordinary channel watch (Home/Browse/Favorites/Recent): that channel's
// own sources, in the playlist's own order, each its own choice — unchanged
// from before, including the source-label wording and the initial-source
// lookup. These genuinely are separate picks (provider mirrors the user
// chooses between), not tiers of one stream. Quality labels still come from
// the same metadata-only estimator Event Details uses (never a probe).
function choicesForChannel(channel: Channel | null): PlaybackChoice[] {
  if (!channel) return []
  return channel.sources.map((source) => ({
    label: source.label,
    qualityLabel: qualityTierLabel(estimateQualityTier({ channel, source })),
    candidates: [{ channel, source }],
  }))
}

// A stream group from Event Details: one choice per QUALITY, every
// same-tier candidate kept behind it.
function choicesForGroup(group: EventPlaybackGroup): PlaybackChoice[] {
  return group.variants.map((variant) => ({
    label: variant.qualityLabel ?? 'Unknown quality',
    qualityLabel: variant.qualityLabel,
    candidates: variant.candidates.map((candidate) => ({ channel: candidate.channel, source: candidate.source })),
  }))
}

function flattenChoices(choices: PlaybackChoice[]): PlaybackEntry[] {
  return choices.flatMap((choice, choiceIndex) => choice.candidates.map((candidate) => ({ ...candidate, choiceIndex })))
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
//
// One popup for both meanings of "another way to play this", because
// mechanically they're the same list of candidate URLs — only the label
// differs (see variantMenuLabel): for a stream group handed over from
// Event Details the entries ARE the quality tiers of one logical stream, so
// it presents as Quality; for an ordinary channel they're the provider's
// own interchangeable source mirrors, which stay Source.
function VariantPopup({
  choices,
  activeIndex,
  isQualityMenu,
  onSelectChoice,
  onClose,
}: {
  choices: PlaybackChoice[]
  activeIndex: number
  isQualityMenu: boolean
  onSelectChoice: (choiceIndex: number) => void
  onClose: () => void
}) {
  // Focus the currently selected choice if it exists, otherwise the first
  // one — never just "the popup container" (which would fall back to
  // norigin's geometry-based child search rather than the deliberate
  // choice this popup actually wants).
  const preferredChildFocusKey = choices[activeIndex] ? `player-source-option-${activeIndex}` : choices[0] ? 'player-source-option-0' : undefined
  const { ref, focusKey } = useModalFocusScope({ focusKey: SOURCE_POPUP_FOCUS_KEY, onClose, preferredChildFocusKey })
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="options-popup">
        <div className="options-group">
          {choices.length > 0 ? (
            // Strictly one row per CHOICE — however many candidates sit
            // behind it. Mirrors are failover material, not a decision to
            // hand the viewer.
            choices.map((choice, index) => (
              <OptionRow
                key={`${choice.label}-${index}`}
                focusKey={`player-source-option-${index}`}
                // A quality menu names tiers ("8K", "1080p"), with an
                // honest dash for an unrecognized one rather than a
                // fabricated tier; a source menu keeps the provider's own
                // source label, exactly as before.
                chip={isQualityMenu ? (choice.qualityLabel ?? '—') : choice.label}
                label={choice.label}
                active={index === activeIndex}
                onSelect={() => onSelectChoice(index)}
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

export function ChannelPlayerScreen({ channels, initialSourceLabel, playbackGroup, onBack, onAddToMultiview }: Props) {
  // Resolved ONCE at mount, like the `selected` channel it replaces: the
  // underlying session reads its URL list only at construction (see
  // usePlayerSession), and a genuinely different stream is a fresh mount,
  // not a prop change.
  const [choices] = useState<PlaybackChoice[]>(() => (playbackGroup ? choicesForGroup(playbackGroup) : choicesForChannel(channels[0] ?? null)))
  const [entries] = useState<PlaybackEntry[]>(() => flattenChoices(choices))
  // A stream group arrives already sorted best-quality-first, so entry 0 is
  // the best quality's primary candidate — the viewer picked a broadcaster,
  // not a tier (see StreamRow). An ordinary channel watch keeps starting on
  // whichever source the originating row played: with exactly one candidate
  // per choice there, the flat entry index and the source index coincide.
  const [initialEntryIndex] = useState(() => (playbackGroup ? 0 : sourceIndexFor(channels[0] ?? null, initialSourceLabel)))
  const { videoRef, state: session, controller } = usePlayerSession(
    entries.map((entry) => entry.source.url),
    initialEntryIndex,
    // Failover order: exhaust the current choice's own candidates before
    // dropping to the next choice down. All of that policy lives in the
    // session controller already — this only tells it which entries belong
    // together (see PlayerSessionOptions.sourceGroups).
    { sourceGroups: entries.map((entry) => entry.choiceIndex) },
  )
  const playerState = session.playerState
  const sourceIndex = session.sourceIndex
  const allSourcesFailed = session.allSourcesFailed
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

  // Starts muted to satisfy autoplay policy, then unmutes itself the moment
  // both conditions are true: a real user gesture has happened, and playback
  // has actually started (so there's something audible to unmute into). If
  // the user explicitly muted via the toolbar, that choice wins and this
  // backs off. Runs on every status/muted change so it also catches e.g. a
  // channel switch resuming playback after the user has already interacted.
  useEffect(() => {
    if (playerState.status === 'playing' && playerState.muted && hasInteractedRef.current && !userMutedRef.current) {
      controller.setMuted(false)
    }
  }, [playerState.status, playerState.muted, controller])

  // Everything below reads the ACTIVE entry, never a frozen selection:
  // sourceIndex moves both when the user picks another quality and when the
  // session fails over on its own, and both must be reflected identically.
  // The menu and the overlay follow the active entry's CHOICE, so failing
  // over between two candidates of one quality leaves both showing that
  // same quality — while a drop to the next choice down updates them.
  const activeEntry = entries[sourceIndex] ?? entries[0]
  const activeChoiceIndex = activeEntry?.choiceIndex ?? 0
  const activeChoice = choices[activeChoiceIndex]
  const selected = activeEntry?.channel ?? channels[0] ?? null
  const activeSource = activeEntry?.source

  // Full contextual line (provider | event | time | quality — see Part Y's
  // regression example) for the overlay header, recomposed from the
  // CURRENTLY ACTIVE variant every render rather than the tier baked in at
  // watch-time — see Part W ("active source quality in player"): if the
  // user switches from 8K to 1080p, or the session fails over to another
  // variant, the overlay must not keep claiming 8K. Only rendered for
  // playback that came from Event Details (a stream group); every other
  // watch path falls through to the existing selected?.name rendering
  // below, completely unchanged. `provider` falls back to the group's own
  // display name so a linear broadcaster with no extractable provider
  // segment still gets a named line (and therefore a visible live quality)
  // rather than dropping back to the bare playlist channel name.
  const liveDisplayLine = playbackGroup
    ? formatEventStreamDisplayLine({
        ...playbackGroup.displayParts,
        provider: playbackGroup.displayParts.provider ?? playbackGroup.displayName,
        quality: activeChoice?.qualityLabel ?? null,
      })
    : null

  const isPaused = playerState.status === 'paused'
  const hasSubtitles = playerState.subtitleTracks.length > 0
  // Choices handed over by Event Details are the quality tiers of a single
  // logical stream, so the control that switches between them is a Quality
  // picker. An ordinary channel's choices are genuine source mirrors the
  // viewer picks between, which keeps the existing Source wording.
  const isQualityMenu = playbackGroup != null

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
                ? entries.length > 1
                  ? `All ${entries.length} sources for this channel failed to play.`
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
                onSelect={() => (isPaused ? controller.play() : controller.pause())}
              />

              <ToolbarButton icon="((•))" label="Sync Live" onSelect={() => controller.seekToLive()} />

              <ToolbarButton
                icon={playerState.muted ? '🔇' : '🔊'}
                label={playerState.muted ? 'Unmute' : 'Mute'}
                onSelect={() => {
                  const next = !playerState.muted
                  userMutedRef.current = next
                  hasInteractedRef.current = true
                  controller.setMuted(next)
                }}
              />

              <div className="toolbar-item">
                <ToolbarButton
                  focusKey={SOURCE_TOGGLE_FOCUS_KEY}
                  icon={isQualityMenu ? '◍' : '🖥'}
                  label={isQualityMenu ? 'Quality' : 'Source'}
                  active={sourcePopupOpen}
                  onSelect={() => {
                    setSubtitlesPopupOpen(false)
                    setSourcePopupOpen((open) => !open)
                  }}
                />
                {sourcePopupOpen && (
                  <VariantPopup
                    choices={choices}
                    activeIndex={activeChoiceIndex}
                    isQualityMenu={isQualityMenu}
                    onSelectChoice={(choiceIndex) => {
                      // Always that choice's PRIMARY candidate — a
                      // deliberate pick opens the preferred stream for the
                      // quality asked for, and any later failure works
                      // through the rest of that same quality's candidates
                      // first (the controller's grouped failover).
                      const primary = entries.findIndex((entry) => entry.choiceIndex === choiceIndex)
                      if (primary !== -1) controller.selectSource(primary)
                      showMenu()
                    }}
                    onClose={closeSourcePopup}
                  />
                )}
              </div>

              {onAddToMultiview && (
                <ToolbarButton
                  icon="▦"
                  label="Multiview"
                  onSelect={() => {
                    if (selected && activeSource) onAddToMultiview(selected, activeSource)
                  }}
                />
              )}

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
                      controller.setSubtitleTrack(id)
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
