// @vitest-environment jsdom
//
// Regression coverage for the onboarding flow's SHAPE: five steps since the
// 2026-08-28 pass (Playlist, Sports & leagues, Teams, Home personalisation,
// Countries), and the last one completes onboarding rather than handing off
// to a "You're all set" screen.
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
import { DEFAULT_PREFERENCES, hasCompletedOnboarding, loadPreferences } from '../../data/preferences'
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
  OnboardingSportsScreen: ({
    selectedSports,
    selectedLeagues,
    onToggleSport,
    onToggleLeague,
    onBack,
    onContinue,
  }: {
    selectedSports: Set<string>
    selectedLeagues: Set<string>
    onToggleSport: (id: string) => void
    onToggleLeague: (id: string) => void
    onBack: () => void
    onContinue: () => void
  }) => (
    <div>
      <span data-testid="step">2</span>
      {/* The flow's own starting selection, so "football only, nothing
          preselected" is an assertion about the FLOW's state rather than
          about how the real screen happens to paint a card. */}
      <span data-testid="sports-selected">{[...selectedSports].join(',')}</span>
      <span data-testid="leagues-selected">{[...selectedLeagues].join(',')}</span>
      <button onClick={() => onToggleSport('f1')}>toggle-f1</button>
      <button onClick={() => onToggleLeague('football_premier_league')}>pick-league</button>
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

vi.mock('./OnboardingHomeScreen', () => ({
  OnboardingHomeScreen: ({
    selected,
    onSelect,
    onBack,
    onContinue,
  }: {
    selected: string
    onSelect: (mode: 'all' | 'highlights' | 'favorites_only') => void
    onBack: () => void
    onContinue: () => void
  }) => (
    <div>
      <span data-testid="step">4</span>
      {/* The pre-selected mode, so "there is always exactly one selected"
          and "the recommended one is the default" are assertions about the
          FLOW's state rather than about the screen's rendering. */}
      <span data-testid="home-mode">{selected}</span>
      <button onClick={() => onSelect('favorites_only')}>pick-favorites-only</button>
      <button onClick={() => onSelect('all')}>pick-everything</button>
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
      <span data-testid="step">5</span>
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
  it('declares exactly five steps, without a "You\'re all set" one', () => {
    expect(ONBOARDING_STEPS.map((s) => s.label)).toEqual(['Playlist', 'Sports & leagues', 'Teams', 'Home', 'Countries'])
  })

  it('renders the playlist step in its onboarding variant first', () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    expect(screen.getByTestId('step').textContent).toBe('1')
    expect(screen.getByTestId('setup-variant').textContent).toBe('onboarding')
  })

  it('walks 1 -> 2 -> 3 -> 4 -> 5 and all the way back again', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    expect(screen.getByTestId('step').textContent).toBe('2')
    await click('continue')
    expect(screen.getByTestId('step').textContent).toBe('3')
    await click('continue')
    expect(screen.getByTestId('step').textContent).toBe('4')
    await click('continue')
    expect(screen.getByTestId('step').textContent).toBe('5')
    await click('back')
    expect(screen.getByTestId('step').textContent).toBe('4')
    await click('back')
    expect(screen.getByTestId('step').textContent).toBe('3')
    await click('back')
    expect(screen.getByTestId('step').textContent).toBe('2')
    await click('back')
    expect(screen.getByTestId('step').textContent).toBe('1')
  })

  // The reason this is a step and not a fourth block on Sports & leagues —
  // it comes AFTER the leagues and clubs it is defined in terms of, and
  // before Countries, which is a broadcast-market question rather than a
  // football-interest one.
  it('puts Home personalisation between Teams and Countries', () => {
    expect(ONBOARDING_STEPS.map((s) => s.label).indexOf('Home')).toBe(3)
    expect(ONBOARDING_STEPS[2].label).toBe('Teams')
    expect(ONBOARDING_STEPS[4].label).toBe('Countries')
  })

  it('carries the chosen leagues into the Teams step', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    await click('pick-league')
    await click('continue')
    expect(screen.getByTestId('teams-leagues').textContent).toBe('football_premier_league')
  })
})

// A viewer standing in onboarding is being ASKED. Anything already ticked
// when they arrive is an answer Ninety put in their mouth — see
// ONBOARDING_INITIAL_SPORTS / ONBOARDING_INITIAL_FOOTBALL_LEAGUE_IDS.
describe('what onboarding starts on', () => {
  it('starts with football selected', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    expect(screen.getByTestId('sports-selected').textContent).toBe('football')
  })

  it('does NOT start with F1 selected', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    expect(screen.getByTestId('sports-selected').textContent).not.toContain('f1')
  })

  it('starts with no football leagues selected at all', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    expect(screen.getByTestId('leagues-selected').textContent).toBe('')
  })

  // A viewer who changes nothing on step 2 finishes with exactly what they
  // were shown — football, no leagues — never with the app-wide fallback
  // defaults quietly written on their behalf.
  it('persists football-only with no leagues when the viewer changes nothing', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    await click('continue')
    await click('continue')
    await click('continue')
    await click('finish')

    const prefs = loadPreferences()
    expect(prefs.sports).toEqual(['football'])
    expect(prefs.footballLeagueIds).toEqual([])
  })

  it('still persists F1 and leagues once the viewer actually picks them', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    await click('toggle-f1')
    await click('pick-league')
    await click('continue')
    await click('continue')
    await click('continue')
    await click('finish')

    const prefs = loadPreferences()
    expect(prefs.sports).toEqual(['football', 'f1'])
    expect(prefs.footballLeagueIds).toEqual(['football_premier_league'])
  })

  // DEFAULT_PREFERENCES is the fallback for an install with nothing stored,
  // which is a different question — changing onboarding's starting state
  // must not have moved it.
  it('leaves the app-wide fallback preferences alone', () => {
    expect(DEFAULT_PREFERENCES.sports).toEqual(['football', 'f1'])
    expect(DEFAULT_PREFERENCES.footballLeagueIds).toEqual([
      'football_premier_league',
      'football_champions_league',
    ])
  })
})

describe('finishing onboarding', () => {
  it('completes on the last step — there is no summary screen after Finish', async () => {
    const onDone = vi.fn()
    render(<OnboardingFlow onDone={onDone} />)
    await click('connect')
    await click('continue')
    await click('continue')
    await click('continue')
    await click('finish')

    expect(onDone).toHaveBeenCalledTimes(1)
    expect(hasCompletedOnboarding()).toBe(true)
    // The flow unmounts into whatever the caller navigates to (Home) — it
    // never advances to a step 6 of its own.
    expect(screen.getByTestId('step').textContent).toBe('5')
  })

  it('persists the selections and hands the connected playlist back', async () => {
    const onDone = vi.fn()
    render(<OnboardingFlow onDone={onDone} />)
    await click('connect')
    await click('pick-league')
    await click('continue')
    await click('pick-team')
    await click('continue')
    await click('continue')
    await click('pick-sweden')
    await click('finish')

    const prefs = loadPreferences()
    expect(prefs.sports).toEqual(['football'])
    expect(prefs.footballLeagueIds).toEqual(['football_premier_league'])
    // Detected home country (NO) seeded as primary, then the user's pick.
    expect(prefs.favoriteCountries).toEqual(['Norway', 'Sweden'])
    expect(prefs.streamType).toBe('auto')
    // The dedicated Teams step writes into the SAME preference the old
    // squeezed-in section did — canonical ninety-api ids, never names.
    expect(prefs.favoriteTeamIds).toEqual(['t-glimt'])
    // Untouched on this run, so what lands in storage is the flow's own
    // default rather than the legacy-upgrade value.
    expect(prefs.homeContentMode).toBe('highlights')

    const [channels, source] = onDone.mock.calls[0]
    expect(channels).toHaveLength(1)
    expect(source).toEqual({ type: 'm3u-url', url: 'x' })
  })

  it('finishes with no teams at all — the step is genuinely optional', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    await click('continue')
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
    await click('continue')
    expect(screen.getByTestId('selected').textContent).toBe('Norway')
  })

  it('defaults the Home mode to the recommended one, never to nothing', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    await click('continue')
    await click('continue')
    expect(screen.getByTestId('home-mode').textContent).toBe('highlights')
  })

  it('persists the chosen Home mode', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    await click('continue')
    await click('continue')
    await click('pick-favorites-only')
    await click('continue')
    await click('finish')
    expect(loadPreferences().homeContentMode).toBe('favorites_only')
  })

  it('keeps the chosen Home mode when the user steps back and forward again', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    await click('continue')
    await click('continue')
    await click('pick-favorites-only')
    await click('back')
    await click('continue')
    expect(screen.getByTestId('home-mode').textContent).toBe('favorites_only')
  })

  // The recommended default is what a NEW user gets; 'all' is only ever the
  // answer for a pre-existing install that was never asked (see
  // LEGACY_HOME_CONTENT_MODE). Onboarding must never write the legacy value
  // by accident.
  it('writes the recommended default, not the legacy-upgrade value, when the viewer leaves it alone', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    await click('continue')
    await click('continue')
    await click('continue')
    await click('finish')
    expect(loadPreferences().homeContentMode).toBe('highlights')
  })

  it('can still be set back to Everything', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    await click('continue')
    await click('continue')
    await click('pick-favorites-only')
    await click('pick-everything')
    await click('continue')
    await click('finish')
    expect(loadPreferences().homeContentMode).toBe('all')
  })

  it('saves the Home mode alongside every other selection, not instead of any of them', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    await click('pick-league')
    await click('continue')
    await click('pick-team')
    await click('continue')
    await click('pick-favorites-only')
    await click('continue')
    await click('pick-sweden')
    await click('finish')

    const prefs = loadPreferences()
    expect(prefs.homeContentMode).toBe('favorites_only')
    expect(prefs.sports).toEqual(['football'])
    expect(prefs.footballLeagueIds).toEqual(['football_premier_league'])
    expect(prefs.favoriteTeamIds).toEqual(['t-glimt'])
    expect(prefs.favoriteCountries).toEqual(['Norway', 'Sweden'])
    // Onboarding never asks the technical TV-channel-vs-event-stream
    // question — everyone starts on 'auto'.
    expect(prefs.streamType).toBe('auto')
  })

  // Nothing is written until Finish, which is what lets Back/Forward be
  // free of consequences on every step including this one.
  it('does not persist the Home mode step-by-step', async () => {
    render(<OnboardingFlow onDone={vi.fn()} />)
    await click('connect')
    await click('continue')
    await click('continue')
    await click('pick-favorites-only')
    expect(localStorage.getItem('ninety.sportPreferences')).toBeNull()
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
    await click('continue')
    await click('finish')
    expect(hasCompletedOnboarding()).toBe(true)
    expect(onDone).toHaveBeenCalledWith([], null)
  })
})
