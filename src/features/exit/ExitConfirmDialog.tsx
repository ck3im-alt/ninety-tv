import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useModalFocusScope } from '../../core/platform'
import './ExitConfirmDialog.css'

// Samsung's Smart TV quality requirement for the hardware Return key:
// pressing it on the app's root/home screen must raise an APP-OWNED exit
// confirmation, and the app may only call
// tizen.application.getCurrentApplication().exit() once the viewer chooses
// the affirmative option. Quitting straight from the keypress — what this
// app did before (see backHandler.ts) — is a certification failure.
//
// Deliberately a plain overlay over the still-mounted screen, not a screen
// of its own: cancelling has to put the viewer back exactly where they
// were, with the focus they had, and useModalFocusScope already implements
// precisely that contract (remember opener -> capture focus -> restore on
// unmount) for every other overlay in this app.
export const EXIT_DIALOG_FOCUS_KEY = 'exit-confirm'
export const EXIT_CANCEL_FOCUS_KEY = 'exit-confirm-cancel'
export const EXIT_CONFIRM_FOCUS_KEY = 'exit-confirm-exit'

interface Props {
  onCancel: () => void
  onConfirm: () => void
}

export function ExitConfirmDialog({ onCancel, onConfirm }: Props) {
  // CANCEL IS THE DEFAULT, always. The destructive option must never be
  // sitting under the OK key when a dialog the viewer did not ask for
  // appears — and this dialog is by definition raised by a press the viewer
  // may well have meant for something else. Stated explicitly rather than
  // left to norigin's geometric "child closest to the origin" resolution,
  // which is a layout detail and would silently flip if the buttons were
  // ever reordered (the same trap the player's toolbar hit — see
  // ChannelPlayerScreen's PLAY_PAUSE_FOCUS_KEY comment).
  //
  // Back/Return while this is open cancels, via useModalFocusScope's own
  // back handler — which registers ABOVE whatever the screen underneath has
  // on the stack, so it wins.
  const { ref, focusKey } = useModalFocusScope({
    focusKey: EXIT_DIALOG_FOCUS_KEY,
    onClose: onCancel,
    preferredChildFocusKey: EXIT_CANCEL_FOCUS_KEY,
  })

  // THE PROVIDER IS LOAD-BEARING, not decoration. Without it the two
  // buttons register at whatever focus parent is ambient rather than as
  // children of this dialog, so `preferredChildFocusKey` has no children to
  // choose from: setFocus('exit-confirm') then resolves to the CONTAINER
  // itself, focus never reaches Cancel, and OK does nothing. (Found exactly
  // that way — see this app's standing rule that preferredChildFocusKey
  // alone is never enough.)
  return (
    <FocusContext.Provider value={focusKey}>
      <div className="exit-confirm-scrim" role="dialog" aria-modal="true" aria-labelledby="exit-confirm-title">
        <div ref={ref} className="exit-confirm">
          <h2 id="exit-confirm-title" className="exit-confirm-title">
            Exit Ninety?
          </h2>
          <div className="exit-confirm-actions">
            <ExitConfirmButton focusKey={EXIT_CANCEL_FOCUS_KEY} label="Cancel" onPress={onCancel} />
            <ExitConfirmButton focusKey={EXIT_CONFIRM_FOCUS_KEY} label="Exit" onPress={onConfirm} variant="danger" />
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  )
}

// Split out so each button owns its own useFocusable — the remote is the
// source of truth here (onEnterPress), and onClick is kept only so the
// dialog stays usable with a mouse in browser dev.
function ExitConfirmButton({
  focusKey,
  label,
  onPress,
  variant,
}: {
  focusKey: string
  label: string
  onPress: () => void
  variant?: 'danger'
}) {
  const { ref, focused } = useFocusable({ focusKey, onEnterPress: onPress })
  return (
    <button
      ref={ref}
      type="button"
      className={`exit-confirm-button${variant === 'danger' ? ' danger' : ''}${focused ? ' focused' : ''}`}
      onClick={onPress}
    >
      {label}
    </button>
  )
}
