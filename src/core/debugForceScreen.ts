// DEV-only, one-shot: AdminPanel sets this in sessionStorage immediately
// before window.location.reload() so App.tsx's initial-screen state knows
// to open straight to a specific screen after the reload (e.g. onboarding),
// instead of always defaulting to Home. Read once and removed by App.tsx's
// own initializer. Lives in its own dependency-free module rather than
// being exported from App.tsx directly -- AdminPanel already imports from
// App.tsx's siblings, and App.tsx imports AdminPanel eagerly, so exporting
// this constant from App.tsx itself would create a circular import.
export const DEBUG_FORCE_SCREEN_KEY = 'ninety.debugForceScreen'
