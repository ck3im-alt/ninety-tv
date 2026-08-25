// The app's screen vocabulary and the two navigation decisions that are
// worth pinning down outside App.tsx: which screen a launch opens on, and
// where finishing first-run onboarding lands.
//
// Both used to be inline literals in App.tsx, which made them untestable
// without mounting the whole app (hls.js, workers, network and all). They
// are pure functions/constants here instead; App.tsx is their only
// production caller.

// Temporary in-memory screen switcher, standing in for real routing
// (navigation-compose equivalent) until that's built. Playlist, Channels
// filter state, favorites, and recently-watched are all persisted (see
// data/session.ts) so a reload doesn't force reconnecting/re-filtering/
// re-favoriting; only screen/drill-down navigation position resets on
// reload.
export type Screen =
  | 'home'
  | 'setup'
  | 'onboarding'
  | 'browse-cascade'
  | 'channels-favorites'
  | 'channels-recent'
  | 'player'
  | 'multiview'
  | 'event-details'
  | 'competitions'
  | 'settings'

// Where finishing onboarding's last step goes. Deliberately Home, not the
// channel browser: onboarding's whole purpose is personalizing Home (sports
// + leagues + preferred countries all feed useHomeFeed), so dropping the
// user into a raw channel list immediately afterwards would hide the thing
// they just configured. Changed from 'browse-cascade' in the 2026-08-25
// onboarding restructure.
export const SCREEN_AFTER_ONBOARDING: Screen = 'home'

interface InitialScreenInput {
  // AdminPanel's DEV-only one-shot force flag (see core/debugForceScreen.ts),
  // already read out of sessionStorage by the caller. Only honored in DEV.
  forcedScreen: string | null
  isDev: boolean
  // data/preferences.ts's hasCompletedOnboarding().
  onboardingComplete: boolean
}

// A brand-new install opens straight into onboarding — it no longer lands
// on Home first and waits for the user to go looking for Channels. Home
// without preferences is a generic feed; onboarding exists precisely to
// make it not that, so showing Home first both wastes the first impression
// and flashes content that's about to be replaced.
//
// Anyone who has already completed onboarding keeps opening on Home exactly
// as before. The DEV force flag still wins over everything, so AdminPanel's
// "Reset onboarding & preferences" reload behaves the same as it always
// has.
export function resolveInitialScreen({ forcedScreen, isDev, onboardingComplete }: InitialScreenInput): Screen {
  if (isDev && forcedScreen) return forcedScreen as Screen
  return onboardingComplete ? 'home' : 'onboarding'
}
