// The two small overlays Settings needs: a destructive-action confirmation
// and a single-field text prompt (renaming a playlist).
//
// Both go through useModalFocusScope, the same shared lifecycle every other
// overlay in this app uses (Filter, Admin, the player's popups): focus is
// captured into the dialog, Back closes it, the opener gets focus back on
// close, and isFocusBoundary keeps arrow keys from wandering out into the
// still-mounted screen behind it. Never window.confirm() — it isn't
// focusable with a remote, isn't styled, and on Tizen isn't reliably
// dismissable at all.
import { useRef, useState } from 'react'
import { FocusContext } from '@noriginmedia/norigin-spatial-navigation'
import { useModalFocusScope, useSpatialTextInput } from '../../core/platform'
import { SettingsAction } from './settingsPrimitives'

const CONFIRM_FOCUS_KEY = 'settings-confirm-dialog'
const CONFIRM_CANCEL_FOCUS_KEY = 'settings-confirm-cancel'
const CONFIRM_ACCEPT_FOCUS_KEY = 'settings-confirm-accept'

export function SettingsConfirmDialog({
  title,
  body,
  confirmLabel,
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  title: string
  body: string
  confirmLabel: string
  tone?: 'primary' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}) {
  const { ref, focusKey } = useModalFocusScope({
    focusKey: CONFIRM_FOCUS_KEY,
    onClose: onCancel,
    // Cancel, never the destructive action: a stray Enter on a dialog the
    // user didn't expect must not delete their playlist.
    preferredChildFocusKey: CONFIRM_CANCEL_FOCUS_KEY,
  })

  return (
    <div className="settings-overlay">
      <FocusContext.Provider value={focusKey}>
        <div ref={ref} className="settings-dialog" role="alertdialog" aria-label={title}>
          <h2 className="settings-dialog-title">{title}</h2>
          <p className="settings-dialog-body">{body}</p>
          <div className="settings-dialog-actions">
            <SettingsAction focusKey={CONFIRM_CANCEL_FOCUS_KEY} label="Cancel" onEnter={onCancel} onLeft={() => {}} />
            <SettingsAction focusKey={CONFIRM_ACCEPT_FOCUS_KEY} label={confirmLabel} tone={tone} onEnter={onConfirm} onRight={() => {}} />
          </div>
        </div>
      </FocusContext.Provider>
    </div>
  )
}

const PROMPT_FOCUS_KEY = 'settings-prompt-dialog'
const PROMPT_INPUT_FOCUS_KEY = 'settings-prompt-input'
const PROMPT_SAVE_FOCUS_KEY = 'settings-prompt-save'

export function SettingsPromptDialog({
  title,
  hint,
  initialValue,
  confirmLabel = 'Save',
  onSubmit,
  onCancel,
}: {
  title: string
  hint?: string
  initialValue: string
  confirmLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  // Spatial focus and DOM focus are separate concepts — pressing OK on the
  // highlighted field is what has to focus the native <input>, which is in
  // turn the only thing that opens Samsung's on-screen keyboard. See
  // useSpatialTextInput.
  const { ref: fieldRef, focused: fieldFocused } = useSpatialTextInput(inputRef, {
    focusKey: PROMPT_INPUT_FOCUS_KEY,
    onArrowPress: (direction) => direction !== 'down',
  })

  // Declared AFTER the field: useModalFocusScope focuses
  // preferredChildFocusKey from its own effect, and hook effects run in hook
  // order within a component — declared first, it would run before the field
  // above had registered and initial focus would land on a button instead.
  const { ref, focusKey } = useModalFocusScope({
    focusKey: PROMPT_FOCUS_KEY,
    onClose: onCancel,
    preferredChildFocusKey: PROMPT_INPUT_FOCUS_KEY,
  })

  const canSubmit = value.trim().length > 0

  return (
    <div className="settings-overlay">
      <FocusContext.Provider value={focusKey}>
        <div ref={ref} className="settings-dialog" role="dialog" aria-label={title}>
          <h2 className="settings-dialog-title">{title}</h2>
          {hint && <p className="settings-dialog-body">{hint}</p>}
          <div ref={fieldRef} className={`settings-field ${fieldFocused ? 'focused' : ''}`}>
            <input
              ref={inputRef}
              className="settings-input"
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <div className="settings-dialog-actions">
            <SettingsAction label="Cancel" onEnter={onCancel} onLeft={() => {}} />
            <SettingsAction
              focusKey={PROMPT_SAVE_FOCUS_KEY}
              label={confirmLabel}
              tone="primary"
              // Unfocusable rather than merely styled-disabled while empty:
              // parking the highlight on a control that does nothing is the
              // TV equivalent of a dead end.
              focusable={canSubmit}
              onEnter={() => canSubmit && onSubmit(value.trim())}
              onRight={() => {}}
            />
          </div>
        </div>
      </FocusContext.Provider>
    </div>
  )
}
