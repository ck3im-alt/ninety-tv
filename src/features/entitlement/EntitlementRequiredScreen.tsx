import { setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createDevicePurchaseSession, type DevicePurchaseSession } from '../../data/deviceCredential'
import { QrCode } from '../setup/QrCode'
import './EntitlementRequiredScreen.css'

const CHECK_FOCUS_KEY = 'entitlement-check'
const PURCHASE_RETRY_FOCUS_KEY = 'entitlement-purchase-retry'

export function EntitlementRequiredScreen({ onRetry, unavailable = false }: { onRetry: () => void; unavailable?: boolean }) {
  if (unavailable) return <ConnectionRequiredScreen onRetry={onRetry} />
  return <PurchaseRequiredScreen onRetry={onRetry} />
}

function ConnectionRequiredScreen({ onRetry }: { onRetry: () => void }) {
  const { ref, focused } = useFocusable({ focusKey: CHECK_FOCUS_KEY, onEnterPress: onRetry })
  useEffect(() => { void setFocus(CHECK_FOCUS_KEY) }, [])
  return (
    <main className="entitlement-required connection-required">
      <p className="entitlement-wordmark">NINETY</p>
      <section>
        <p className="entitlement-kicker">Connection required</p>
        <h1>We can't verify your Ninety access right now.</h1>
        <p>Check your connection and try again.</p>
        <button ref={ref} className={focused ? 'focused' : ''} type="button" onClick={onRetry}>Check again</button>
      </section>
    </main>
  )
}

function PurchaseRequiredScreen({ onRetry }: { onRetry: () => void }) {
  const [session, setSession] = useState<DevicePurchaseSession | null>(null)
  const [sessionState, setSessionState] = useState<'loading' | 'ready' | 'error'>('loading')
  const generation = useRef(0)

  const loadSession = useCallback(async () => {
    const mine = ++generation.current
    setSessionState('loading')
    try {
      const next = await createDevicePurchaseSession()
      if (mine !== generation.current) return
      setSession(next)
      setSessionState('ready')
    } catch {
      if (mine !== generation.current) return
      setSession(null)
      setSessionState('error')
    }
  }, [])

  useEffect(() => {
    void loadSession()
    return () => { generation.current += 1 }
  }, [loadSession])

  // Keep the same temporary URL for its whole advertised lifetime. A new
  // purchase session is requested only after expiry or an explicit retry,
  // never on the seven-second entitlement poll cadence.
  useEffect(() => {
    if (!session) return
    const remaining = new Date(session.expiresAt).getTime() - Date.now()
    if (!Number.isFinite(remaining)) return
    const timeout = setTimeout(() => void loadSession(), Math.max(0, remaining) + 250)
    return () => clearTimeout(timeout)
  }, [loadSession, session])

  useEffect(() => {
    void setFocus(sessionState === 'error' ? PURCHASE_RETRY_FOCUS_KEY : CHECK_FOCUS_KEY)
  }, [sessionState])

  return (
    <main className="entitlement-required purchase-required">
      <p className="entitlement-wordmark">NINETY</p>
      <div className="purchase-layout">
        <section>
          <p className="entitlement-kicker">Your free trial has ended</p>
          <h1>Like Ninety?</h1>
          <p>Choose a plan to continue watching.</p>
          <p className="purchase-preserved">Your playlist and TV are still connected.</p>
          {sessionState === 'error' && <p className="purchase-error">We couldn't create a purchase code.</p>}
          <div className="purchase-actions">
            {sessionState === 'error' && <PurchaseRetryButton onRetry={loadSession} />}
            <CheckAgainButton onRetry={onRetry} />
          </div>
        </section>

        <div className="purchase-code-column">
          <div className="purchase-code-frame">
            {sessionState === 'ready' && session ? (
              <QrCode value={session.activationUrl} size={340} label="QR code to continue Ninety" />
            ) : (
              <p>{sessionState === 'error' ? 'Purchase code unavailable' : 'Creating code…'}</p>
            )}
          </div>
          <strong>Scan to continue</strong>
        </div>
      </div>
    </main>
  )
}

function CheckAgainButton({ onRetry }: { onRetry: () => void }) {
  const { ref, focused } = useFocusable({ focusKey: CHECK_FOCUS_KEY, onEnterPress: onRetry })
  return <button ref={ref} className={focused ? 'focused' : ''} type="button" onClick={onRetry}>Check again</button>
}

function PurchaseRetryButton({ onRetry }: { onRetry: () => void }) {
  const { ref, focused } = useFocusable({ focusKey: PURCHASE_RETRY_FOCUS_KEY, onEnterPress: onRetry })
  return <button ref={ref} className={focused ? 'focused' : ''} type="button" onClick={onRetry}>Try again</button>
}
