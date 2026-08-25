import { describe, expect, it } from 'vitest'
import { SCREEN_AFTER_ONBOARDING, resolveInitialScreen } from './appScreens'

describe('resolveInitialScreen', () => {
  it('opens onboarding on a brand-new install (onboarding not completed)', () => {
    expect(resolveInitialScreen({ forcedScreen: null, isDev: false, onboardingComplete: false })).toBe('onboarding')
  })

  it('opens Home once onboarding has been completed', () => {
    expect(resolveInitialScreen({ forcedScreen: null, isDev: false, onboardingComplete: true })).toBe('home')
  })

  it("DEV's forced screen wins over the onboarding-complete default", () => {
    expect(resolveInitialScreen({ forcedScreen: 'settings', isDev: true, onboardingComplete: true })).toBe('settings')
  })

  it("DEV's forced screen wins over the not-yet-onboarded default too", () => {
    expect(resolveInitialScreen({ forcedScreen: 'home', isDev: true, onboardingComplete: false })).toBe('home')
  })

  it('ignores a forced screen in a production build', () => {
    expect(resolveInitialScreen({ forcedScreen: 'settings', isDev: false, onboardingComplete: true })).toBe('home')
    expect(resolveInitialScreen({ forcedScreen: 'settings', isDev: false, onboardingComplete: false })).toBe('onboarding')
  })
})

describe('SCREEN_AFTER_ONBOARDING', () => {
  // Onboarding personalizes Home; landing in the raw channel browser
  // (the pre-2026-08-25 behaviour) hid the thing the user just configured.
  it('is Home, not the channel browser', () => {
    expect(SCREEN_AFTER_ONBOARDING).toBe('home')
  })
})
