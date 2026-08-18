import { CheckIcon } from './sportIcons'
import './OnboardingStepper.css'

export interface StepDef {
  label: string
}

export const ONBOARDING_STEPS: StepDef[] = [
  { label: 'Add your playlist' },
  { label: 'Sports & Leagues' },
  { label: 'Countries' },
  { label: "You're all set" },
]

export function OnboardingStepper({ current }: { current: number }) {
  return (
    <div className="onboarding-stepper">
      {ONBOARDING_STEPS.map((step, i) => {
        const stepNum = i + 1
        const state = stepNum < current ? 'done' : stepNum === current ? 'active' : 'pending'
        return (
          <div key={step.label} className="stepper-item">
            <span className={`stepper-circle ${state}`}>{state === 'done' ? <CheckIcon /> : stepNum}</span>
            <span className={`stepper-label ${state}`}>{step.label}</span>
            {i < ONBOARDING_STEPS.length - 1 && <span className={`stepper-line ${stepNum < current ? 'done' : ''}`} />}
          </div>
        )
      })}
    </div>
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
