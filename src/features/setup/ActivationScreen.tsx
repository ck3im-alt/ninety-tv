import { useEffect, useMemo, useState } from 'react'
import { setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { getDisplayMacAddress } from '../../core/platform/deviceIdentity'
import { LoadingScreen, nextPaint } from '../../core/ui'
import { connectPlaylistFromUrl } from '../../data/playlists/connectPlaylist'
import type { Channel } from '../../data/channel'
import type { PlaylistSourceRecord } from '../../data/session'
import { QrCode } from './QrCode'
import { ackPairing, usePairingSession } from './usePairingSession'
import './ActivationScreen.css'

const RETRY_FOCUS_KEY = 'activation-retry'

interface Props {
  onImported: (channels: Channel[], source: PlaylistSourceRecord) => Promise<boolean>
  reconnecting?: boolean
}

// The only first-run surface. Account login, legal acceptance, trial
// activation, and playlist credentials all stay on the phone; the TV owns
// only its private poll capability and the resulting device credential.
export function ActivationScreen({ onImported, reconnecting = false }: Props) {
  const mac = useMemo(() => getDisplayMacAddress(), [])
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const pairing = usePairingSession(async (m3uUrl, pollSecret) => {
    setImportError(null)
    setImporting(true)
    await nextPaint()
    try {
      // This is deliberately the existing authoritative path, including its
      // Xtream detection, M3U fallback, parsing, and source construction.
      const { source, channels } = await connectPlaylistFromUrl(m3uUrl)
      const persisted = await onImported(channels, source)
      if (!persisted) {
        setImportError('We could not save this playlist. Please try again from your phone.')
        return false
      }
      // The server clears the credential-bearing URL only after the full
      // existing import + persistence path has succeeded.
      await ackPairing(pollSecret)
      return true
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'We could not import this playlist. Please try again.')
      return false
    } finally {
      setImporting(false)
    }
  })

  useEffect(() => {
    if (pairing.status === 'error') void setFocus(RETRY_FOCUS_KEY)
  }, [pairing.status])

  // Never reveal a first-run shell with an empty QR card. This is the first
  // impression of Ninety, and session creation is a blocking prerequisite,
  // not content that can progressively fill in behind the viewer. The same
  // full-screen treatment covers the phone-to-TV playlist hand-off.
  if (importing) {
    return <LoadingScreen title="Adding your playlist" detail="Organizing your channels for NINETY…" />
  }
  if (pairing.status === 'loading') {
    return (
      <LoadingScreen
        title={reconnecting ? 'Preparing reconnection' : 'Preparing your setup'}
        detail="Creating a secure QR code…"
      />
    )
  }

  return (
    <main className="activation-screen">
      <div className="activation-aurora activation-aurora-one" aria-hidden="true" />
      <div className="activation-aurora activation-aurora-two" aria-hidden="true" />

      <header className="activation-header">
        <div className="activation-brand-mark" aria-hidden="true"><span /></div>
        <p className="activation-wordmark">NINETY</p>
        <p className="activation-header-note">TV SETUP</p>
      </header>

      <section className="activation-content" aria-labelledby="activation-title">
        <div className="activation-copy">
          <p className="activation-kicker">{reconnecting ? 'WELCOME BACK' : 'WELCOME TO NINETY'}</p>
          <h1 id="activation-title">{reconnecting ? 'Reconnect NINETY' : 'Set up NINETY'}</h1>
          <p className="activation-description">
            {reconnecting
              ? 'Scan this QR code to reconnect your playlist and restore access.'
              : 'Scan this QR code to add your playlist and activate your 7-day free trial.'}
          </p>
          <ol className="activation-steps" aria-label="Setup steps">
            <li><span>01</span><strong>Scan with your phone</strong></li>
            <li><span>02</span><strong>Add your playlist</strong></li>
            <li><span>03</span><strong>Start watching</strong></li>
          </ol>
          {importError && <p className="activation-error" role="alert">{importError}</p>}
          {pairing.status === 'error' && (
            <>
              <p className="activation-error" role="alert">We couldn't reach Ninety to create a setup code.</p>
              <ActivationRetryButton onRetry={pairing.retry} />
            </>
          )}
        </div>

        <div className={`activation-code-card ${pairing.status === 'error' ? 'has-error' : ''}`}>
          {!reconnecting && <span className="activation-trial-badge">7 DAYS FREE</span>}
          <div className="activation-code-frame">
            {pairing.status === 'waiting' && pairing.activationUrl ? (
              <QrCode value={pairing.activationUrl} size={390} label="QR code to set up Ninety on this TV" />
            ) : (
              <div className="activation-code-error">
                <span aria-hidden="true">!</span>
                <p>Setup code unavailable</p>
              </div>
            )}
          </div>
          <p className="activation-scan-hint">Open your phone camera and point it at the code</p>
        </div>
      </section>

      <footer className="activation-device">
        <span className="activation-secure"><i aria-hidden="true" /> Secure phone setup</span>
        <span className="activation-device-id">Samsung TV <b>·</b> {mac ? `MAC ${mac}` : 'MAC address unavailable'}</span>
      </footer>
    </main>
  )
}

function ActivationRetryButton({ onRetry }: { onRetry: () => void }) {
  const { ref, focused } = useFocusable({ focusKey: RETRY_FOCUS_KEY, onEnterPress: onRetry })
  return (
    <button ref={ref} className={focused ? 'focused' : ''} type="button" onClick={onRetry}>
      Try again
    </button>
  )
}
