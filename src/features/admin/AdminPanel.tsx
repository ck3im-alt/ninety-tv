import { useEffect, useState } from 'react'
import { FocusContext, getCurrentFocusKey, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler } from '../../core/platform'
import { clearAllAppStorage } from '../../core/storage/localStore'
import { hasCompletedOnboarding, loadPreferences } from '../../data/preferences'
import { clearPlaylist, loadFavoriteChannels, loadFavoriteCategories } from '../../data/session'
import type { Channel } from '../../data/channel'
import './AdminPanel.css'

const POPUP_FOCUS_KEY = 'admin-panel'

interface Props {
  // Live in-memory channel count, threaded down from App.tsx (which already
  // holds it) rather than re-reading storage here — the channel cache is
  // async (IndexedDB) now, so there's no synchronous read-back to do this
  // debug display with anymore.
  channels: Channel[]
  onClose: () => void
}

function ActionButton({
  label,
  description,
  onSelect,
  tone = 'default',
}: {
  label: string
  description: string
  onSelect: () => void
  tone?: 'default' | 'danger'
}) {
  const { ref, focused } = useFocusable({ onEnterPress: onSelect })
  return (
    <button ref={ref} className={`admin-action ${tone} ${focused ? 'focused' : ''}`} onClick={onSelect}>
      <span className="admin-action-label">{label}</span>
      <span className="admin-action-desc">{description}</span>
    </button>
  )
}

// Dev/testing-only panel — not part of the NINETY product design, exists
// purely so onboarding/persistence flows can be re-triggered without
// manually digging through devtools localStorage. Reachable via the
// profile avatar in TopNav.
export function AdminPanel({ channels, onClose }: Props) {
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [resyncError, setResyncError] = useState<string | null>(null)
  const savedFavoriteChannels = loadFavoriteChannels()
  const savedFavoriteCategories = loadFavoriteCategories()

  const { ref: closeRef, focused: closeFocused } = useFocusable({ onEnterPress: onClose })
  const { ref: popupRef, focusKey: popupFocusKey } = useFocusable({
    focusKey: POPUP_FOCUS_KEY,
    trackChildren: true,
    isFocusBoundary: true,
  })

  useEffect(() => {
    const previousFocusKey = getCurrentFocusKey()
    void setFocus(POPUP_FOCUS_KEY)
    return () => {
      void setFocus(previousFocusKey)
    }
  }, [])

  useBackHandler(() => {
    onClose()
    return true
  })

  function resetOnboarding() {
    clearAllAppStorage()
    // A full reload is the simplest reliable way back to a true "first
    // launch" state — App.tsx's screen state starts on Setup on load, and
    // PlaylistSetupScreen will re-check hasCompletedOnboarding() once a
    // playlist is connected again.
    window.location.reload()
  }

  async function resyncPlaylist() {
    setResyncError(null)
    // clearPlaylist() now clears IndexedDB first and only removes the
    // localStorage source record once that's confirmed — if it reports
    // failure, the playlist is still intact (nothing was partially
    // destroyed) and reloading would just bring back the same, unresynced
    // cache, so don't reload in that case.
    const cleared = await clearPlaylist()
    if (!cleared) {
      setResyncError("Couldn't clear the cached playlist — nothing was changed. Try again.")
      return
    }
    // Same reload approach as reset — App.tsx has no in-place "forget
    // playlist" action to call into, and a reload is simple/reliable.
    // Onboarding/preferences/filters are untouched, only the cached
    // merged channel list is gone, so the app lands back on Setup asking
    // to reconnect the same playlist.
    window.location.reload()
  }

  return (
    <div className="admin-overlay" onClick={onClose}>
      <FocusContext.Provider value={popupFocusKey}>
        <div ref={popupRef} className="admin-panel" onClick={(e) => e.stopPropagation()}>
          <div className="admin-header">
            <div>
              <h2 className="admin-title">Admin / Debug</h2>
              <p className="admin-note">Testing tools only — not part of the app for real users.</p>
            </div>
            <button ref={closeRef} className={`admin-close ${closeFocused ? 'focused' : ''}`} onClick={onClose}>
              ✕
            </button>
          </div>

          <div className="admin-status">
            <span>Onboarding completed:</span>
            <strong>{hasCompletedOnboarding() ? 'yes' : 'no'}</strong>
            <span>Saved sports:</span>
            <strong>{loadPreferences().sports.join(', ') || '(none)'}</strong>
            <span>Saved football leagues:</span>
            <strong>{loadPreferences().footballLeagueIds.join(', ') || '(none)'}</strong>
            <span>Saved playlist:</span>
            <strong>{channels.length > 0 ? `${channels.length} channels` : '(none)'}</strong>
            <span>Favorite channels:</span>
            <strong>{savedFavoriteChannels.size}</strong>
            <span>Favorite categories:</span>
            <strong>{savedFavoriteCategories.size}</strong>
          </div>

          {resyncError && <p className="admin-note error">{resyncError}</p>}

          <div className="admin-actions">
            <ActionButton
              label="Resync playlist"
              description="Clears only the cached channel list and reloads — re-fetches and re-merges your connected playlist with the latest channel-name/country normalization. Onboarding, preferences, and filters are untouched."
              onSelect={() => void resyncPlaylist()}
            />
            {!confirmingReset ? (
              <ActionButton
                label="Reset onboarding & preferences"
                description="Clears saved sport/league choices, the saved playlist/filters, and the onboarding-complete flag, then reloads. You'll go through setup again from scratch."
                tone="danger"
                onSelect={() => setConfirmingReset(true)}
              />
            ) : (
              <ActionButton
                label="Confirm reset — this reloads the app"
                description="Press again to actually clear storage and reload."
                tone="danger"
                onSelect={resetOnboarding}
              />
            )}
            <ActionButton label="Close" description="Go back without changing anything." onSelect={onClose} />
          </div>
        </div>
      </FocusContext.Provider>
    </div>
  )
}
