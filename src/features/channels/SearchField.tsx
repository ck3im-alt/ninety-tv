import { useRef, useState } from 'react'
import { useBackHandler, useSpatialTextInput } from '../../core/platform'
import './SearchField.css'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  focusKey?: string
  // Down out of the field into whatever's below it (the country column, or
  // the search-results list once query is non-empty) — the caller knows
  // which, this component doesn't.
  onArrowDown?: () => void
}

// D-pad reaches this field like any other spatial focusable; Enter hands
// off to the real <input> so Tizen's on-screen keyboard appears, same
// bridge PlaylistSetupScreen's M3U URL field pioneered (see
// core/platform/useSpatialTextInput.ts). Previously this was explicitly
// NOT a spatial focusable at all — a prominent Channels feature that was
// simply unreachable by remote.
export function SearchField({ value, onChange, placeholder = 'Search channels, countries or categories', focusKey, onArrowDown }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  // Separate from norigin's own `focused` (spatial focus, which stays on
  // this wrapper the whole time) — this tracks whether the real <input>
  // currently owns DOM focus, i.e. whether Tizen's keyboard is actually up.
  const [nativeFocused, setNativeFocused] = useState(false)

  const { ref, focused } = useSpatialTextInput(inputRef, {
    focusKey,
    onArrowPress: (direction) => {
      if (direction === 'down' && onArrowDown) {
        onArrowDown()
        return false
      }
      return true
    },
  })

  // While the keyboard is up, Back should close it rather than falling
  // through to the screen's own Back handling (clearing the search query,
  // or leaving Channels) — registers (and so takes LIFO priority) strictly
  // while `nativeFocused` is true, which only becomes true well after this
  // screen's own back handler already registered at mount.
  useBackHandler(() => {
    inputRef.current?.blur()
    return true
  }, nativeFocused)

  return (
    <div ref={ref} className={`search-field ${focused ? 'focused' : ''}`}>
      <span className="search-field-icon">⌕</span>
      <input
        ref={inputRef}
        className="search-field-input"
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setNativeFocused(true)}
        onBlur={() => setNativeFocused(false)}
      />
    </div>
  )
}
