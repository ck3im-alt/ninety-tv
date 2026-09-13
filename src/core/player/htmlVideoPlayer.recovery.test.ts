// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHtmlVideoPlayer } from './htmlVideoPlayer'

function createVideo(): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'textTracks', {
    value: Object.assign([], { addEventListener() {}, removeEventListener() {} }),
    configurable: true,
  })
  video.pause = vi.fn()
  video.load = vi.fn()
  video.play = vi.fn(() => Promise.resolve())
  return video
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('HTML player dead-stream recovery signals', () => {
  it('reports an error when a source never starts instead of loading on black forever', async () => {
    const player = createHtmlVideoPlayer()
    const video = createVideo()
    player.attach(video)
    await player.load('https://provider.example/archive/live.mp4')

    vi.advanceTimersByTime(11_999)
    expect(player.getState().status).toBe('loading')
    vi.advanceTimersByTime(1)
    expect(player.getState()).toMatchObject({
      status: 'error',
      error: { code: 'network', message: 'Stream did not start within 12 seconds' },
    })
    player.dispose()
  })

  it('cancels the startup deadline once playback begins', async () => {
    const player = createHtmlVideoPlayer()
    const video = createVideo()
    player.attach(video)
    await player.load('https://provider.example/archive/live.mp4')
    video.dispatchEvent(new Event('playing'))

    for (let i = 0; i < 20; i++) {
      video.currentTime += 1
      vi.advanceTimersByTime(1_000)
    }
    expect(player.getState().status).toBe('playing')
    expect(player.getState().error).toBeNull()
    player.dispose()
  })

  it('keeps watching after a playing stream enters waiting/rebuffering', async () => {
    const player = createHtmlVideoPlayer()
    const video = createVideo()
    player.attach(video)
    await player.load('https://provider.example/archive/live.mp4')
    video.dispatchEvent(new Event('playing'))
    video.dispatchEvent(new Event('waiting'))

    vi.advanceTimersByTime(7_000)
    expect(player.getState()).toMatchObject({
      status: 'error',
      error: { code: 'stalled', message: 'Playback stalled — no progress detected' },
    })
    player.dispose()
  })

  it('classifies a native decoder failure separately from a network failure', async () => {
    const player = createHtmlVideoPlayer()
    const video = createVideo()
    player.attach(video)
    Object.defineProperty(video, 'error', { value: { code: 3, message: 'decoder rejected stream' }, configurable: true })

    video.dispatchEvent(new Event('error'))

    expect(player.getState()).toMatchObject({ status: 'error', error: { code: 'decode', message: 'decoder rejected stream' } })
    player.dispose()
  })
})
