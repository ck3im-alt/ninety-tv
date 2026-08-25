// Add a playlist, or change an existing playlist's connection details.
//
// This is a Settings-shaped surface over the EXISTING connection
// architecture, not a second one: every field below ends up in
// data/playlists/connectPlaylist.ts, which is the same sourceFromUrl /
// buildXtreamUrl / recoverChannelsFromSource / parseM3u + mergeChannelSources
// path the first-run setup screen uses. No second parser, no second idea of
// what an Xtream URL looks like, no second definition of a valid playlist.
//
// It is a Settings component rather than a reuse of PlaylistSetupScreen for
// two reasons: that screen is a full-bleed onboarding step (its own stepper,
// heading, footer and onboarding CSS) which would look and navigate nothing
// like the rest of Settings, and it is being actively reworked by the
// concurrent onboarding redesign.
import { useRef, useState } from 'react'
import { FocusContext } from '@noriginmedia/norigin-spatial-navigation'
import { useModalFocusScope, useSpatialTextInput } from '../../core/platform'
import { QrCode } from '../setup/QrCode'
import { ackPairing, usePairingSession } from '../setup/usePairingSession'
import {
  EmptyPlaylistError,
  buildXtreamUrl,
  loadChannelsForSource,
  loadChannelsFromFile,
  sourceFromUrl,
} from '../../data/playlists/connectPlaylist'
import { SettingsAction } from './settingsPrimitives'
import type { Channel } from '../../data/channel'
import type { PlaylistSourceRecord } from '../../data/session'

const DIALOG_FOCUS_KEY = 'settings-connect-dialog'
const URL_FOCUS_KEY = 'settings-connect-url'
const SERVER_FOCUS_KEY = 'settings-connect-server'
const USERNAME_FOCUS_KEY = 'settings-connect-username'
const PASSWORD_FOCUS_KEY = 'settings-connect-password'
const FILE_FOCUS_KEY = 'settings-connect-file'
const CONNECT_FOCUS_KEY = 'settings-connect-submit'

// Which method Connect will actually use — explicit state rather than
// "whichever field happens to be non-empty", which forces an invisible rule
// to pick between a filled-in URL and filled-in credentials. Same rule as
// the setup screen: the active method is the last one the user touched.
type ConnectMode = 'url' | 'xtream'

export interface ConnectResult {
  source: PlaylistSourceRecord
  channels: Channel[]
}

interface Props {
  // 'add' also offers phone pairing (a QR code) — the least painful way to
  // get a long URL onto a TV. 'edit' does not: re-pairing is a way to
  // connect something new, not to correct an existing playlist's details.
  mode: 'add' | 'edit'
  // Pre-fills the form when editing. A stored password is never rendered —
  // see `password` below.
  existing?: PlaylistSourceRecord
  onConnected: (result: ConnectResult) => void
  onCancel: () => void
}

type State = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string }

export function PlaylistConnectDialog({ mode, existing, onConnected, onCancel }: Props) {
  const [urlValue, setUrlValue] = useState(existing?.type === 'm3u-url' ? existing.url : '')
  const [server, setServer] = useState(existing?.type === 'xtream' ? existing.server : '')
  const [username, setUsername] = useState(existing?.type === 'xtream' ? existing.username : '')
  // Deliberately starts EMPTY even when editing an Xtream playlist that has
  // a stored password. Settings never renders a stored credential, in plain
  // text or otherwise; leaving this blank means "keep the password I already
  // have", and typing in it means "use this one instead".
  const [password, setPassword] = useState('')
  const [connectMode, setConnectMode] = useState<ConnectMode>(() => (existing?.type === 'xtream' ? 'xtream' : 'url'))
  const [state, setState] = useState<State>({ status: 'idle' })

  const urlInputRef = useRef<HTMLInputElement>(null)
  const serverInputRef = useRef<HTMLInputElement>(null)
  const usernameInputRef = useRef<HTMLInputElement>(null)
  const passwordInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const keptPassword = existing?.type === 'xtream' ? existing.password : ''

  async function connectFromUrl(url: string): Promise<boolean> {
    if (!url.trim()) return false
    setState({ status: 'loading' })
    try {
      const source = sourceFromUrl(url.trim())
      const channels = await loadChannelsForSource(source)
      // Reported only after a successful fetch/parse/merge. The caller
      // replaces the old playlist at THIS point and not a moment earlier,
      // which is what makes a failed edit a no-op rather than a loss.
      onConnected({ source, channels })
      return true
    } catch (err) {
      setState({ status: 'error', message: connectErrorMessage(err) })
      return false
    }
  }

  // Phone pairing feeds a scanned M3U URL through the exact same connect
  // path as manual entry, and only acks the pairing session once that has
  // actually succeeded — a bad URL leaves the session alive so the user can
  // correct it on their phone instead of rescanning.
  const pairing = usePairingSession(async (m3uUrl, pollSecret) => {
    if (mode !== 'add') return false
    const ok = await connectFromUrl(m3uUrl)
    if (ok) await ackPairing(pollSecret)
    return ok
  })

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setState({ status: 'loading' })
    try {
      onConnected(await loadChannelsFromFile(file))
    } catch (err) {
      setState({ status: 'error', message: connectErrorMessage(err) })
    }
  }

  const xtreamComplete = Boolean(server.trim() && username.trim() && (password.trim() || keptPassword))
  const canConnect = state.status !== 'loading' && (connectMode === 'xtream' ? xtreamComplete : Boolean(urlValue.trim()))

  function handleConnect() {
    if (!canConnect) return
    if (connectMode === 'xtream') {
      const effectivePassword = password.trim() || keptPassword
      // Built as a get.php URL and re-parsed by sourceFromUrl so the
      // provider-login form and the pasted-URL form converge on one code
      // path — and so a server address that turns out not to be an Xtream
      // panel still degrades to a plain M3U URL exactly as it does on the
      // setup screen.
      void connectFromUrl(buildXtreamUrl(server, username, effectivePassword))
      return
    }
    void connectFromUrl(urlValue)
  }

  const urlField = useSpatialTextInput(urlInputRef, {
    focusKey: URL_FOCUS_KEY,
    onEnterPress: () => setConnectMode('url'),
    onArrowPress: (direction) => {
      if (direction === 'right') return true
      if (direction === 'up' || direction === 'left') return false
      return true
    },
  })
  const serverField = useSpatialTextInput(serverInputRef, {
    focusKey: SERVER_FOCUS_KEY,
    onEnterPress: () => setConnectMode('xtream'),
    onArrowPress: (direction) => direction !== 'up',
  })
  const usernameField = useSpatialTextInput(usernameInputRef, {
    focusKey: USERNAME_FOCUS_KEY,
    onEnterPress: () => setConnectMode('xtream'),
  })
  const passwordField = useSpatialTextInput(passwordInputRef, {
    focusKey: PASSWORD_FOCUS_KEY,
    onEnterPress: () => setConnectMode('xtream'),
  })

  // Declared AFTER the text fields on purpose. useModalFocusScope moves
  // focus into the dialog from its own effect, and hook effects within one
  // component run in hook order — declaring it first meant the scope tried
  // to focus preferredChildFocusKey before any of these fields had
  // registered, so the library fell back to whatever child COMPONENT had
  // already registered (the "Use a file" button) and the URL field never
  // got initial focus.
  const { ref, focusKey } = useModalFocusScope({
    focusKey: DIALOG_FOCUS_KEY,
    onClose: onCancel,
    preferredChildFocusKey: connectMode === 'xtream' ? SERVER_FOCUS_KEY : URL_FOCUS_KEY,
  })

  const title = mode === 'add' ? 'Add playlist' : 'Edit connection'
  const showQr = mode === 'add' && pairing.status !== 'error'

  return (
    <div className="settings-overlay">
      <FocusContext.Provider value={focusKey}>
        <div ref={ref} className="settings-dialog wide" role="dialog" aria-label={title}>
          <h2 className="settings-dialog-title">{title}</h2>

          <div className="settings-connect-body">
            <div className="settings-connect-forms">
              <section className={`settings-connect-panel ${connectMode === 'url' ? 'active' : ''}`}>
                <h3 className="settings-connect-panel-title">M3U playlist URL</h3>
                <div ref={urlField.ref} className={`settings-field ${urlField.focused ? 'focused' : ''}`}>
                  <input
                    ref={urlInputRef}
                    className="settings-input"
                    type="text"
                    placeholder="https://provider.com/get.php?..."
                    value={urlValue}
                    onChange={(event) => {
                      setUrlValue(event.target.value)
                      setConnectMode('url')
                    }}
                  />
                </div>
                <p className="settings-connect-hint">Xtream links are detected automatically.</p>
              </section>

              <section className={`settings-connect-panel ${connectMode === 'xtream' ? 'active' : ''}`}>
                <h3 className="settings-connect-panel-title">Provider login</h3>
                <div ref={serverField.ref} className={`settings-field ${serverField.focused ? 'focused' : ''}`}>
                  <input
                    ref={serverInputRef}
                    className="settings-input"
                    type="text"
                    placeholder="Server (https://your-provider.com:port)"
                    value={server}
                    onChange={(event) => {
                      setServer(event.target.value)
                      setConnectMode('xtream')
                    }}
                  />
                </div>
                <div ref={usernameField.ref} className={`settings-field ${usernameField.focused ? 'focused' : ''}`}>
                  <input
                    ref={usernameInputRef}
                    className="settings-input"
                    type="text"
                    placeholder="Username"
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value)
                      setConnectMode('xtream')
                    }}
                  />
                </div>
                <div ref={passwordField.ref} className={`settings-field ${passwordField.focused ? 'focused' : ''}`}>
                  <input
                    ref={passwordInputRef}
                    className="settings-input"
                    type="password"
                    placeholder={keptPassword ? 'Password (unchanged)' : 'Password'}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      setConnectMode('xtream')
                    }}
                  />
                </div>
              </section>
            </div>

            {showQr && (
              <aside className="settings-connect-qr">
                <div className="settings-connect-qr-code">
                  {pairing.status === 'waiting' && pairing.activationUrl ? (
                    <QrCode value={pairing.activationUrl} size={150} />
                  ) : (
                    <p className="settings-connect-hint">Generating code…</p>
                  )}
                </div>
                <p className="settings-connect-hint">Scan with your phone and paste the M3U URL there — no typing on the TV.</p>
              </aside>
            )}
          </div>

          {state.status === 'loading' && <p className="settings-status" role="status">Connecting…</p>}
          {state.status === 'error' && (
            <p className="settings-status error" role="status">
              {state.message}
            </p>
          )}

          <div className="settings-dialog-actions">
            <SettingsAction
              focusKey={FILE_FOCUS_KEY}
              label={mode === 'edit' && existing?.type === 'file' ? 'Choose file' : 'Use a file'}
              onEnter={() => fileInputRef.current?.click()}
              onLeft={() => {}}
            />
            <input ref={fileInputRef} type="file" accept=".m3u,.m3u8" hidden onChange={(event) => void handleFile(event)} />
            <SettingsAction label="Cancel" onEnter={onCancel} />
            <SettingsAction
              focusKey={CONNECT_FOCUS_KEY}
              label={state.status === 'loading' ? 'Connecting…' : 'Connect'}
              tone="primary"
              focusable={canConnect}
              onEnter={handleConnect}
              onRight={() => {}}
            />
          </div>
        </div>
      </FocusContext.Provider>
    </div>
  )
}

// Consumer wording, and never the URL itself — a failed connect message must
// not put a credential-bearing get.php link on screen.
function connectErrorMessage(err: unknown): string {
  if (err instanceof EmptyPlaylistError) return 'That playlist has no channels.'
  return "Couldn't reach that playlist. Check the details and try again."
}
