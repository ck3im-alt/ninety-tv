import { CheckIcon } from './sportIcons'
import './OnboardingStepper.css'

export interface StepDef {
  label: string
}

// Five steps, and still no "You're all set" summary — finishing Countries
// completes onboarding and goes straight to Home (the 2026-08-25
// restructure removed that screen and it is not coming back).
//
// Teams became a step of its own rather than an expandable section under
// the leagues: squeezed beneath an already-tall league picker it had a few
// hundred pixels to work with, which is not enough to choose clubs from
// with a remote. A step gets the whole 1080px canvas, which is what the
// job actually needs — and it makes the flow read as equal-sized decisions
// instead of a cramped afterthought.
//
// Home personalisation (2026-08-28) joined for exactly the same reason, and
// specifically NOT as a fourth block on Sports & leagues — that step is a
// fixed 1080p layout whose league browser already claims all the leftover
// height. It sits after Teams because the modes are defined relative to the
// leagues and clubs just chosen, and before Countries, which is a question
// about broadcast markets rather than football interest.
//
// Labels are deliberately terse: this is a progress indicator read from
// across a room, not a description of each step.
export const ONBOARDING_STEPS: StepDef[] = [
  { label: 'Playlist' },
  { label: 'Sports & leagues' },
  { label: 'Teams' },
  { label: 'Home' },
  { label: 'Countries' },
]

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
