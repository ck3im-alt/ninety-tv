// The stable focus keys Event Details navigates by, in one place.
//
// This screen deliberately does NOT rely on norigin's geometry search for
// any relationship that has to be right every time: Up from the first row,
// Left/Right between a row and its own favourite star, and where the
// candidate expander hands focus when it replaces itself with rows are all
// stated explicitly (see StreamRow / StreamSections). Geometry still handles
// the ordinary Up/Down run through the list, where it is unambiguous.
//
// Row keys are not listed here — they are `option.key`, derived from the
// stream group itself (see buildEventStreamOptions), which is what makes a
// row addressable across a re-render without depending on its index.

export const SCREEN_FOCUS_KEY = 'event-details-screen'
export const BACK_FOCUS_KEY = 'event-details-back'
// The "N more channels that might have it" expander. One-way: pressing it
// unmounts it and hands focus to the first candidate row it just revealed.
export const CANDIDATE_TOGGLE_FOCUS_KEY = 'event-details-candidate-toggle'

// A row's favourite star, derived from the row's own key — same convention
// as ChannelRow's star. Kept as a function rather than a literal so the two
// sides of the Left/Right pair can never drift apart.
export function favoriteFocusKeyFor(rowFocusKey: string): string {
  return `${rowFocusKey}-favorite`
}
