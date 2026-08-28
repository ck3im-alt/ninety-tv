import { useCallback, useMemo } from 'react'
import { FocusContext, useFocusable, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler, useFocusScrollIntoView } from '../../core/platform'
import { verticalNeighbour, type FocusChain } from './focusChain'
import { useOnboardingLanding } from './useOnboardingLanding'
import { OnboardingTopBar } from './OnboardingStepper'
import { BLOCK_ARROW } from './SelectableCard'
import { ONBOARDING_PRIMARY_FOCUS_KEY, OnboardingFooter } from './OnboardingActions'
import { CheckIcon } from './sportIcons'
import { HOME_CONTENT_MODE_CHOICES } from '../../data/sports/homeContentModeChoices'
import type { HomeContentMode } from '../../data/preferences'
import './onboardingShared.css'
import './OnboardingHomeScreen.css'

// ONBOARDING STEP 4 — HOME PERSONALISATION.
//
// A STEP OF ITS OWN, deliberately, and not a fourth block on the Sports &
// leagues step. That screen is a fixed 1080p layout — sport toggles, a
// pinned recommendation row, and an always-open league browser that claims
// exactly the leftover height — so anything added to it comes straight out
// of the browser's own space and reintroduces the scrolling, layout
// movement and hard-to-aim remote navigation the 2026-08-25 restructure
// removed on purpose (see onboardingShared.css's note on the centring
// hazard). Three large rows on their own canvas cost one extra Continue
// press and are readable from a sofa.
//
// It sits AFTER Teams and BEFORE Countries because it is a question about
// football interest, and it only makes sense once the viewer has said which
// leagues and clubs they follow — the modes are defined relative to those
// answers. Countries is a different subject entirely (which broadcast
// market to prefer), which is why it stays last.
//
// Nothing here is persisted: OnboardingFlow owns the selection and only
// finish() writes, exactly like every other step.
const MODE_DESCRIPTIONS: Record<HomeContentMode, string> = {
  all: 'All relevant football can appear. Your favourites are ranked higher.',
  highlights: 'Your favourites first, plus major matches from elsewhere.',
  favorites_only: 'Only matches from leagues you follow.',
}

const modeFocusKey = (mode: HomeContentMode) => `home-mode-${mode}`

// Every row is a full-width single-column stack, so the chain is simply one
// key per row — the same model every other onboarding surface uses (see
// focusChain.ts), which is what makes Up/Down and the escape into the
// footer behave without naming specific rows anywhere.
const CHAIN: FocusChain = HOME_CONTENT_MODE_CHOICES.map((choice) => [modeFocusKey(choice.id)])

interface Props {
  selected: HomeContentMode
  onSelect: (mode: HomeContentMode) => void
  onBack: () => void
  onContinue: () => void
}

export function OnboardingHomeScreen({ selected, onSelect, onBack, onContinue }: Props) {
  const arrowsFor = useCallback(
    (key: string) => ({
      onArrowUp: () => {
        const target = verticalNeighbour(CHAIN, key, 'up')
        if (target) void setFocus(target)
      },
      onArrowDown: () => {
        void setFocus(verticalNeighbour(CHAIN, key, 'down') ?? ONBOARDING_PRIMARY_FOCUS_KEY)
      },
      // Full-width rows: there is nothing to either side, ever. Consumed
      // rather than left to norigin's search, which would escape to the
      // screen root and draw no focus ring at all (see BLOCK_ARROW).
      onArrowLeft: BLOCK_ARROW,
      onArrowRight: BLOCK_ARROW,
    }),
    [],
  )

  // Available from the very first render — this step has no fetch of any
  // kind — but still routed through useOnboardingLanding, because arriving
  // here means pressing OK on the previous step's Continue, which leaves
  // focus on a footer key this step immediately re-registers under the same
  // name. Without this the viewer lands on Continue and can skip the
  // question without ever looking at it.
  const landingFocusKey = modeFocusKey(HOME_CONTENT_MODE_CHOICES[0].id)
  useOnboardingLanding(landingFocusKey)

  // Nothing on this step opens or closes, so Back means the previous step.
  useBackHandler(() => {
    onBack()
    return true
  })

  const { ref, focusKey } = useFocusable({
    focusKey: 'onboarding-home',
    trackChildren: true,
    preferredChildFocusKey: landingFocusKey,
  })

  const rows = useMemo(
    () =>
      HOME_CONTENT_MODE_CHOICES.map((choice) => ({
        ...choice,
        description: MODE_DESCRIPTIONS[choice.id],
        focusKey: modeFocusKey(choice.id),
      })),
    [],
  )

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} className="onboarding-screen">
        <OnboardingTopBar current={4} />

        <div className="onboarding-heading">
          <h1 className="onboarding-headline">
            Choose what appears on your <span className="accent">Home</span>
          </h1>
          <p className="onboarding-description">
            Your leagues and teams always rank highly. Choose how much football from elsewhere Ninety should surface.
          </p>
        </div>

        <div className="onboarding-body">
          <div className="home-mode-list" role="radiogroup" aria-label="Home recommendations">
            {rows.map((row) => (
              <HomeModeRow
                key={row.id}
                focusKey={row.focusKey}
                label={row.label}
                description={row.description}
                recommended={row.recommended}
                selected={selected === row.id}
                onSelect={() => onSelect(row.id)}
                arrows={arrowsFor(row.focusKey)}
              />
            ))}
          </div>
        </div>

        <OnboardingFooter
          onBack={onBack}
          primary={{ label: 'Continue', onPress: onContinue }}
          upFocusKey={modeFocusKey(HOME_CONTENT_MODE_CHOICES[HOME_CONTENT_MODE_CHOICES.length - 1].id)}
        />
      </main>
    </FocusContext.Provider>
  )
}

// A RADIO, NOT A CHECKBOX — and not SelectableCard, which is a toggle: its
// checkbox mark and its onToggle contract both say "this can be off". There
// is always exactly one Home mode selected, so pressing OK on the chosen row
// is a no-op rather than a way to end up with none.
function HomeModeRow({
  focusKey,
  label,
  description,
  recommended,
  selected,
  onSelect,
  arrows,
}: {
  focusKey: string
  label: string
  description: string
  recommended: boolean
  selected: boolean
  onSelect: () => void
  arrows: {
    onArrowUp: () => void
    onArrowDown: () => void
    onArrowLeft: () => void
    onArrowRight: () => void
  }
}) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onSelect,
    onArrowPress: (direction) => {
      if (direction === 'up') arrows.onArrowUp()
      else if (direction === 'down') arrows.onArrowDown()
      else if (direction === 'left') arrows.onArrowLeft()
      else if (direction === 'right') arrows.onArrowRight()
      return false
    },
  })
  useFocusScrollIntoView(ref, focused)

  return (
    <div
      ref={ref}
      role="radio"
      aria-checked={selected}
      className={`home-mode-row ${selected ? 'selected' : ''} ${focused ? 'focused' : ''}`}
      onClick={onSelect}
    >
      <span className="home-mode-mark">{selected && <CheckIcon />}</span>
      <span className="home-mode-text">
        <span className="home-mode-label">
          {label}
          {recommended && <span className="home-mode-recommended">Recommended</span>}
        </span>
        <span className="home-mode-description">{description}</span>
      </span>
    </div>
  )
}
