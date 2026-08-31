// WHY THE VIEWER IS ARRIVING AT A CHANNELS SCREEN, when they are arriving
// back rather than arriving fresh.
//
// Cross-screen focus restoration in this app is EXPLICIT. It deliberately
// does not lean on norigin's parent `lastFocusedChildKey`, which restores on
// a 300ms debounce through whichever container happens to be the parent —
// the exact mechanism behind the Settings section-jump bug (see
// core/platform/useFocusRecovery.ts). A remembered "last child" is also the
// wrong idea here even when it works: coming back from the player and coming
// back from the Favorites subview are different journeys that must land in
// different places, and only the screen doing the navigating knows which.
//
// So App states the intent at the moment it navigates, the arriving screen
// applies it exactly once, and it is cleared. Two shapes:
//
//   toolbar   Back out of a Channels SUBVIEW (Favorites, Recently Watched)
//             or out of Settings' Channel visibility, which the Channels
//             toolbar deep-links to. Focus returns to the button that
//             opened it — not the first country, not a channel, not the
//             screen container.
//
//   channel   Back out of the PLAYER. Focus returns to the row for that
//             exact channel, by identity — including mounting it first if
//             the list's virtual window has to move to reach it (see
//             planChannelRestore in virtualWindow.ts).
export type ChannelsToolbarTarget = 'recent' | 'favorites' | 'filters'

export type ChannelsEntryIntent =
  | { kind: 'toolbar'; target: ChannelsToolbarTarget }
  | { kind: 'channel'; channelId: string }

// Stable keys for the three Channels toolbar actions. They exist so an
// intent can name a specific button: the toolbar's buttons were previously
// anonymous focusables, reachable only by geometry, so "return to the
// Favorites button" was not expressible at all.
export const CHANNELS_TOOLBAR_FOCUS_KEYS: Record<ChannelsToolbarTarget, string> = {
  filters: 'cascade-toolbar-filters',
  recent: 'cascade-toolbar-recent',
  favorites: 'cascade-toolbar-favorites',
}
