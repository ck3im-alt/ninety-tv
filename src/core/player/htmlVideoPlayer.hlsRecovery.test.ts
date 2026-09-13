// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHtmlVideoPlayer } from './htmlVideoPlayer'

const HLS_EVENTS = {
  ERROR: 'hlsError',
  AUDIO_TRACKS_UPDATED: 'hlsAudioTracksUpdated',
  AUDIO_TRACK_SWITCHED: 'hlsAudioTrackSwitched',
} as const

const HLS_ERROR_TYPES = {
  NETWORK_ERROR: 'networkError',
  MEDIA_ERROR: 'mediaError',
  OTHER_ERROR: 'otherError',
} as const

interface FakeErrorData {
  fatal: boolean
  type: string
  details: string
}

class FakeHls {
  static Events = HLS_EVENTS
  static ErrorTypes = HLS_ERROR_TYPES
  static isSupported = () => true
  static instances: FakeHls[] = []

  audioTracks: never[] = []
  audioTrack = -1
  subtitleTrack = -1
  subtitleDisplay = false
  startLoadCalls = 0
  recoverMediaErrorCalls = 0
  private handlers = new Map<string, Array<(event: string, data: FakeErrorData) => void>>()

  constructor() {
    FakeHls.instances.push(this)
  }

  on(event: string, handler: (event: string, data: FakeErrorData) => void): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
  }

  emitError(type: string, details = 'fatal'): void {
    for (const handler of this.handlers.get(HLS_EVENTS.ERROR) ?? []) {
      handler(HLS_EVENTS.ERROR, { fatal: true, type, details })
    }
  }

  loadSource(): void {}
  attachMedia(): void {}
  // Deliberately retain handlers after destroy so the generation guard is
  // exercised against a late queued callback from a superseded instance.
  destroy(): void {}
  startLoad(): void {
    this.startLoadCalls++
  }
  recoverMediaError(): void {
    this.recoverMediaErrorCalls++
  }
}

vi.mock('hls.js', () => ({ default: FakeHls }))

function createVideo(): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'canPlayType', { value: () => '' })
  Object.defineProperty(video, 'textTracks', {
    value: Object.assign([], { addEventListener() {}, removeEventListener() {} }),
    configurable: true,
  })
  Object.defineProperty(video, 'pause', { value: vi.fn() })
  Object.defineProperty(video, 'load', { value: vi.fn() })
  return video
}

async function setup() {
  const player = createHtmlVideoPlayer()
  player.attach(createVideo())
  await player.load('https://provider.example/live.m3u8')
  return { player, hls: FakeHls.instances.at(-1)! }
}

beforeEach(() => {
  FakeHls.instances = []
})

describe('bounded hls.js fatal-error recovery', () => {
  it('tries startLoad once for a fatal network error, then exposes a repeat for source failover', async () => {
    const { player, hls } = await setup()

    hls.emitError(HLS_ERROR_TYPES.NETWORK_ERROR)
    expect(hls.startLoadCalls).toBe(1)
    expect(player.getState().status).toBe('loading')
    expect(player.getState().error).toBeNull()

    hls.emitError(HLS_ERROR_TYPES.NETWORK_ERROR, 'network still down')
    expect(hls.startLoadCalls).toBe(1)
    expect(player.getState()).toMatchObject({ status: 'error', error: { code: 'network', message: 'network still down' } })
    player.dispose()
  })

  it('tries recoverMediaError once for a fatal media error', async () => {
    const { player, hls } = await setup()

    hls.emitError(HLS_ERROR_TYPES.MEDIA_ERROR)
    expect(hls.recoverMediaErrorCalls).toBe(1)
    expect(player.getState().error).toBeNull()

    hls.emitError(HLS_ERROR_TYPES.MEDIA_ERROR, 'decode still broken')
    expect(player.getState()).toMatchObject({ status: 'error', error: { code: 'decode', message: 'decode still broken' } })
    player.dispose()
  })

  it('ignores a late fatal callback from a superseded HLS instance', async () => {
    const { player, hls: first } = await setup()
    await player.load('https://provider.example/replacement.m3u8')

    first.emitError(HLS_ERROR_TYPES.NETWORK_ERROR)

    expect(first.startLoadCalls).toBe(0)
    expect(player.getState().status).toBe('loading')
    expect(player.getState().error).toBeNull()
    player.dispose()
  })
})
