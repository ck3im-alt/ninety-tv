// The ONE ordered list of Home content-mode choices, with the names Ninety
// calls them.
//
// Two surfaces ask the same question — the onboarding step and Settings'
// Personalisation pane — and they must not be able to drift: an order,
// a name or a recommendation that differs between first-run and Settings
// reads as two different features. So the SHARED half (which modes exist,
// in what order, what each is called, which one is recommended) lives here,
// and each surface supplies only its own DESCRIPTION, because the sentence
// that belongs under a first-run card is not the sentence that belongs in a
// settings row.
//
// It sits in the data layer beside the preference it names rather than under
// either feature, for the same reason editorialCompetitions.ts does: neither
// feature may import from the other, and a copy in each is a drift waiting
// to happen. The rules these choices SELECT are in homeContentPolicy.ts;
// nothing here decides anything.
import { HOME_CONTENT_MODES, RECOMMENDED_HOME_CONTENT_MODE, type HomeContentMode } from '../preferences'

export interface HomeContentModeChoice {
  id: HomeContentMode
  label: string
  // Marked in both surfaces. Exactly one choice carries it — see
  // RECOMMENDED_HOME_CONTENT_MODE, which is also DEFAULT_PREFERENCES'
  // new-install value, so the badge and the default can never disagree.
  recommended: boolean
}

// Broadest first, narrowest last. A reading order, not a ranking: it goes
// from "show me everything" to "show me only mine" so the three rows form
// one continuum a viewer can scan in a single pass with a remote.
const LABELS: Record<HomeContentMode, string> = {
  all: 'Everything',
  highlights: 'My leagues + highlights',
  favorites_only: 'My leagues only',
}

export const HOME_CONTENT_MODE_CHOICES: readonly HomeContentModeChoice[] = HOME_CONTENT_MODES.map((id) => ({
  id,
  label: LABELS[id],
  recommended: id === RECOMMENDED_HOME_CONTENT_MODE,
}))
