import { useEffect, useRef, useState } from 'react'
import { FocusContext, doesFocusableExist, useFocusable, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { audioLanguageChip, usePlayerSession } from '../../core/player'
import type { AudioTrack, SubtitleTrack } from '../../core/player'
import type { ChannelSource } from '../../data/channel'
import { NavIntent, keyEventToIntent, useBackHandler, useFocusScrollIntoView, useModalFocusScope } from '../../core/platform'
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
// The toolbar's deliberate landing target whenever the OSD is revealed
// without a remembered last-focused button. Play/Pause, NOT the first
// button (Channel List → onBack): norigin resolves a container with no
// preferredChildFocusKey to the child closest to the origin, which put the
// "leave playback" action under the very first OK press. Defence in depth —
// the toolbar is unfocusable while hidden (see `focusable={menuVisible}`
// below), so nothing there can be activated invisibly at all; this makes
// the worst case of a mis-ordered press "pause" rather than "quit".
const PLAY_PAUSE_FOCUS_KEY = 'player-play-pause'
// Every toolbar control carries an explicit, stable focus key rather than
// norigin's auto-generated `sn:focusable-item-N`: those are assigned in
// mount order, so the Multiview button being conditional silently shifted
// the keys of everything after it, and nothing (tests, the dev focus
// overlay, a future setFocus) could address a specific control by name.
const CHANNEL_LIST_FOCUS_KEY = 'player-channel-list'
const SYNC_LIVE_FOCUS_KEY = 'player-sync-live'
const MUTE_FOCUS_KEY = 'player-mute'
const MULTIVIEW_FOCUS_KEY = 'player-multiview'
const SOURCE_TOGGLE_FOCUS_KEY = 'player-source-toggle'
const SUBTITLES_TOGGLE_FOCUS_KEY = 'player-subtitles-toggle'
const AUDIO_TOGGLE_FOCUS_KEY = 'player-audio-toggle'
const SOURCE_POPUP_FOCUS_KEY = 'player-source-popup'
const SUBTITLES_POPUP_FOCUS_KEY = 'player-subtitles-popup'
const AUDIO_POPUP_FOCUS_KEY = 'player-audio-popup'
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
  focusable = true,
  onFocus,
}: {
  focusKey?: string
  icon: string
  label: string
  onSelect: () => void
  active?: boolean
  // Reports which control the viewer is on, so the screen can bring focus
  // back here the next time the OSD is revealed — see revealTargetRef.
  onFocus?: () => void
  // False while the OSD is hidden. The overlay is hidden by opacity alone
  // (it stays mounted and laid out so it can fade back in), and
  // `pointer-events: none` only stops the MOUSE — a D-pad has no pointer.
  // Without this every toolbar button kept full spatial-nav registration
  // while invisible, and since norigin's own window keydown listener runs
  // before this screen's "any key reveals the OSD" listener, one OK press
  // both revealed the OSD and fired whatever invisible button held focus.
  // Same pattern ChannelRow already uses for its CSS-hidden favourite star:
  // nothing invisible may be a spatial-nav target. norigin also re-checks
  // `focusable` inside its own onEnterPress dispatch, so this closes the
  // activation path as well as the navigation path.
  focusable?: boolean
}) {
  const { ref, focused } = useFocusable({ focusKey, focusable, onEnterPress: onSelect, onFocus })
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

// Same TV interaction model as SubtitlesPopup and VariantPopup — a modal
// focus scope that owns Back while open, lands focus on the row that is
// already active, and hands focus back to its opener on close.
//
// No "Off" row, unlike subtitles: audio is not something a viewer can turn
// off, only something they pick between. Every row is therefore a real
// choice, and exactly one is always checked.
function AudioPopup({
  tracks,
  activeTrack,
  onSelectTrack,
  onClose,
}: {
  tracks: AudioTrack[]
  activeTrack: string | null
  onSelectTrack: (id: string) => void
  onClose: () => void
}) {
  // The active track is what the ENGINE reports as playing. It can legitimately
  // be null (hls.js has not settled on a rendition yet) or name a track that
  // just left the list on an audio-group switch — in both cases focus falls
  // back to the first row rather than to norigin's geometry-based guess.
  const activeExists = activeTrack !== null && tracks.some((track) => track.id === activeTrack)
  const focusTarget = activeExists ? activeTrack : tracks[0]?.id
  const preferredChildFocusKey = focusTarget !== undefined ? `player-audio-option-${focusTarget}` : undefined
  const { ref, focusKey } = useModalFocusScope({ focusKey: AUDIO_POPUP_FOCUS_KEY, onClose, preferredChildFocusKey })
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="options-popup">
        <div className="options-group">
          {tracks.length > 0 ? (
            tracks.map((track) => (
              <OptionRow
                key={track.id}
                focusKey={`player-audio-option-${track.id}`}
                // A short language code, never a flag: an audio track has a
                // language, and a language is not a country (Norwegian
                // commentary on a stream sold across the Nordics is still
                // Norwegian). Falls back to a neutral chip when the stream
                // declared no language at all.
                chip={audioLanguageChip(track.language)}
                label={track.label}
                active={activeTrack === track.id}
                onSelect={() => onSelectTrack(track.id)}
              />
            ))
          ) : (
            <p className="options-empty">No alternate audio tracks available for this channel.</p>
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
  const [audioPopupOpen, setAudioPopupOpen] = useState(false)
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
  // Where the NEXT reveal of the OSD should put focus. Starts at Play/Pause
  // and then follows the viewer around the toolbar, so an OSD that timed
  // out mid-interaction comes back exactly where they left it.
  //
  // A ref, and this screen's own memory, rather than norigin's built-in
  // `lastFocusedChildKey`, for two reasons. It is read during render into
  // `preferredChildFocusKey` (whose updateFocusable runs before the
  // menuVisible effect below, so it is always current by the time focus is
  // placed) without costing a re-render per toolbar move while four
  // decoders may be running. And norigin's version is stored on the
  // container entry in a module-level singleton keyed by focus key: it
  // outlives the component, so a *new* playback session could inherit the
  // previous one's last toolbar button instead of the deliberate default.
  const revealTargetRef = useRef<string>(PLAY_PAUSE_FOCUS_KEY)

  // The toolbar container doubles as this screen's NEUTRAL FOCUS ANCHOR.
  //
  // While the OSD is hidden none of its buttons are focusable (see
  // ToolbarButton's `focusable` prop), so norigin's getNextFocusKey finds no
  // participating children and resolves setFocus(TOOLBAR_FOCUS_KEY) to this
  // container itself. A container has no onEnterPress, so OK does nothing —
  // which is exactly the property the hidden OSD needs — while spatial nav
  // still has a real, mounted component to navigate FROM once the buttons
  // come back. `preferredChildFocusKey` then decides where the reveal lands:
  // a real, visible control, and never Channel List (→ onBack) by default.
  const { ref: toolbarRef, focusKey: toolbarFocusKey } = useFocusable({
    focusKey: TOOLBAR_FOCUS_KEY,
    trackChildren: true,
    saveLastFocusedChild: false,
    preferredChildFocusKey: revealTargetRef.current,
  })

  // Every toolbar button reports itself here as it gains focus — see
  // revealTargetRef. Deliberately not a useCallback: ToolbarButton already
  // receives a fresh onEnterPress closure per render, so memoising only this
  // one would buy nothing.
  const rememberRevealTarget = (key: string) => () => {
    revealTargetRef.current = key
  }

  // Every popup this screen owns, in one place — the idle auto-hide and the
  // Back handler both go through here, so a popup added without being
  // listed would survive an OSD that has already gone away.
  const closePopups = () => {
    setSourcePopupOpen(false)
    setSubtitlesPopupOpen(false)
    setAudioPopupOpen(false)
  }

  // Single source of truth for "hide the OSD" — the idle timeout used to
  // have its OWN inline copy of this (setMenuVisible + closePopups, with NO
  // focus handling at all) instead of calling this function, which is how
  // an idle timeout firing while a Source/Subtitle OptionRow had focus
  // could leave spatial focus pointing at a component that had just been
  // removed (both the option AND its popup unmount together, so there was
  // nothing left for the library's own autoRestoreFocus safety net to land
  // on either).
  //
  // Focus PLACEMENT is deliberately not done here any more: it belongs to
  // the single `menuVisible` effect below, which owns both directions of
  // the transition. Doing it here as well raced that effect — this runs
  // before React has committed `menuVisible: false`, so the toolbar buttons
  // were still focusable and setFocus resolved to one of them, only for the
  // effect to re-anchor a moment later.
  function hideMenu() {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    setMenuVisible(false)
    closePopups()
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

  function closeAudioPopup() {
    setAudioPopupOpen(false)
    scheduleIdleHide()
  }

  // THE screen's whole focus model, both directions, in one place.
  //
  // Unlike every other screen here, nothing on this one uses forceFocus —
  // the overlay starts hidden and there's nothing else to land on. Spatial
  // nav still needs a mounted component to navigate FROM, so focus is
  // anchored on the toolbar at mount as before. What changed is what that
  // means while hidden: the buttons are no longer focusable, so this
  // resolves to the toolbar CONTAINER — a real, always-mounted,
  // NON-ACTIONABLE anchor. OK on it does nothing; the window-level reveal
  // listener below still shows the OSD, because it never needed focus.
  //
  // When `menuVisible` flips to true, React has already re-registered every
  // button as focusable (child effects run before this parent effect), so
  // focus can go straight to a real, VISIBLE button: the last one the viewer
  // used, or Play/Pause. Crucially this happens in a later task than the
  // keypress that revealed the OSD, so one press can never both reveal and
  // activate.
  //
  // The reveal target is named explicitly rather than left to
  // setFocus(TOOLBAR_FOCUS_KEY) + preferredChildFocusKey, because norigin
  // silently falls back to "child closest to the origin" whenever the
  // preferred key is not a participating focusable — and on this toolbar
  // that child is Channel List, i.e. the exact action this whole fix exists
  // to keep away from an unattended OK press. The existence check covers a
  // remembered target that has since unmounted (Multiview is conditional).
  useEffect(() => {
    if (!menuVisible) {
      void setFocus(TOOLBAR_FOCUS_KEY)
      return
    }
    if (!doesFocusableExist(revealTargetRef.current)) revealTargetRef.current = PLAY_PAUSE_FOCUS_KEY
    void setFocus(revealTargetRef.current)
  }, [menuVisible])

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
  //
  // Back is explicitly EXCLUDED. It is the one key with its own complete
  // meaning at every level of this screen (popup → close popup, visible OSD
  // → hide OSD, hidden OSD → leave the Player), so treating it as a generic
  // "wake the OSD" press made it do two contradictory things at once:
  // reveal the overlay on the very press that was leaving the screen, and —
  // because this listener runs after backHandler's, on a `menuVisible` that
  // React hasn't re-committed yet — arm a 6 s idle timer for an OSD that had
  // just been hidden.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (keyEventToIntent(event) === NavIntent.Back) return
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
  // Strictly MORE than one: a stream with a single audio rendition gives the
  // viewer nothing to decide, and a channel whose engine cannot enumerate
  // tracks at all reports zero. Either way the control is not rendered, so
  // it registers no focusable and cannot be reached by the remote — the same
  // "nothing invisible is a spatial-nav target" rule the hidden OSD follows,
  // applied to a control that does not exist rather than one that is hidden.
  const hasMultipleAudioTracks = playerState.audioTracks.length > 1
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
            {/* Every button below takes `focusable={menuVisible}`: while the
                OSD is hidden the toolbar must hold no actionable spatial-nav
                target at all (see ToolbarButton's own comment). This is the
                whole fix for "one OK press while nothing is on screen exits
                playback" — Channel List, the first button, is onBack. */}
            <div ref={toolbarRef} className="toolbar">
              <ToolbarButton
                focusKey={CHANNEL_LIST_FOCUS_KEY}
                icon="☰"
                label="Channel List"
                onSelect={onBack}
                focusable={menuVisible}
                onFocus={rememberRevealTarget(CHANNEL_LIST_FOCUS_KEY)}
              />

              <ToolbarButton
                focusKey={PLAY_PAUSE_FOCUS_KEY}
                icon={isPaused ? '▶' : '❚❚'}
                label={isPaused ? 'Play' : 'Pause'}
                onSelect={() => (isPaused ? controller.play() : controller.pause())}
                focusable={menuVisible}
                onFocus={rememberRevealTarget(PLAY_PAUSE_FOCUS_KEY)}
              />

              <ToolbarButton
                focusKey={SYNC_LIVE_FOCUS_KEY}
                icon="((•))"
                label="Sync Live"
                onSelect={() => controller.seekToLive()}
                focusable={menuVisible}
                onFocus={rememberRevealTarget(SYNC_LIVE_FOCUS_KEY)}
              />

              <ToolbarButton
                focusKey={MUTE_FOCUS_KEY}
                icon={playerState.muted ? '🔇' : '🔊'}
                label={playerState.muted ? 'Unmute' : 'Mute'}
                onSelect={() => {
                  const next = !playerState.muted
                  userMutedRef.current = next
                  hasInteractedRef.current = true
                  controller.setMuted(next)
                }}
                focusable={menuVisible}
                onFocus={rememberRevealTarget(MUTE_FOCUS_KEY)}
              />

              <div className="toolbar-item">
                <ToolbarButton
                  focusKey={SOURCE_TOGGLE_FOCUS_KEY}
                  icon={isQualityMenu ? '◍' : '🖥'}
                  label={isQualityMenu ? 'Quality' : 'Source'}
                  active={sourcePopupOpen}
                  focusable={menuVisible}
                  onFocus={rememberRevealTarget(SOURCE_TOGGLE_FOCUS_KEY)}
                  onSelect={() => {
                    setSubtitlesPopupOpen(false)
                    setAudioPopupOpen(false)
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

              {hasMultipleAudioTracks && (
                <div className="toolbar-item">
                  <ToolbarButton
                    focusKey={AUDIO_TOGGLE_FOCUS_KEY}
                    icon="♫"
                    label="Audio"
                    active={audioPopupOpen}
                    focusable={menuVisible}
                    onFocus={rememberRevealTarget(AUDIO_TOGGLE_FOCUS_KEY)}
                    onSelect={() => {
                      setSourcePopupOpen(false)
                      setSubtitlesPopupOpen(false)
                      setAudioPopupOpen((open) => !open)
                    }}
                  />
                  {audioPopupOpen && (
                    <AudioPopup
                      tracks={playerState.audioTracks}
                      activeTrack={playerState.activeAudioTrack}
                      onSelectTrack={(id) => {
                        // Switching audio only tells the Player which
                        // rendition to decode — it never touches the source,
                        // the live position, mute, or subtitles. The popup
                        // stays open and the OSD's idle window restarts, so
                        // the viewer can hear the change and pick again
                        // without the overlay vanishing under them. The
                        // checkmark moves when the engine confirms the
                        // switch, not on the keypress.
                        controller.setAudioTrack(id)
                        showMenu()
                      }}
                      onClose={closeAudioPopup}
                    />
                  )}
                </div>
              )}

              {onAddToMultiview && (
                <ToolbarButton
                  focusKey={MULTIVIEW_FOCUS_KEY}
                  icon="▦"
                  label="Multiview"
                  onSelect={() => {
                    if (selected && activeSource) onAddToMultiview(selected, activeSource)
                  }}
                  focusable={menuVisible}
                  onFocus={rememberRevealTarget(MULTIVIEW_FOCUS_KEY)}
                />
              )}

              <div className="toolbar-item">
                <ToolbarButton
                  focusKey={SUBTITLES_TOGGLE_FOCUS_KEY}
                  icon="CC"
                  label="Text"
                  active={subtitlesPopupOpen}
                  focusable={menuVisible}
                  onFocus={rememberRevealTarget(SUBTITLES_TOGGLE_FOCUS_KEY)}
                  onSelect={() => {
                    setSourcePopupOpen(false)
                    setAudioPopupOpen(false)
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
