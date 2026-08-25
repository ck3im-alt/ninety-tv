// The one focusable wrapper every Settings control goes through, plus the
// shared pane-entry focus key.
//
// Its own module (not settingsPrimitives.tsx) so that file exports only
// components — a hook and a constant living alongside them breaks React Fast
// Refresh for the whole file.
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useFocusScrollIntoView } from '../../core/platform'

// The focus key whichever pane is currently rendered puts on its primary
// entry control. Exactly one pane is mounted at a time, so one shared key is
// unambiguous — and it means "Right from the rail" is a single deterministic
// setFocus rather than a geometric guess into whatever the active pane
// happens to look like.
export const PANE_ENTRY_FOCUS_KEY = 'settings-pane-entry'

export interface SettingsFocusableOptions {
  focusKey?: string
  focusable?: boolean
  onEnter?: () => void
  onFocus?: () => void
  // Each supplied handler CONSUMES that arrow press; directions left
  // undefined fall through to the library's geometric search, which is
  // reliable inside a single column/grid and is what every list here relies
  // on for Up/Down. Cross-region moves (list -> actions, pane -> rail) are
  // always stated explicitly, never inferred.
  onLeft?: () => void
  onRight?: () => void
  onUp?: () => void
  onDown?: () => void
}

export function useSettingsFocusable(options: SettingsFocusableOptions) {
  const { ref, focused } = useFocusable({
    focusKey: options.focusKey,
    focusable: options.focusable ?? true,
    onEnterPress: options.onEnter,
    onFocus: options.onFocus,
    onArrowPress: (direction: string) => {
      const handler =
        direction === 'left'
          ? options.onLeft
          : direction === 'right'
            ? options.onRight
            : direction === 'up'
              ? options.onUp
              : direction === 'down'
                ? options.onDown
                : undefined
      if (!handler) return true
      handler()
      return false
    },
  })
  useFocusScrollIntoView(ref, focused)
  return { ref, focused }
}
