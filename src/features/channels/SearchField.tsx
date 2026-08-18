import './SearchField.css'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

// Text input, not a spatial-nav focusable — D-pad text entry needs an
// on-screen keyboard, which isn't built yet. Styled via :focus-within so it
// still gets the accent border when a real keyboard/mouse focuses it (dev).
export function SearchField({ value, onChange, placeholder = 'Search channels, countries or categories' }: Props) {
  return (
    <div className="search-field">
      <span className="search-field-icon">⌕</span>
      <input
        className="search-field-input"
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
