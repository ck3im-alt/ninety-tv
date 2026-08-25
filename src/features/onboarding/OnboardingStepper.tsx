import { CheckIcon } from './sportIcons'
import './OnboardingStepper.css'

export interface StepDef {
  label: string
}

// Exactly three steps. The old fourth ("You're all set") screen was removed
// in the 2026-08-25 restructure — finishing Countries completes onboarding
// and goes straight to Home, so there is no summary step to announce.
// Labels are deliberately terse: this is a progress indicator read from
// across a room, not a description of each step.
export const ONBOARDING_STEPS: StepDef[] = [{ label: 'Playlist' }, { label: 'Sports & leagues' }, { label: 'Countries' }]

// Purely indicative — not focusable and not interactive. Jumping between
// steps out of order would let someone reach Countries before a playlist
// exists to derive them from, and there is no remote affordance that would
// make a non-linear wizard readable anyway.
export function OnboardingStepper({ current }: { current: number }) {
  return (
    <ol className="onboarding-stepper">
      {ONBOARDING_STEPS.map((step, i) => {
        const stepNum = i + 1
        const state = stepNum < current ? 'done' : stepNum === current ? 'active' : 'pending'
        return (
          <li key={step.label} className={`stepper-item ${state}`}>
            <span className={`stepper-circle ${state}`}>{state === 'done' ? <CheckIcon /> : stepNum}</span>
            <span className={`stepper-label ${state}`}>{step.label}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function OnboardingTopBar({ current }: { current?: number }) {
  return (
    <div className="onboarding-topbar">
      <div className="onboarding-logo">N I N E T Y</div>
      {current != null && <OnboardingStepper current={current} />}
    </div>
  )
}
