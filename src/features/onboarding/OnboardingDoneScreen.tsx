import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { OnboardingTopBar } from './OnboardingStepper'
import { ArrowRightIcon, BackArrowIcon } from './sportIcons'
import './onboardingShared.css'
import './OnboardingDoneScreen.css'

interface Props {
  sportsCount: number
  countriesCount: number
  onBack: () => void
  onFinish: () => void
}

function BigCheckIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="2" />
      <path d="M20 33l8 8 16-18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// No reference mockup was given for this step — kept deliberately minimal
// (summary + one CTA) rather than inventing detail the design system
// doesn't actually specify yet.
export function OnboardingDoneScreen({ sportsCount, countriesCount, onBack, onFinish }: Props) {
  const { ref, focusKey } = useFocusable({ focusKey: 'onboarding-done', trackChildren: true })
  const { ref: backRef, focused: backFocused } = useFocusable({ onEnterPress: onBack })
  const { ref: finishRef, focused: finishFocused } = useFocusable({ onEnterPress: onFinish, forceFocus: true })

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} className="onboarding-screen onboarding-done-screen">
        <OnboardingTopBar current={4} />

        <div className="onboarding-done-content">
          <div className="done-check">
            <BigCheckIcon />
          </div>
          <h1 className="onboarding-headline">
            You're <span className="accent">all set</span>
          </h1>
          <p className="onboarding-description done-summary">
            {sportsCount} sport{sportsCount === 1 ? '' : 's'} and {countriesCount} countr
            {countriesCount === 1 ? 'y' : 'ies'} selected. You can change any of this later from settings.
          </p>

          <div className="onboarding-footer-actions done-actions">
            <button ref={backRef} className={`back-button ${backFocused ? 'focused' : ''}`} onClick={onBack}>
              <BackArrowIcon /> Back
            </button>
            <button ref={finishRef} className={`continue-button ${finishFocused ? 'focused' : ''}`} onClick={onFinish}>
              Start Watching <ArrowRightIcon />
            </button>
          </div>
        </div>
      </main>
    </FocusContext.Provider>
  )
}
