import { useRef, useState } from 'react'
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { buildXtreamUrl, connectPlaylistFromUrl, loadChannelsFromFile } from '../../data/playlists/connectPlaylist'
import { useFocusScrollIntoView, useSpatialTextInput } from '../../core/platform'
import { OnboardingTopBar } from '../onboarding/OnboardingStepper'
import {
  ONBOARDING_PRIMARY_FOCUS_KEY,
  ONBOARDING_SECONDARY_FOCUS_KEY,
  OnboardingFooter,
} from '../onboarding/OnboardingActions'
import { LoadingScreen, PLAYLIST_IMPORT_STAGES, PLAYLIST_IMPORT_TITLE, nextPaint, useDeferredBusy } from '../../core/ui'
import { QrCode } from './QrCode'
import { usePairingSession, ackPairing } from './usePairingSession'
import type { Channel } from '../../data/channel'
import type { PlaylistSourceRecord } from '../../data/session'
import '../onboarding/onboardingShared.css'
import './PlaylistSetupScreen.css'

const SCREEN_FOCUS_KEY = 'setup-screen'
const URL_FOCUS_KEY = 'setup-url'
const FILE_FOCUS_KEY = 'setup-file'
const SERVER_FOCUS_KEY = 'setup-server'
const PASSWORD_FOCUS_KEY = 'setup-password'
const QR_RETRY_FOCUS_KEY = 'setup-qr-retry'

type LoadState = { status: 'idle' | 'loading' | 'error'; message?: string }

// Which manual method Continue will actually use. Explicit state rather
// than "whichever field happens to be non-empty": with an M3U URL typed AND
// provider credentials filled in, an implicit rule has to silently pick one,
// and the user has no way to tell which. The active method is simply the
// last one the user touched — pressing Enter on a field (which is also what
// opens Tizen's keyboard) or typing in it selects that method — and the
// panel border shows which one is armed.
type ConnectMode = 'url' | 'xtream'

interface Props {
  // Always the concrete source the user just connected — Xtream creds, the
  // M3U URL, or (file uploads) just enough metadata to explain a reconnect
  // is needed later. Callers persist this via session.ts's saveSource so a
  // future reload can auto-recover Xtream/M3U-URL sources even if the
  // (large) channel cache fails to write — see playlistRecovery.ts.
  onLoaded: (channels: Channel[], source: PlaylistSourceRecord) => void
  // 'onboarding': step 1 of the first-run wizard — shows the three-step
  // stepper and a "Skip setup" action, and replaces the whole screen (no
  // TopNav above it).
  // 'standalone' (default): App.tsx's `setup` screen, reached from Settings
  // or from a failed auto-reconnect. Renders BELOW TopNav, has no stepper,
  // and deliberately offers no Skip — there is nothing to skip to, and a
  // user reconnecting a playlist must never be dropped back into the
  // first-run wizard.
  variant?: 'onboarding' | 'standalone'
  // Onboarding only: continue without connecting anything.
  onSkip?: () => void
  // Shown when this screen is being used to reconnect a playlist that
  // couldn't be auto-recovered (a file-upload source with no valid cache)
  // rather than as a first-time connect — see App.tsx's startup recovery.
  notice?: string
}

// connectPlaylistFromUrl / buildXtreamUrl / loadChannelsFromFile all live
// in data/playlists/connectPlaylist.ts now.
// They used to be private to this screen, which meant Settings' own
// add/edit-playlist flow would have had to reimplement "what an Xtream URL
// looks like" and "what counts as a valid playlist" a second time. One
// definition, two surfaces.

export function PlaylistSetupScreen({ onLoaded, variant = 'standalone', onSkip, notice }: Props) {
  const isOnboarding = variant === 'onboarding'
  const [urlValue, setUrlValue] = useState('')
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<ConnectMode>('url')
  const [state, setState] = useState<LoadState>({ status: 'idle' })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const serverInputRef = useRef<HTMLInputElement>(null)
  const usernameInputRef = useRef<HTMLInputElement>(null)
  const passwordInputRef = useRef<HTMLInputElement>(null)

  // Returns whether the connect actually succeeded -- the QR-pairing flow
  // below needs this to know whether it's safe to acknowledge the pairing
  // session (only once the URL has actually been parsed/loaded, same
  // trust point manual entry already relies on for onLoaded).
  async function connect(url: string): Promise<boolean> {
    if (!url.trim()) return false
    setState({ status: 'loading' })
    // Let the loading state reach the screen before the work starts — the
    // M3U parse that follows the fetch is synchronous and holds the main
    // thread. See nextPaint.
    await nextPaint()
    try {
      // connectPlaylistFromUrl, not sourceFromUrl + load: a get.php URL
      // whose panel has no usable player_api.php is retried as a plain M3U,
      // and `source` is whichever of the two actually worked — so that is
      // what gets persisted and resynced from later.
      const { source, channels } = await connectPlaylistFromUrl(url)
      onLoaded(channels, source)
      return true
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Could not load playlist',
      })
      return false
    }
  }

  // Feeds a QR-scanned M3U URL through the exact same connect() path as
  // manual entry -- no second playlist-loading architecture. Only acks the
  // pairing session (which immediately clears the URL server-side) once
  // connect() has actually succeeded; a failed connect leaves the session
  // untouched so the phone page's "Playlist sent" message isn't a lie and
  // the user can fix a bad URL and resubmit within the same ~10 min window.
  //
  // Independent of `mode`: the phone submitting a playlist is an explicit
  // action of its own, so it auto-submits regardless of which manual method
  // happens to be armed.
  const pairing = usePairingSession(async (m3uUrl, pollSecret) => {
    const ok = await connect(m3uUrl)
    if (ok) await ackPairing(pollSecret)
    return ok
  })

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setState({ status: 'loading' })
    // THE ONE THAT ACTUALLY MATTERS. Parsing a real 30,000-channel playlist
    // measured ~3s on a TV-class CPU, all of it synchronous — without this
    // yield the loading panel is committed to a DOM that never gets painted
    // before the parse takes the thread, and the app just appears to freeze.
    await nextPaint()
    try {
      const { channels, source } = await loadChannelsFromFile(file)
      onLoaded(channels, source)
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Could not read file',
      })
    }
  }

  // A playlist import is the one genuinely slow thing on this screen, and it
  // is never fast enough to be worth hiding behind a delay: reading a file
  // or fetching a provider URL always takes long enough to notice, and the
  // parse that follows blocks the main thread outright. So: shown at once
  // (showDelayMs 0), and still held for the hook's minimum-visible window so
  // an unusually quick import cannot flash. Every other state change on this
  // screen is instant and shows nothing.
  const importing = useDeferredBusy(state.status === 'loading', { showDelayMs: 0 })

  const xtreamComplete = Boolean(server.trim() && username.trim() && password.trim())
  const urlComplete = Boolean(urlValue.trim())
  const canContinue = state.status !== 'loading' && (mode === 'xtream' ? xtreamComplete : urlComplete)

  function handleContinue() {
    if (!canContinue) return
    if (mode === 'xtream') void connect(buildXtreamUrl(server, username, password))
    else void connect(urlValue)
  }

  // Where Up out of the form's top row goes. The standalone variant renders
  // BELOW TopNav, which is the only way off this screen without connecting
  // something — but the avatar sits far right with no horizontal overlap
  // against the form, so norigin's geometry can't find it. Onboarding has no
  // TopNav at all, so Up there is simply the page edge.
  function focusAboveForm(): false {
    if (pairing.status === 'error') void setFocus(QR_RETRY_FOCUS_KEY)
    else if (!isOnboarding) void setFocus('nav-avatar')
    return false
  }

  // Where Down out of the form actually goes. Continue is deliberately
  // unfocusable until the armed method is valid — but an explicit
  // setFocus(key) bypasses norigin's own `focusable` guard, so aiming Down
  // straight at it would park the highlight on a disabled button anyway.
  // Fall through to Skip setup instead, and consume the key entirely when
  // the footer has nothing focusable at all (standalone, empty form).
  function focusFooter(): false {
    if (canContinue) void setFocus(ONBOARDING_PRIMARY_FOCUS_KEY)
    else if (isOnboarding && onSkip) void setFocus(ONBOARDING_SECONDARY_FOCUS_KEY)
    return false
  }

  // This screen is lazy-loaded (see App.tsx's SCREEN_FOCUS_KEYS) and also
  // reused as onboarding's step 1 — targeted by its own root key (rather
  // than ROOT_FOCUS_KEY/forceFocus) so initial focus resolves correctly
  // even if App's `screen` state changes to 'setup'/'onboarding' before
  // this chunk finishes loading. See App.tsx's initial-focus effect for the
  // full explanation of why that race exists for lazy screens.
  const { ref: screenRef, focusKey: screenFocusKey } = useFocusable({
    focusKey: SCREEN_FOCUS_KEY,
    trackChildren: true,
    preferredChildFocusKey: URL_FOCUS_KEY,
  })

  // onEnterPress: norigin's spatial focus is a separate concept from real DOM
  // focus — pressing OK on the highlighted card doesn't focus the nested
  // native <input> on its own, and Samsung's on-screen keyboard only appears
  // for an <input> that actually has DOM focus. See useSpatialTextInput for
  // the shared bridge (it also blurs the native input again once spatial
  // focus moves elsewhere).
  //
  // The explicit Right/Left/Up/Down overrides below exist because the two
  // manual panels sit side by side across the full 1920px canvas: norigin
  // needs >=20% geometric overlap to call two elements adjacent, and a
  // single-line input in the left panel rarely overlaps a stacked field in
  // the right one. Every crossing between the two panels, and every exit
  // down to the footer, is therefore stated rather than inferred.
  const { ref: urlRef, focused: urlFocused } = useSpatialTextInput(urlInputRef, {
    focusKey: URL_FOCUS_KEY,
    onEnterPress: () => setMode('url'),
    onArrowPress: (direction) => {
      if (direction === 'right') {
        void setFocus(SERVER_FOCUS_KEY)
        return false
      }
      // Answered explicitly rather than letting norigin escape to the
      // screen root, which draws no focus ring (see SelectableCard's
      // BLOCK_ARROW for the same problem).
      if (direction === 'up') return focusAboveForm()
      if (direction === 'left') return false // page edge
      return true
    },
  })
  const { ref: fileRef, focused: fileFocused } = useFocusable({
    focusKey: FILE_FOCUS_KEY,
    onEnterPress: () => fileInputRef.current?.click(),
    onArrowPress: (direction) => {
      if (direction === 'right') {
        void setFocus(PASSWORD_FOCUS_KEY)
        return false
      }
      if (direction === 'down') return focusFooter()
      if (direction === 'left') return false // page edge
      return true
    },
  })
  const { ref: serverRef, focused: serverFocused } = useSpatialTextInput(serverInputRef, {
    focusKey: SERVER_FOCUS_KEY,
    onEnterPress: () => setMode('xtream'),
    onArrowPress: (direction) => {
      if (direction === 'left') {
        void setFocus(URL_FOCUS_KEY)
        return false
      }
      if (direction === 'up') return focusAboveForm()
      if (direction === 'right') return false // page edge
      return true
    },
  })
  const { ref: usernameRef, focused: usernameFocused } = useSpatialTextInput(usernameInputRef, {
    onEnterPress: () => setMode('xtream'),
    onArrowPress: (direction) => {
      if (direction === 'left') {
        void setFocus(URL_FOCUS_KEY)
        return false
      }
      if (direction === 'right') return false // page edge
      return true
    },
  })
  const { ref: passwordRef, focused: passwordFocused } = useSpatialTextInput(passwordInputRef, {
    focusKey: PASSWORD_FOCUS_KEY,
    onEnterPress: () => setMode('xtream'),
    onArrowPress: (direction) => {
      if (direction === 'left') {
        void setFocus(FILE_FOCUS_KEY)
        return false
      }
      if (direction === 'down') return focusFooter()
      if (direction === 'right') return false // page edge
      return true
    },
  })
  useFocusScrollIntoView(urlRef, urlFocused)
  useFocusScrollIntoView(fileRef, fileFocused)
  useFocusScrollIntoView(serverRef, serverFocused)
  useFocusScrollIntoView(usernameRef, usernameFocused)
  useFocusScrollIntoView(passwordRef, passwordFocused)

  return (
    <FocusContext.Provider value={screenFocusKey}>
      <main ref={screenRef} className={`onboarding-screen ${isOnboarding ? '' : 'standalone'}`}>
        {/* Onboarding only. In the standalone variant TopNav is already
            rendered above this screen and carries the NINETY wordmark, so a
            second logo bar would both duplicate it and eat the height this
            layout needs. */}
        {isOnboarding && <OnboardingTopBar current={1} />}

        <div className="onboarding-heading">
          <h1 className="onboarding-headline">
            Connect your <span className="accent">playlist</span>
          </h1>
          <p className="onboarding-description">
            Add your TV provider once and Ninety will organize your channels around the sports you follow.
          </p>
          {notice && (
            <p className="setup-status setup-notice" role="status">
              {notice}
            </p>
          )}
          {/* A FAILED CONNECT HAS TO BE READABLE, and this is the only place
              on this screen where that is true. It used to render at the
              bottom of .onboarding-body, below the QR card, the manual row
              and the footer — off the fold on a 1080p canvas — so a QR
              submission that failed looked like the import overlay flashing
              and nothing else happening at all. There is no console on this
              hardware, so an error nobody can see is an error nobody can
              diagnose. `role="alert"`, not "status": this one interrupts. */}
          {state.status === 'error' && (
            <p className="setup-status error setup-connect-error" role="alert">
              {state.message}
            </p>
          )}
        </div>

        <div className="onboarding-body">
          <section className="setup-qr-card">
            <div className="setup-qr-code">
              {pairing.status === 'waiting' && pairing.activationUrl && <QrCode value={pairing.activationUrl} size={188} />}
              {pairing.status === 'loading' && <p className="setup-qr-placeholder">Generating code…</p>}
              {pairing.status === 'error' && <p className="setup-qr-placeholder">No code</p>}
            </div>

            <div className="setup-qr-copy">
              <span className="setup-qr-badge">Recommended</span>
              <h2 className="setup-qr-title">Add with your phone</h2>
              <p className="setup-qr-desc">Scan the QR code and paste your M3U URL — no typing on the TV.</p>
              {pairing.status === 'error' && (
                <div className="setup-qr-error">
                  <p className="setup-status error">Couldn't reach Ninety to generate a code.</p>
                  <QrRetryButton onRetry={pairing.retry} isOnboarding={isOnboarding} />
                </div>
              )}
            </div>

            <PhoneIllustration />
          </section>

          <div className="setup-manual-row">
            <section className={`setup-panel ${mode === 'url' ? 'active' : ''}`}>
              <h2 className="setup-panel-title">M3U playlist URL</h2>
              <div ref={urlRef} className={`setup-field ${urlFocused ? 'focused' : ''}`}>
                <input
                  ref={urlInputRef}
                  className="setup-input"
                  type="text"
                  placeholder="https://provider.com/get.php?..."
                  value={urlValue}
                  onChange={(e) => {
                    setUrlValue(e.target.value)
                    setMode('url')
                  }}
                />
              </div>
              <p className="setup-panel-hint">Paste the link your provider gave you. Xtream links are detected automatically.</p>
              <button ref={fileRef} className={`setup-file-button ${fileFocused ? 'focused' : ''}`} onClick={() => fileInputRef.current?.click()}>
                Load from an M3U file instead
              </button>
              <input ref={fileInputRef} type="file" accept=".m3u,.m3u8" hidden onChange={(e) => void handleFile(e)} />
            </section>

            <section className={`setup-panel ${mode === 'xtream' ? 'active' : ''}`}>
              <h2 className="setup-panel-title">Provider login</h2>
              <p className="setup-panel-hint">Use this if your provider gave you a server address, username and password.</p>
              <div className="setup-fields">
                <div ref={serverRef} className={`setup-field ${serverFocused ? 'focused' : ''}`}>
                  <input
                    ref={serverInputRef}
                    className="setup-input"
                    type="text"
                    placeholder="Server (https://your-provider.com:port)"
                    value={server}
                    onChange={(e) => {
                      setServer(e.target.value)
                      setMode('xtream')
                    }}
                  />
                </div>
                <div ref={usernameRef} className={`setup-field ${usernameFocused ? 'focused' : ''}`}>
                  <input
                    ref={usernameInputRef}
                    className="setup-input"
                    type="text"
                    placeholder="Username"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value)
                      setMode('xtream')
                    }}
                  />
                </div>
                <div ref={passwordRef} className={`setup-field ${passwordFocused ? 'focused' : ''}`}>
                  <input
                    ref={passwordInputRef}
                    className="setup-input"
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      setMode('xtream')
                    }}
                  />
                </div>
              </div>
            </section>
          </div>

          {/* Loading is a full-screen Ninety state now (see the overlay
              below), not a line of text under the form — importing a
              playlist is the longest wait in the whole app and the form it
              would sit under is no longer interactive while it runs. The
              error moved UP to the heading, where it is actually on screen —
              see the note there. */}
        </div>

        <OnboardingFooter
          secondary={isOnboarding && onSkip ? { label: 'Skip setup', onPress: onSkip } : undefined}
          primary={{ label: 'Continue', onPress: handleContinue, disabled: !canContinue }}
          upFocusKey={mode === 'xtream' ? PASSWORD_FOCUS_KEY : URL_FOCUS_KEY}
        />
      </main>

      {/* Covers the fetch+parse half of an import. The other half (merging,
          persisting and indexing the channels) happens after onLoaded hands
          them over, and is covered by App.tsx's own overlay — one continuous
          Ninety loading state across both, because from the viewer's side it
          is one operation.

          Deferred so a cached/instant connect never flashes a panel at all —
          see useDeferredBusy. */}
      {importing && <LoadingScreen title={PLAYLIST_IMPORT_TITLE} detail={PLAYLIST_IMPORT_STAGES.fetching} />}
    </FocusContext.Provider>
  )
}

// Its own component so norigin's registration and the DOM node have the
// same lifetime. Calling useFocusable for this inline while rendering the
// button only in the error branch registered a focusable with a null node
// on every non-error render — which logs "Component added without a node
// reference" and leaves a focusable sitting at an empty (0,0,0,0) layout
// that a directional search can land on.
function QrRetryButton({ onRetry, isOnboarding }: { onRetry: () => void; isOnboarding: boolean }) {
  const { ref, focused } = useFocusable({
    focusKey: QR_RETRY_FOCUS_KEY,
    onEnterPress: onRetry,
    onArrowPress: (direction) => {
      if (direction === 'down') {
        void setFocus(URL_FOCUS_KEY)
        return false
      }
      if (direction === 'up') {
        // Standalone renders below TopNav, which is the only way off this
        // screen without connecting something; onboarding has no TopNav, so
        // Up there is simply the page edge.
        if (!isOnboarding) void setFocus('nav-avatar')
        return false
      }
      if (direction === 'left' || direction === 'right') return false // page edge
      return true
    },
  })
  useFocusScrollIntoView(ref, focused)
  return (
    <button ref={ref} className={`setup-qr-retry ${focused ? 'focused' : ''}`} onClick={onRetry}>
      Try again
    </button>
  )
}

// Deliberately CSS/SVG, not an image asset: it's a decorative hint, and the
// packaged Tizen widget shouldn't carry a bitmap for it. Dark, low-contrast
// and non-interactive — it sits behind the copy, not in front of it.
function PhoneIllustration() {
  return (
    <div className="setup-phone" aria-hidden="true">
      <div className="setup-phone-body">
        <span className="setup-phone-notch" />
        <div className="setup-phone-screen">
          <span className="setup-phone-line wide" />
          <span className="setup-phone-line" />
          <span className="setup-phone-line short" />
        </div>
      </div>
    </div>
  )
}
