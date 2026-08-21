import { useEffect, type RefObject } from 'react'
import { useFocusable, type UseFocusableConfig } from '@noriginmedia/norigin-spatial-navigation'

// Bridges a real DOM <input> into spatial navigation. Norigin's focus is a
// separate concept from browser DOM focus — pressing OK on a spatially-
// highlighted card doesn't focus the nested native <input> on its own, and
// Samsung's on-screen keyboard only appears for an <input> that actually has
// real DOM focus. Generalizes the pattern PlaylistSetupScreen's M3U URL
// field already used (see the navigation-hardening pass this was pulled out
// during) so every text field in the app — search, stream-code server/
// username/password, and any future one — gets the same, once-reviewed
// behavior:
//
//   D-pad reaches the field (it's a normal spatial focusable) -> Enter
//   hands off to the real <input> (Tizen's keyboard appears) -> spatially
//   navigating away blurs the <input> again, so the remote's OK button
//   doesn't keep reopening the keyboard on a field the user has since left.
export function useSpatialTextInput<P = object>(
  inputRef: RefObject<HTMLInputElement | null>,
  config: UseFocusableConfig<P> = {},
) {
  const result = useFocusable<P>({
    ...config,
    onEnterPress: (props, details) => {
      inputRef.current?.focus()
      config.onEnterPress?.(props, details)
    },
  })
  const { focused } = result
  useEffect(() => {
    if (!focused) inputRef.current?.blur()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused])
  return result
}
