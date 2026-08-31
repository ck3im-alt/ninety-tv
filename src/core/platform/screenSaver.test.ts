import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlaybackScreenSaverCoordinator } from './screenSaver'
import type { SamsungAppCommonApi } from './samsungProductApi'

// Samsung's screensaver requirement: disabled while video is actively
// playing, re-enabled when playback stops or pauses. The hard part is
// Multiview — four independent player sessions sharing ONE system-wide
// setting — so most of this file is about the coordination, not the call.

const SCREEN_SAVER_ON = 1
const SCREEN_SAVER_OFF = 0

function createFakeAppCommon() {
  const calls: Array<'on' | 'off'> = []
  const api: SamsungAppCommonApi = {
    AppCommonScreenSaverState: { SCREEN_SAVER_ON, SCREEN_SAVER_OFF },
    setScreenSaver: (state) => {
      calls.push(state === SCREEN_SAVER_OFF ? 'off' : 'on')
    },
  }
  return { api, calls }
}

function createCoordinator() {
  const fake = createFakeAppCommon()
  return { ...fake, coordinator: createPlaybackScreenSaverCoordinator({ getAppCommonApi: () => fake.api }) }
}

describe('playback screensaver coordinator', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('disables the screensaver when a session starts playing', () => {
    const { coordinator, calls } = createCoordinator()

    coordinator.acquire()

    expect(calls).toEqual(['off'])
  })

  it('re-enables the screensaver when the only playing session releases', () => {
    const { coordinator, calls } = createCoordinator()

    const release = coordinator.acquire()
    release()

    expect(calls).toEqual(['off', 'on'])
    expect(coordinator.getActiveCount()).toBe(0)
  })

  it('four Multiview panes produce ONE disable, not four', () => {
    // Repeated identical state must never hammer setScreenSaver.
    const { coordinator, calls } = createCoordinator()

    coordinator.acquire()
    coordinator.acquire()
    coordinator.acquire()
    coordinator.acquire()

    expect(calls).toEqual(['off'])
    expect(coordinator.getActiveCount()).toBe(4)
  })

  it('disposing ONE pane does not re-enable the screensaver while others are still playing', () => {
    // THE failure this whole module exists to prevent: the screensaver
    // coming up over three panes of live video because a fourth was closed.
    const { coordinator, calls } = createCoordinator()
    const releaseA = coordinator.acquire()
    coordinator.acquire()
    coordinator.acquire()
    coordinator.acquire()

    releaseA()

    expect(calls).toEqual(['off'])
    expect(coordinator.getActiveCount()).toBe(3)
  })

  it('re-enables only once the LAST pane releases', () => {
    const { coordinator, calls } = createCoordinator()
    const releases = [coordinator.acquire(), coordinator.acquire(), coordinator.acquire(), coordinator.acquire()]

    for (const release of releases) release()

    expect(calls).toEqual(['off', 'on'])
  })

  it('a release function is idempotent, so pause -> dispose -> unmount drops exactly one lease', () => {
    // usePlayerSession releases on every transition away from 'playing' AND
    // on unmount; the same lease must not be given back twice, or a second
    // pane's lease would be cancelled by the first pane's extra release.
    const { coordinator, calls } = createCoordinator()
    const releaseA = coordinator.acquire()
    coordinator.acquire()

    releaseA()
    releaseA()
    releaseA()

    expect(coordinator.getActiveCount()).toBe(1)
    expect(calls).toEqual(['off'])
  })

  it('releaseAll() restores the screensaver for a hidden or exiting app', () => {
    // A hidden app must never be the reason the TV's screensaver stays off.
    const { coordinator, calls } = createCoordinator()
    coordinator.acquire()
    coordinator.acquire()

    coordinator.releaseAll()

    expect(calls).toEqual(['off', 'on'])
    expect(coordinator.getActiveCount()).toBe(0)
  })

  it('releaseAll() is idempotent — visibilitychange can fire again during exit', () => {
    const { coordinator, calls } = createCoordinator()
    coordinator.acquire()

    coordinator.releaseAll()
    coordinator.releaseAll()
    coordinator.releaseAll()

    expect(calls).toEqual(['off', 'on'])
  })

  it('a lease released after releaseAll() cannot drive the count negative', () => {
    const { coordinator, calls } = createCoordinator()
    const release = coordinator.acquire()

    coordinator.releaseAll()
    release()
    coordinator.acquire()

    expect(coordinator.getActiveCount()).toBe(1)
    expect(calls).toEqual(['off', 'on', 'off'])
  })

  it('a Samsung API failure is logged but never propagates into playback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const coordinator = createPlaybackScreenSaverCoordinator({
      getAppCommonApi: () =>
        ({
          AppCommonScreenSaverState: { SCREEN_SAVER_ON, SCREEN_SAVER_OFF },
          setScreenSaver: () => {
            throw new Error('privilege denied')
          },
        }) as SamsungAppCommonApi,
    })

    expect(() => coordinator.acquire()()).not.toThrow()
    expect(warn).toHaveBeenCalled()
  })

  it('safely no-ops with no Samsung runtime at all (browser dev, unit tests)', () => {
    const coordinator = createPlaybackScreenSaverCoordinator({ getAppCommonApi: () => null })

    expect(() => {
      const release = coordinator.acquire()
      release()
      coordinator.releaseAll()
    }).not.toThrow()
    expect(coordinator.getActiveCount()).toBe(0)
  })
})
