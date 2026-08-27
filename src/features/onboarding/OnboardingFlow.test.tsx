// @vitest-environment jsdom
//
// Regression coverage for the onboarding flow's SHAPE: four steps since the
// 2026-08-26 pass (Playlist, Sports & leagues, Teams, Countries), and the
// last one completes onboarding rather than handing off to a "You're all
// set" screen.
//
// The step screens are replaced with minimal stand-ins so this is a test of
// the FLOW — step order, what finishing writes, and what it hands back —
// rather than of the screens' own rendering. Their real implementations
// pull in network pairing (usePairingSession), the competition catalog
// fetch and the spatial-navigation tree, none of which this behaviour
// depends on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { makeFakeLocalStorage } from '../../core/storage/testFakeLocalStorage'
import { ONBOARDING_STEPS } from './OnboardingStepper'
import { hasCompletedOnboarding, loadPreferences } from '../../data/preferences'
import type { Channel } from '../../data/channel'

vi.mock('../setup/PlaylistSetupScreen', () => ({
  PlaylistSetupScreen: ({
    variant,
    onLoaded,
    onSkip,
  }: {
    variant?: string
    onLoaded: (channels: Channel[], source: unknown) => void
    onSkip?: () => void
  }) => (
    <div>
      <span data-testid="step">1</span>
      <span data-testid="setup-variant">{variant}</span>
      <button onClick={() => onLoaded([{ id: 'c1', name: 'NO Sport', groupTitle: 'NO| Sport' } as Channel], { type: 'm3u-url', url: 'x' })}>
        connect
      </button>
      {onSkip && <button onClick={onSkip}>skip</button>}
    </div>
  ),
}))

vi.mock('./OnboardingSportsScreen', () => ({
  OnboardingSportsScreen: ({ onBack, onContinue }: { onBack: () => void; onContinue: () => void }) => (
    <div>
      <span data-testid="step">2</span>
      <button onClick={onBack}>back</button>
      <button onClick={onContinue}>continue</button>
    </div>
  ),
}))

vi.mock('./OnboardingTeamsScreen', () => ({
  OnboardingTeamsScreen: ({
    selectedLeagues,
    selectedTeams,
    onToggleTeam,
    onBack,
    onContinue,
  }: {
    selectedLeagues: Set<string>
    selectedTeams: Set<string>
    onToggleTeam: (id: string) => void
    onBack: () => void
    onContinue: () => void
  }) => (
    <div>
      <span data-testid="step">3</span>
      {/* Proves the leagues chosen on step 2 reach this step — they ORDER
          the clubs it offers (see teamRail.ts), which is the whole reason
          this step comes after the league one. */}
      <span data-testid="teams-leagues">{[...selectedLeagues].join(',')}</span>
      <span data-testid="teams-selected">{[...selectedTeams].join(',')}</span>
      <button onClick={() => onToggleTeam('t-glimt')}>pick-team</button>
      <button onClick={onBack}>back</button>
      <button onClick={onContinue}>continue</button>
    </div>
  ),
}))

vi.mock('./OnboardingCountriesScreen', () => ({
  OnboardingCountriesScreen: ({
    selectedCountries,
    onToggleCountry,
    onBack,
    onFinish,
  }: {
    selectedCountries: readonly string[]
    onToggleCountry: (name: string) => void
    onBack: () => void
    onFinish: () => void
  }) => (
    <div>
      <span data-testid="step">4</span>
      <span data-testid="selected">{selectedCountries.join(',')}</span>
      <button onClick={() => onToggleCountry('Sweden')}>pick-sweden</button>
      <button onClick={onBack}>back</button>
      <button onClick={onFinish}>finish</button>
    </div>
  ),
}))

// Country detection is exercised on its own in data/viewerCountry.test.ts
// and core/platform/deviceRegion.test.ts — pinned here so this test doesn't
// depend on the host machine's locale.
vi.mock('../../data/useViewerCountry', () => ({ useViewerCountry: () => ({ code: 'NO', source: 'locale' }) }))

const { OnboardingFlow } = await import('./OnboardingFlow')

const click = async (label: string) => {
  await act(async () => {
    screen.getByText(label).click()
  })
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
})

// Auto-cleanup doesn't register itself without vitest's `globals` option
// (this repo doesn't enable it) — without this, renders accumulate in the
// document and every query matches several elements. Same pattern as
// ChannelPlayerScreen.playerIdentity.test.tsx.
afterEach(() => {
  cleanup()
})

describe('onboarding step structure', () => {
  it('declares exactly four steps, without a "You\'re all set" one', () => {
    expect(ONBOARDING_STEPS.map((s) => s.label)).toEqual(['Playlist', 'Sports & leagues', 'Teams', 'Countries'])
  })

  it('renders the playlist step in its onboarding variant first', () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    expect(screen.getByTestId('step').textContent).toBe('1')
    expect(screen.getByTestId('setup-variant').textContent).toBe('onboarding')
  })

  it('walks 1 -> 2 -> 3 -> 4 and all the way back again', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    expect(screen.getByTestId('step').textContent).toBe('2')
    await click('continue')
    expect(screen.getByTestId('step').textContent).toBe('3')
    await click('continue')
    expect(screen.getByTestId('step').textContent).toBe('4')
    await click('back')
    expect(screen.getByTestId('step').textContent).toBe('3')
    await click('back')
    expect(screen.getByTestId('step').textContent).toBe('2')
    await click('back')
    expect(screen.getByTestId('step').textContent).toBe('1')
  })

  it('carries the chosen leagues into the Teams step', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    await click('continue')
    // DEFAULT_PREFERENCES' pre-ticked leagues, unchanged by the stand-in
    // step 2 — the point is that the Teams step receives them at all.
    expect(screen.getByTestId('teams-leagues').textContent).toBe('football_premier_league,football_champions_league')
  })
})

describe('finishing onboarding', () => {
  it('completes on the last step — there is no summary screen after Finish', async () => {
    const onDone = vi.fn()
    render(<OnboardingFlow onDone={onDone} />)
    await click('connect')
    await click('continue')
    await click('continue')
    await click('finish')

    expect(onDone).toHaveBeenCalledTimes(1)
    expect(hasCompletedOnboarding()).toBe(true)
    // The flow unmounts into whatever the caller navigates to (Home) — it
    // never advances to a step 5 of its own.
    expect(screen.getByTestId('step').textContent).toBe('4')
  })

  it('persists the selections and hands the connected playlist back', async () => {
    const onDone = vi.fn()
    render(<OnboardingFlow onDone={onDone} />)
    await click('connect')
    await click('continue')
    await click('pick-team')
    await click('continue')
    await click('pick-sweden')
    await click('finish')

    const prefs = loadPreferences()
    expect(prefs.sports).toEqual(['football', 'f1'])
    expect(prefs.footballLeagueIds.length).toBeGreaterThan(0)
    // Detected home country (NO) seeded as primary, then the user's pick.
    expect(prefs.favoriteCountries).toEqual(['Norway', 'Sweden'])
    expect(prefs.streamType).toBe('auto')
    // The dedicated Teams step writes into the SAME preference the old
    // squeezed-in section did — canonical ninety-api ids, never names.
    expect(prefs.favoriteTeamIds).toEqual(['t-glimt'])

    const [channels, source] = onDone.mock.calls[0]
    expect(channels).toHaveLength(1)
    expect(source).toEqual({ type: 'm3u-url', url: 'x' })
  })

  it('finishes with no teams at all — the step is genuinely optional', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    await click('continue')
    await click('continue')
    await click('finish')
    expect(loadPreferences().favoriteTeamIds).toEqual([])
  })

  it('keeps a followed team when the user steps back and forward again', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    await click('continue')
    await click('pick-team')
    await click('back')
    await click('continue')
    expect(screen.getByTestId('teams-selected').textContent).toBe('t-glimt')
  })

  it('seeds the detected home country as the primary (first) country', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    await click('continue')
    await click('continue')
    expect(screen.getByTestId('selected').textContent).toBe('Norway')
  })

  it('skipping step 1 still reaches the last step and completes, with no playlist', async () => {
    const onDone = vi.fn()
    render(<OnboardingFlow onDone={onDone} />)
    await click('skip')
    expect(screen.getByTestId('step').textContent).toBe('2')
    // Skipping must NOT complete onboarding on its own — only Finish does.
    expect(hasCompletedOnboarding()).toBe(false)

    await click('continue')
    await click('continue')
    await click('finish')
    expect(hasCompletedOnboarding()).toBe(true)
    expect(onDone).toHaveBeenCalledWith([], null)
  })
})
