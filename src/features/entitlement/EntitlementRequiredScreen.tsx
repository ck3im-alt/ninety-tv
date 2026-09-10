import { setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect } from 'react'
import './EntitlementRequiredScreen.css'

export function EntitlementRequiredScreen({ onRetry, unavailable = false }: { onRetry: () => void; unavailable?: boolean }) {
  const { ref, focused } = useFocusable({ focusKey: 'entitlement-retry', onEnterPress: onRetry })
  useEffect(() => { void setFocus('entitlement-retry') }, [])
  return <main className="entitlement-required">
    <p className="entitlement-wordmark">NINETY</p>
    <section>
      <p className="entitlement-kicker">{unavailable ? 'Connection required' : 'Access paused'}</p>
      <h1>{unavailable ? 'We cannot verify your access.' : 'Your Ninety access has ended.'}</h1>
      <p>{unavailable
        ? 'Check this TV’s connection, then try again. Ninety must verify access before playback.'
        : <>Open <strong>ninety.tv/account</strong> on your phone to manage your subscription. This TV will update automatically.</>}</p>
      <button ref={ref} className={focused ? 'focused' : ''} type="button" onClick={onRetry}>Check again</button>
    </section>
  </main>
}
