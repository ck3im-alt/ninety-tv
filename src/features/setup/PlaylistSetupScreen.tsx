import { useRef, useState } from 'react'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { fetchWithDevCorsFallback } from '../../core/net/devCorsProxy'
import { parseM3u } from '../../data/m3u/parseM3u'
import { getLiveCategories, getLiveStreams, parseXtreamPlaylistUrl } from '../../data/xtream/xtreamClient'
import { liveStreamsToChannels } from '../../data/xtream/toChannels'
import { mergeChannelSources } from '../channels/mergeChannels'
import { OnboardingTopBar } from '../onboarding/OnboardingStepper'
import { ArrowRightIcon } from '../onboarding/sportIcons'
import type { Channel } from '../../data/channel'
import type { RawChannel } from '../../data/rawChannel'
import type { XtreamCredentials } from '../../data/xtream/types'
import '../onboarding/onboardingShared.css'
import './PlaylistSetupScreen.css'

type LoadState = { status: 'idle' | 'loading' | 'error'; message?: string }

interface Props {
  // xtreamCreds is null for plain M3U sources — EPG (get_short_epg) only
  // exists on the Xtream JSON API, so callers need to know which kind of
  // source this was to know whether EPG lookups are even possible.
  onLoaded: (channels: Channel[], xtreamCreds: XtreamCredentials | null) => void
  // Set when this screen is embedded as onboarding's first step (see
  // OnboardingFlow) — shows the shared stepper instead of just the plain
  // logo, and there's no Back target since it's the very first step.
  stepperCurrent?: number
}

async function loadFromUrl(url: string): Promise<{ raw: RawChannel[]; xtreamCreds: XtreamCredentials | null }> {
  // Xtream Codes / Xtream UI panels (the most common IPTV panel software)
  // hand out a "get.php" M3U export URL, but also expose a much richer JSON
  // API (player_api.php: categories, live streams, VOD, series, EPG) at the
  // same server/credentials. Prefer that when we recognize the URL shape.
  const xtreamCreds = parseXtreamPlaylistUrl(url)
  if (xtreamCreds) {
    const [categories, streams] = await Promise.all([
      getLiveCategories(xtreamCreds),
      getLiveStreams(xtreamCreds),
    ])
    return { raw: liveStreamsToChannels(streams, categories, xtreamCreds), xtreamCreds }
  }

  const response = await fetchWithDevCorsFallback(url)
  return { raw: parseM3u(await response.text()), xtreamCreds: null }
}

// Same shape parseXtreamPlaylistUrl recognizes — building it from the
// stream-code fields lets the rest of the connect path (loadFromUrl) stay
// exactly one code path regardless of which form the user filled in.
function buildXtreamUrl(server: string, username: string, password: string): string {
  const base = server.trim().replace(/\/+$/, '')
  return `${base}/get.php?username=${encodeURIComponent(username.trim())}&password=${encodeURIComponent(password.trim())}&type=m3u_plus&output=ts`
}

export function PlaylistSetupScreen({ onLoaded, stepperCurrent }: Props) {
  const [urlValue, setUrlValue] = useState('')
  const [streamCodeOpen, setStreamCodeOpen] = useState(false)
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState<LoadState>({ status: 'idle' })
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function connect(url: string) {
    if (!url.trim()) return
    setState({ status: 'loading' })
    try {
      const { raw, xtreamCreds } = await loadFromUrl(url.trim())
      if (raw.length === 0) throw new Error('No channels found in playlist')
      onLoaded(mergeChannelSources(raw), xtreamCreds)
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Could not load playlist',
      })
    }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setState({ status: 'loading' })
    try {
      const raw = parseM3u(await file.text())
      if (raw.length === 0) throw new Error('No channels found in playlist')
      onLoaded(mergeChannelSources(raw), null)
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

  // forceFocus: the initial-focus target norigin's setFocus(ROOT_FOCUS_KEY)
  // lands on — without one, nothing is ever focused and arrow keys/remote
  // navigation silently do nothing on this screen.
  const { ref: urlRef, focused: urlFocused } = useFocusable({ forceFocus: true })
  const { ref: streamCodeToggleRef, focused: streamCodeToggleFocused } = useFocusable({
    onEnterPress: () => setStreamCodeOpen((v) => !v),
  })
  const { ref: fileRef, focused: fileFocused } = useFocusable({
    onEnterPress: () => fileInputRef.current?.click(),
  })
  const { ref: continueRef, focused: continueFocused } = useFocusable({
    onEnterPress: handleContinue,
  })

  return (
    <main className="onboarding-screen">
      <OnboardingTopBar current={stepperCurrent} />

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
        <h2 className="setup-form-label">Enter your M3U playlist link</h2>
        <div ref={urlRef} className={`setup-url-card ${urlFocused ? 'focused' : ''}`}>
          <span className="setup-url-card-tag">M3U URL</span>
          <input
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
              <input
                className="setup-code-input"
                type="text"
                placeholder="Server (https://your-provider.com:port)"
                value={server}
                onChange={(e) => setServer(e.target.value)}
              />
              <input
                className="setup-code-input"
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <input
                className="setup-code-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
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
