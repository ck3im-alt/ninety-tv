// Simple outline icons for the onboarding sport-picker. Deliberately
// generic pictograms (ball/flag/hexagon shapes) rather than attempts at
// reproducing any league's or federation's actual trademarked logo.

export function FootballIcon() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="15" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M20 12l6 4.5-2.3 7H16.3L14 16.5 20 12z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M20 12V6.5M23.7 16.5l5-2M23.7 23.5l3.8 4M16.3 23.5l-3.8 4M16.3 16.5l-5-2" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

export function FormulaOneIcon() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="6" y="9" width="4" height="4" fill="currentColor" />
      <rect x="14" y="9" width="4" height="4" fill="currentColor" />
      <rect x="10" y="13" width="4" height="4" fill="currentColor" />
      <rect x="18" y="13" width="4" height="4" fill="currentColor" />
      <rect x="6" y="17" width="4" height="4" fill="currentColor" />
      <rect x="14" y="17" width="4" height="4" fill="currentColor" />
      <path
        d="M8 25c3-2 20-2 24-9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="30" r="3.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="27" cy="30" r="3.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M15 30h9" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

export function StarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 2.5l2.2 4.7 5.1.6-3.8 3.5.9 5.1L10 13.9l-4.4 2.5.9-5.1-3.8-3.5 5.1-.6L10 2.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function TrophyIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M6 3h8v5a4 4 0 0 1-8 0V3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6 4H3v2a3 3 0 0 0 3 3M14 4h3v2a3 3 0 0 1-3 3" stroke="currentColor" strokeWidth="1.1" />
      <path d="M10 12v3M7 17.5h6M8 17.5v-2.5h4v2.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  )
}

export function TuneIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="7" cy="6" r="1.6" fill="currentColor" />
      <circle cx="13" cy="10" r="1.6" fill="currentColor" />
      <circle cx="9" cy="14" r="1.6" fill="currentColor" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 7.3l2.6 2.6L11 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 8h11M9 3.5L13.5 8 9 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function BackArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M14 8H3M7 3.5L2.5 8 7 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
