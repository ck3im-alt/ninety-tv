import './NetworkOfflineNotice.css'

// The visible half of Samsung's network-disconnect requirement: when the TV
// loses connectivity the app must SAY SO, rather than leaving the viewer
// looking at a spinner or an empty screen with no explanation.
//
// Deliberately a banner, not a blocking modal or a full-screen takeover:
//
//   - Samsung also requires that the app does not freeze and that remote
//     input keeps working while disconnected. A modal that captures Back
//     and focus would be the freeze. This notice takes no focus and
//     registers no Back handler at all, so every screen underneath stays
//     exactly as navigable as it was — the viewer can still move around
//     Ninety, open Settings, and back out of screens.
//   - Reconnection has to recover into a usable app "without a full-page
//     reload". Since nothing was torn down or covered, recovery is just
//     this banner disappearing — which is what App does the moment the
//     monitor reports 'online' again.
//
// role="status" (not "alert") so a screen reader announces it without
// stealing the current interaction.
export function NetworkOfflineNotice() {
  return (
    <div className="network-offline-notice" role="status">
      <span className="network-offline-dot" aria-hidden="true" />
      <span className="network-offline-text">
        <strong>No network connection.</strong> Ninety will pick up where it left off once the TV is back online.
      </span>
    </div>
  )
}
