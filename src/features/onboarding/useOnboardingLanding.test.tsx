// @vitest-environment jsdom
//
// The rules that keep the remote from stranding a viewer on "Finish setup"
// when a step opens. Every one of these was an observed failure in the
// 1920x1080 pass, not a hypothetical.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { createElement } from 'react'

const setFocus = vi.fn()
const state = { current: '', exists: true }
vi.mock('@noriginmedia/norigin-spatial-navigation', () => ({
  setFocus: (key: string) => setFocus(key),
  getCurrentFocusKey: () => state.current,
  doesFocusableExist: () => state.exists,
}))

const { useOnboardingLanding } = await import('./useOnboardingLanding')

function harness(target: string | null) {
  function Probe({ to }: { to: string | null }) {
    useOnboardingLanding(to)
    return null
  }
  const view = render(createElement(Probe, { to: target }))
  return { setTarget: (to: string | null) => act(() => view.rerender(createElement(Probe, { to }))) }
}

// The claim is deferred one frame so it runs after OnboardingFlow's own
// step-level setFocus — see the hook.
const frame = async () => {
  await act(async () => {
    vi.advanceTimersByTime(32)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  setFocus.mockClear()
  state.current = ''
  state.exists = true
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useOnboardingLanding', () => {
  it('claims focus when it is parked on a shared footer key', async () => {
    state.current = 'onboarding-primary'
    harness('country-Norway')
    await frame()
    expect(setFocus).toHaveBeenCalledWith('country-Norway')
  })

  it('claims focus when nothing has ever been focused', async () => {
    state.current = ''
    harness('country-Norway')
    await frame()
    expect(setFocus).toHaveBeenCalledWith('country-Norway')
  })

  // A viewer who deliberately walked into the content while a catalogue
  // loaded keeps their place.
  it('leaves focus alone when it is on a real control of its own', async () => {
    state.current = 'league-premier'
    harness('country-Norway')
    await frame()
    expect(setFocus).not.toHaveBeenCalled()
  })

  // STEPPING BACK. Back is pressed with focus on a card of the step being
  // left; that card unmounts, but norigin keeps reporting its key until
  // something else takes focus. A name check alone reads that as "the viewer
  // is somewhere real".
  it('claims focus when the reported key belongs to something already unmounted', async () => {
    state.current = 'country-United States'
    state.exists = false
    harness('teamgroup-premier')
    await frame()
    expect(setFocus).toHaveBeenCalledWith('teamgroup-premier')
  })

  it('waits, rather than claiming, while the step has nothing to focus yet', async () => {
    state.current = 'onboarding-primary'
    const { setTarget } = harness(null)
    await frame()
    expect(setFocus).not.toHaveBeenCalled()

    setTarget('teamgroup-premier')
    await frame()
    expect(setFocus).toHaveBeenCalledWith('teamgroup-premier')
  })

  // THE REGRESSION IN THE HOOK ITSELF. `target` changes as catalogues land
  // (the rail resolves before the suggestions), and each change cancels the
  // pending frame. Latching before the claim burned the single attempt on a
  // frame that never ran.
  it('still claims when the target changes before its frame fires', async () => {
    state.current = 'onboarding-primary'
    const { setTarget } = harness('teamgroup-premier')
    // No frame in between — the second target supersedes the first.
    setTarget('suggested-team-arsenal')
    await frame()
    expect(setFocus).toHaveBeenCalledWith('suggested-team-arsenal')
  })

  it('claims exactly once, and not again when the target moves on', async () => {
    state.current = 'onboarding-primary'
    const { setTarget } = harness('teamgroup-premier')
    await frame()
    expect(setFocus).toHaveBeenCalledTimes(1)

    state.current = 'teamgroup-premier'
    setTarget('suggested-team-arsenal')
    await frame()
    expect(setFocus).toHaveBeenCalledTimes(1)
  })

  it('never claims for a step that resolves no target at all', async () => {
    state.current = 'onboarding-primary'
    harness(null)
    await frame()
    await frame()
    expect(setFocus).not.toHaveBeenCalled()
  })
})
