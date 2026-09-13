// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  SamsungAvPlayApi,
  SamsungAvPlayPlaybackCallback,
  SamsungAvPlayState,
  SamsungAvPlayTrackInfo,
} from '../platform/samsungProductApi'
import { createTizenAvPlayer } from './tizenAvPlayer'

interface FakeAvPlay {
  api: SamsungAvPlayApi
  listener: () => SamsungAvPlayPlaybackCallback | null
  open: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  setSelectTrack: ReturnType<typeof vi.fn>
  enableAudioStream: ReturnType<typeof vi.fn>
  disableAudioStream: ReturnType<typeof vi.fn>
}

function fakeAvPlay(options: { prepareFails?: boolean; prepareHangs?: boolean; tracks?: SamsungAvPlayTrackInfo[] } = {}): FakeAvPlay {
  let state: SamsungAvPlayState = 'NONE'
  let callback: SamsungAvPlayPlaybackCallback | null = null
  let currentTracks = options.tracks?.filter((track) => track.type === 'AUDIO').slice(0, 1) ?? []
  const open = vi.fn(() => {
    state = 'IDLE'
  })
  const play = vi.fn(() => {
    state = 'PLAYING'
  })
  const setSelectTrack = vi.fn((type: 'AUDIO' | 'TEXT', index: number) => {
    const selected = options.tracks?.find((track) => track.type === type && track.index === index)
    if (!selected) return
    currentTracks = [...currentTracks.filter((track) => track.type !== type), selected]
  })
  const enableAudioStream = vi.fn()
  const disableAudioStream = vi.fn()
  const api: SamsungAvPlayApi = {
    open,
    close: vi.fn(() => {
      state = 'NONE'
    }),
    prepareAsync: vi.fn((onSuccess, onError) => {
      if (options.prepareHangs) return
      if (options.prepareFails) {
        onError(new Error('unsupported stream'))
      } else {
        state = 'READY'
        onSuccess()
      }
    }),
    play,
    pause: vi.fn(() => {
      state = 'PAUSED'
    }),
    stop: vi.fn(() => {
      state = 'IDLE'
    }),
    getState: () => state,
    setListener: vi.fn((next) => {
      callback = next
    }),
    setDisplayRect: vi.fn(),
    setDisplayMethod: vi.fn(),
    getDuration: () => 0,
    getStreamingProperty: () => '1000|9000',
    getTotalTrackInfo: () => options.tracks ?? [],
    getCurrentStreamInfo: () => currentTracks,
    setSelectTrack,
    setSilentSubtitle: vi.fn(),
    enableAudioStream,
    disableAudioStream,
    jumpForward: vi.fn(),
    jumpBackward: vi.fn(),
    seekTo: vi.fn(),
  }
  return { api, listener: () => callback, open, play, setSelectTrack, enableAudioStream, disableAudioStream }
}

function attach(fake: FakeAvPlay) {
  window.webapis = { avplay: fake.api }
  const container = document.createElement('main')
  const video = document.createElement('video')
  video.className = 'video-el'
  video.muted = true
  Object.defineProperty(video, 'textTracks', {
    configurable: true,
    value: Object.assign([], { addEventListener() {}, removeEventListener() {} }),
  })
  Object.defineProperties(video, {
    play: { configurable: true, value: vi.fn().mockResolvedValue(undefined) },
    pause: { configurable: true, value: vi.fn() },
    load: { configurable: true, value: vi.fn() },
  })
  container.append(video)
  document.body.append(container)
  const player = createTizenAvPlayer()
  player.attach(video)
  return { player, video, container }
}

afterEach(() => {
  delete window.webapis
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Tizen AVPlay adapter', () => {
  it('uses native AVPlay for full-screen playback and publishes progress', async () => {
    const fake = fakeAvPlay()
    const { player, video, container } = attach(fake)

    await player.load('http://provider.example/live/user/pass/10.ts')
    await player.play()
    fake.listener()?.oncurrentplaytime?.(4_500)

    expect(fake.open).toHaveBeenCalledWith('http://provider.example/live/user/pass/10.ts')
    expect(fake.play).toHaveBeenCalledOnce()
    expect(container.querySelector('object[type="application/avplayer"]')).not.toBeNull()
    expect(video.style.visibility).toBe('hidden')
    expect(player.getState()).toMatchObject({ status: 'playing', currentTime: 4.5, muted: false })

    player.dispose()
  })

  it('falls back to the same URL in the HTML player when prepare fails', async () => {
    const fake = fakeAvPlay({ prepareFails: true })
    const { player, video, container } = attach(fake)
    const htmlPlay = vi.mocked(video.play)

    await player.load('https://provider.example/live.mp4')
    await player.play()

    expect(fake.open).toHaveBeenCalledWith('https://provider.example/live.mp4')
    expect(fake.play).not.toHaveBeenCalled()
    expect(htmlPlay).toHaveBeenCalledOnce()
    expect(video.src).toBe('https://provider.example/live.mp4')
    expect(video.style.visibility).toBe('visible')
    expect((container.querySelector('object') as HTMLObjectElement).style.display).toBe('none')

    player.dispose()
  })

  it('stays on HTML for later source failover after native fallback', async () => {
    const fake = fakeAvPlay({ prepareFails: true })
    const { player, video } = attach(fake)

    await player.load('https://provider.example/first.mp4')
    await player.play()
    await player.load('https://provider.example/second.mp4')
    await player.play()

    expect(fake.open).toHaveBeenCalledTimes(1)
    expect(video.src).toBe('https://provider.example/second.mp4')
    expect(video.play).toHaveBeenCalledTimes(2)

    player.dispose()
  })

  it('bounds a missing prepare callback instead of leaving a black loading screen', async () => {
    vi.useFakeTimers()
    const fake = fakeAvPlay({ prepareHangs: true })
    const { player, video } = attach(fake)

    const loading = player.load('https://provider.example/live.mp4')
    await vi.advanceTimersByTimeAsync(12_000)
    await loading
    await player.play()

    expect(video.style.visibility).toBe('visible')
    expect(video.play).toHaveBeenCalledOnce()

    player.dispose()
  })

  it('falls back in place on a runtime AVPlay error without exposing a source error', async () => {
    const fake = fakeAvPlay()
    const { player, video } = attach(fake)

    await player.load('https://provider.example/live.mp4')
    await player.play()
    fake.listener()?.onerror?.('PLAYER_ERROR_CONNECTION_FAILED')
    await Promise.resolve()
    await Promise.resolve()

    expect(video.style.visibility).toBe('visible')
    expect(video.play).toHaveBeenCalledOnce()
    expect(player.getState().status).not.toBe('error')

    player.dispose()
  })

  it('falls back from advancing-but-black AVPlay playback with no active video stream', async () => {
    const fake = fakeAvPlay({
      tracks: [{ type: 'AUDIO', index: 2, extra_info: JSON.stringify({ language: 'eng' }) }],
    })
    const { player, video } = attach(fake)

    await player.load('https://provider.example/v-sport-premier-league.mp4')
    await player.play()
    fake.listener()?.oncurrentplaytime?.(1_000)
    fake.listener()?.oncurrentplaytime?.(2_000)
    fake.listener()?.oncurrentplaytime?.(3_000)
    await Promise.resolve()
    await Promise.resolve()

    expect(video.style.visibility).toBe('visible')
    expect(video.play).toHaveBeenCalledOnce()
    expect(player.getState().status).not.toBe('error')

    player.dispose()
  })

  it('maps AVPlay audio and subtitle tracks and switches by native index', async () => {
    const fake = fakeAvPlay({
      tracks: [
        { type: 'AUDIO', index: 3, extra_info: JSON.stringify({ language: 'nor' }) },
        { type: 'AUDIO', index: 7, extra_info: JSON.stringify({ language: 'swe', title: 'Stadionlyd' }) },
        { type: 'TEXT', index: 11, extra_info: JSON.stringify({ language: 'eng' }) },
      ],
    })
    const { player } = attach(fake)

    await player.load('https://provider.example/live.m3u8')
    expect(player.getState().audioTracks).toEqual([
      { id: 'avplay:AUDIO:3', label: 'Norsk', language: 'nor' },
      { id: 'avplay:AUDIO:7', label: 'Stadionlyd', language: 'swe' },
    ])
    expect(player.getState().activeSubtitleTrack).toBeNull()

    player.setAudioTrack('avplay:AUDIO:7')
    player.setSubtitleTrack('avplay:TEXT:11')

    expect(fake.setSelectTrack).toHaveBeenCalledWith('AUDIO', 7)
    expect(fake.setSelectTrack).toHaveBeenCalledWith('TEXT', 11)
    expect(player.getState().activeAudioTrack).toBe('avplay:AUDIO:7')
    expect(player.getState().activeSubtitleTrack).toBe('avplay:TEXT:11')

    player.setMuted(false)
    expect(fake.enableAudioStream).toHaveBeenCalledOnce()
    expect(player.getState().muted).toBe(false)

    player.dispose()
  })

  it('starts native playback audible and re-arms delayed UHD audio tracks', async () => {
    const fake = fakeAvPlay({
      tracks: [
        { type: 'AUDIO', index: 4, extra_info: JSON.stringify({ language: 'eng' }) },
        { type: 'AUDIO', index: 8, extra_info: JSON.stringify({ language: 'nor' }) },
      ],
    })
    const { player } = attach(fake)

    await player.load('https://provider.example/sky-sports-main-event-uhd.m3u8')
    await player.play()
    fake.listener()?.oncurrentplaytime?.(1_000)
    fake.listener()?.oncurrentplaytime?.(2_000)

    expect(fake.disableAudioStream).not.toHaveBeenCalled()
    expect(fake.enableAudioStream).toHaveBeenCalledTimes(3)
    expect(fake.setSelectTrack).toHaveBeenCalledTimes(3)
    expect(fake.setSelectTrack).toHaveBeenNthCalledWith(1, 'AUDIO', 4)
    expect(fake.setSelectTrack).toHaveBeenNthCalledWith(2, 'AUDIO', 4)
    expect(fake.setSelectTrack).toHaveBeenNthCalledWith(3, 'AUDIO', 4)
    expect(player.getState()).toMatchObject({
      status: 'playing',
      muted: false,
      activeAudioTrack: 'avplay:AUDIO:4',
    })

    player.dispose()
  })

  it('keeps deliberate native mute across a reload and re-arms audio when the viewer unmutes', async () => {
    const fake = fakeAvPlay({
      tracks: [{ type: 'AUDIO', index: 5, extra_info: JSON.stringify({ language: 'eng' }) }],
    })
    const { player } = attach(fake)

    await player.load('https://provider.example/sky-sports-main-event-uhd.m3u8')
    await player.play()
    fake.listener()?.oncurrentplaytime?.(1_000)
    player.setMuted(true)

    await player.load('https://provider.example/sky-sports-main-event-720p.m3u8')
    await player.play()
    expect(fake.disableAudioStream).toHaveBeenCalledTimes(2)
    expect(player.getState().muted).toBe(true)

    player.setMuted(false)
    fake.listener()?.oncurrentplaytime?.(2_000)
    fake.listener()?.oncurrentplaytime?.(3_000)

    expect(fake.setSelectTrack).toHaveBeenLastCalledWith('AUDIO', 5)
    expect(player.getState().muted).toBe(false)

    player.dispose()
  })
})
