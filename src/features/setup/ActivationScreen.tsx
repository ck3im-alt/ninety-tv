import { useEffect, useMemo, useState } from 'react'
import { setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { getDisplayMacAddress } from '../../core/platform/deviceIdentity'
import { nextPaint } from '../../core/ui'
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

  return (
    <main className="activation-screen">
      <p className="activation-wordmark">NINETY</p>
      <section className="activation-content">
        <div className="activation-copy">
          <p className="activation-kicker">{reconnecting ? 'Reconnect Ninety' : 'Set up Ninety'}</p>
          <h1>{reconnecting ? 'Connect this TV again.' : 'Scan this QR code with your phone to connect this TV.'}</h1>
          <p className="activation-description">
            {importing ? 'Connecting your playlist…' : 'Continue setup securely on your phone. No login or provider password is needed on the TV.'}
          </p>
          {importError && <p className="activation-error" role="alert">{importError}</p>}
          {pairing.status === 'error' && (
            <>
              <p className="activation-error" role="alert">We couldn't reach Ninety to create a setup code.</p>
              <ActivationRetryButton onRetry={pairing.retry} />
            </>
          )}
        </div>

        <div className="activation-code-frame">
          {pairing.status === 'waiting' && pairing.activationUrl ? (
            <QrCode value={pairing.activationUrl} size={390} label="QR code to set up Ninety on this TV" />
          ) : (
            <p>{pairing.status === 'loading' ? 'Generating code…' : 'Setup code unavailable'}</p>
          )}
        </div>
      </section>

      <footer className="activation-device">
        <span>Samsung TV</span>
        <strong>{mac ? `MAC: ${mac}` : 'MAC address unavailable'}</strong>
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
