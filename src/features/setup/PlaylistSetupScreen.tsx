import { useEffect, useRef, useState } from 'react'
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { parseM3u } from '../../data/m3u/parseM3u'
import { parseXtreamPlaylistUrl } from '../../data/xtream/xtreamClient'
import { recoverChannelsFromSource } from '../../data/playlistRecovery'
import { mergeChannelSources } from '../channels/mergeChannels'
import { useFocusScrollIntoView, useSpatialTextInput } from '../../core/platform'
import { OnboardingTopBar } from '../onboarding/OnboardingStepper'
import { ArrowRightIcon } from '../onboarding/sportIcons'
import { QrCode } from './QrCode'
import { usePairingSession, ackPairing } from './usePairingSession'
import type { Channel } from '../../data/channel'
import type { M3uUrlSourceRecord, PlaylistSourceRecord, XtreamSourceRecord } from '../../data/session'
import '../onboarding/onboardingShared.css'
import './PlaylistSetupScreen.css'

const ROOT_FOCUS_KEY = 'setup-screen'
const URL_FOCUS_KEY = 'setup-url'
const STREAM_CODE_TOGGLE_FOCUS_KEY = 'setup-stream-code-toggle'

type LoadState = { status: 'idle' | 'loading' | 'error'; message?: string }

interface Props {
  // Always the concrete source the user just connected — Xtream creds, the
  // M3U URL, or (file uploads) just enough metadata to explain a reconnect
  // is needed later. Callers persist this via session.ts's savePlaylist so
  // a future reload can auto-recover Xtream/M3U-URL sources even if the
  // (large) channel cache fails to write — see playlistRecovery.ts.
  onLoaded: (channels: Channel[], source: PlaylistSourceRecord) => void
  // Set when this screen is embedded as onboarding's first step (see
  // OnboardingFlow) — shows the shared stepper instead of just the plain
  // logo, and there's no Back target since it's the very first step.
  stepperCurrent?: number
  // Shown when this screen is being used to reconnect a playlist that
  // couldn't be auto-recovered (a file-upload source with no valid cache)
  // rather than as a first-time connect — see App.tsx's startup recovery.
  notice?: string
}

// Xtream Codes / Xtream UI panels (the most common IPTV panel software)
// hand out a "get.php" M3U export URL, but also expose a much richer JSON
// API (player_api.php: categories, live streams, VOD, series, EPG) at the
// same server/credentials. Prefer that when we recognize the URL shape;
// otherwise treat it as a plain M3U URL.
function sourceFromUrl(url: string): XtreamSourceRecord | M3uUrlSourceRecord {
  const xtreamCreds = parseXtreamPlaylistUrl(url)
  if (xtreamCreds) return { type: 'xtream', ...xtreamCreds }
  return { type: 'm3u-url', url }
}

// Same shape parseXtreamPlaylistUrl recognizes — building it from the
// stream-code fields lets the rest of the connect path (loadFromUrl) stay
// exactly one code path regardless of which form the user filled in.
function buildXtreamUrl(server: string, username: string, password: string): string {
  const base = server.trim().replace(/\/+$/, '')
  return `${base}/get.php?username=${encodeURIComponent(username.trim())}&password=${encodeURIComponent(password.trim())}&type=m3u_plus&output=ts`
}

export function PlaylistSetupScreen({ onLoaded, stepperCurrent, notice }: Props) {
  const [urlValue, setUrlValue] = useState('')
  const [streamCodeOpen, setStreamCodeOpen] = useState(false)
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
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
    try {
      const source = sourceFromUrl(url.trim())
      const channels = await recoverChannelsFromSource(source)
      if (channels.length === 0) throw new Error('No channels found in playlist')
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
  const pairing = usePairingSession(async (m3uUrl, pollSecret) => {
    const ok = await connect(m3uUrl)
    if (ok) await ackPairing(pollSecret)
    return ok
  })

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setState({ status: 'loading' })
    try {
      const raw = parseM3u(await file.text())
      if (raw.length === 0) throw new Error('No channels found in playlist')
      onLoaded(mergeChannelSources(raw), { type: 'file', fileName: file.name })
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Could not read file',
      })
    }
  }

  function handleContinue() {
    if (streamCodeOpen && server && username && password) {
      void connect(buildXtreamUrl(server, username, password))
    } else {
      void connect(urlValue)
    }
  }

  const canContinue = state.status !== 'loading' && (streamCodeOpen ? Boolean(server && username && password) : Boolean(urlValue.trim()))

  // This screen is lazy-loaded (see App.tsx's SCREEN_FOCUS_KEYS) and also
  // reused as onboarding's step 1 — targeted by its own root key (rather
  // than ROOT_FOCUS_KEY/forceFocus) so initial focus resolves correctly
  // even if App's `screen` state changes to 'setup'/'onboarding' before
  // this chunk finishes loading. See App.tsx's initial-focus effect for the
  // full explanation of why that race exists for lazy screens.
  const { ref: screenRef, focusKey: screenFocusKey } = useFocusable({
    focusKey: ROOT_FOCUS_KEY,
    trackChildren: true,
    preferredChildFocusKey: URL_FOCUS_KEY,
  })

  // onEnterPress: norigin's spatial focus is a separate concept from real DOM
  // focus — pressing OK on the highlighted card doesn't focus the nested
  // native <input> on its own, and Samsung's on-screen keyboard only appears
  // for an <input> that actually has DOM focus. See useSpatialTextInput for
  // the shared bridge (blurs the native input again once spatial focus
  // moves elsewhere, generalized from what used to be this field's own
  // one-off implementation).
  const { ref: urlRef, focused: urlFocused } = useSpatialTextInput(urlInputRef, { focusKey: URL_FOCUS_KEY })
  const { ref: streamCodeToggleRef, focused: streamCodeToggleFocused } = useFocusable({
    focusKey: STREAM_CODE_TOGGLE_FOCUS_KEY,
    onEnterPress: () => setStreamCodeOpen((v) => !v),
  })
  // Server/Username/Password used to be plain native <input>s with no
  // spatial wrapper at all — reachable only once the card was expanded, and
  // even then only by mouse. Same bridge as the URL field above.
  const { ref: serverRef, focused: serverFocused } = useSpatialTextInput(serverInputRef)
  const { ref: usernameRef, focused: usernameFocused } = useSpatialTextInput(usernameInputRef)
  const { ref: passwordRef, focused: passwordFocused } = useSpatialTextInput(passwordInputRef)
  useFocusScrollIntoView(urlRef, urlFocused)
  useFocusScrollIntoView(streamCodeToggleRef, streamCodeToggleFocused)
  useFocusScrollIntoView(serverRef, serverFocused)
  useFocusScrollIntoView(usernameRef, usernameFocused)
  useFocusScrollIntoView(passwordRef, passwordFocused)

  // Collapsing the stream-code card while one of its own fields owns focus
  // (its useSpatialTextInput registration unmounts the instant
  // `streamCodeOpen` flips false) must not leave focus pointing at a
  // removed component — hand it back to the toggle that owns this section.
  useEffect(() => {
    if (!streamCodeOpen) void setFocus(STREAM_CODE_TOGGLE_FOCUS_KEY)
  }, [streamCodeOpen])

  const { ref: fileRef, focused: fileFocused } = useFocusable({
    onEnterPress: () => fileInputRef.current?.click(),
  })
  useFocusScrollIntoView(fileRef, fileFocused)
  // `focusable: canContinue` — a disabled Continue button couldn't do
  // anything on Enter anyway (canContinue already gates handleContinue's
  // own effect), but it was still a registered, reachable spatial target,
  // which reads as a broken/unresponsive button rather than an
  // intentionally-unavailable one.
  const { ref: continueRef, focused: continueFocused } = useFocusable({
    focusable: canContinue,
    onEnterPress: handleContinue,
  })
  useFocusScrollIntoView(continueRef, continueFocused)
  const { ref: qrRetryRef, focused: qrRetryFocused } = useFocusable({
    onEnterPress: pairing.retry,
  })
  useFocusScrollIntoView(qrRetryRef, qrRetryFocused)

  return (
    <FocusContext.Provider value={screenFocusKey}>
    <main ref={screenRef} className="onboarding-screen">
      <OnboardingTopBar current={stepperCurrent} />

      {notice && (
        <p className="setup-status" role="status">
          {notice}
        </p>
      )}

      <div className="onboarding-info with-divider">
        <h1 className="onboarding-headline">
          Add your
          <br />
          <span className="accent">playlist</span>
        </h1>
        <p className="onboarding-description">
          Enter your M3U playlist link or stream code to access your channels.
        </p>

        <ul className="onboarding-features">
          <li>
            <span className="setup-feature-icon">
              <LinkIcon />
            </span>
            <div>
              <p className="feature-title">Instant access</p>
              <p className="feature-desc">Load your channels in seconds.</p>
            </div>
          </li>
          <li>
            <span className="setup-feature-icon">
              <ShieldIcon />
            </span>
            <div>
              <p className="feature-title">Your content</p>
              <p className="feature-desc">We don't host or store any of your streams.</p>
            </div>
          </li>
          <li>
            <span className="setup-feature-icon">
              <LockIcon />
            </span>
            <div>
              <p className="feature-title">Private &amp; secure</p>
              <p className="feature-desc">Your playlist stays private on your device.</p>
            </div>
          </li>
        </ul>
      </div>

      <div className="onboarding-picker">
        <div className="setup-qr-block">
          <h2 className="setup-form-label">Scan with your phone</h2>
          {pairing.status === 'waiting' && pairing.activationUrl && (
            <div className="setup-qr-card">
              <QrCode value={pairing.activationUrl} size={176} />
              <p className="setup-qr-caption">Scan with your phone to connect your playlist</p>
            </div>
          )}
          {pairing.status === 'loading' && <p className="setup-status">Generating code…</p>}
          {pairing.status === 'error' && (
            <div className="setup-qr-card setup-qr-card-error">
              <p className="setup-status error">Couldn’t reach Ninety to generate a code.</p>
              <button
                ref={qrRetryRef}
                className={`setup-qr-retry ${qrRetryFocused ? 'focused' : ''}`}
                onClick={pairing.retry}
              >
                Try again
              </button>
            </div>
          )}
        </div>

        <div className="setup-divider">
          <span />
          <span className="setup-divider-label">OR</span>
          <span />
        </div>

        <h2 className="setup-form-label">Enter your M3U playlist link</h2>
        <div ref={urlRef} className={`setup-url-card ${urlFocused ? 'focused' : ''}`}>
          <span className="setup-url-card-tag">M3U URL</span>
          <input
            ref={urlInputRef}
            className="setup-url-input"
            type="text"
            placeholder="https://your-provider.com/playlist.m3u"
            value={urlValue}
            onChange={(e) => {
              setUrlValue(e.target.value)
              setStreamCodeOpen(false)
            }}
          />
        </div>

        <div className="setup-divider">
          <span />
          <span className="setup-divider-label">OR</span>
          <span />
        </div>

        <div
          ref={streamCodeToggleRef}
          className={`setup-code-card ${streamCodeToggleFocused ? 'focused' : ''}`}
          onClick={() => setStreamCodeOpen((v) => !v)}
        >
          <p className="setup-code-title">Or enter stream code</p>
          <p className="setup-code-desc">Some providers use a username, password or code instead of an M3U link.</p>
          {!streamCodeOpen ? (
            <div className="setup-code-toggle">
              <PlusIcon /> Enter stream code
            </div>
          ) : (
            <div className="setup-code-fields" onClick={(e) => e.stopPropagation()}>
              <div ref={serverRef} className={`setup-code-input-wrap ${serverFocused ? 'focused' : ''}`}>
                <input
                  ref={serverInputRef}
                  className="setup-code-input"
                  type="text"
                  placeholder="Server (https://your-provider.com:port)"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                />
              </div>
              <div ref={usernameRef} className={`setup-code-input-wrap ${usernameFocused ? 'focused' : ''}`}>
                <input
                  ref={usernameInputRef}
                  className="setup-code-input"
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div ref={passwordRef} className={`setup-code-input-wrap ${passwordFocused ? 'focused' : ''}`}>
                <input
                  ref={passwordInputRef}
                  className="setup-code-input"
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <div className="setup-row">
          <button ref={fileRef} className={`file-btn ${fileFocused ? 'focused' : ''}`} onClick={() => fileInputRef.current?.click()}>
            M3U File…
          </button>
          <input ref={fileInputRef} type="file" accept=".m3u,.m3u8" hidden onChange={(e) => void handleFile(e)} />
        </div>

        <div className="setup-info-box">
          <InfoIcon />
          <div>
            <p className="setup-info-title">Don't have a playlist?</p>
            <p className="setup-info-desc">Contact your IPTV provider to get your M3U link or stream code.</p>
          </div>
        </div>

        {state.status === 'loading' && <p className="setup-status">Loading playlist…</p>}
        {state.status === 'error' && <p className="setup-status error">{state.message}</p>}

        <button
          ref={continueRef}
          className={`continue-button ${continueFocused ? 'focused' : ''}`}
          disabled={!canContinue}
          onClick={handleContinue}
        >
          Continue <ArrowRightIcon />
        </button>
      </div>
    </main>
    </FocusContext.Provider>
  )
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M8.5 11.5a3 3 0 0 0 4.2.3l2-2a3 3 0 0 0-4.2-4.2l-1 1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M11.5 8.5a3 3 0 0 0-4.2-.3l-2 2a3 3 0 0 0 4.2 4.2l1-1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 2.5l6 2.2v4.3c0 4-2.6 6.9-6 8.5-3.4-1.6-6-4.5-6-8.5V4.7L10 2.5z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="4.5" y="9" width="11" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10 9v5M10 6.5v.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
