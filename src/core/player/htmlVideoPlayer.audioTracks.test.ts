// @vitest-environment jsdom
//
// Audio-track discovery and switching at the ENGINE layer — the half of
// multi-audio that has to be right before any OSD control means anything.
//
// hls.js is mocked rather than fed a real manifest: the contract under test
// is "what this player does with hls.js's audio-track API and events", and
// jsdom has neither MSE nor a network. The fake mirrors the parts of the
// real API that matter, and deliberately mirrors one non-obvious detail —
// `hls.audioTrack` is an index into `hls.audioTracks` (the renditions in the
// currently selected AUDIO group), while `MediaPlaylist.id` is a separate
// manifest-wide counter. Confusing the two is exactly the bug this player's
// content-derived ids exist to prevent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHtmlVideoPlayer } from './htmlVideoPlayer'
import type { PlayerState } from './types'

// The real string values hls.js uses, so a version bump that renamed them
// would fail here rather than silently stop delivering audio events.
const HLS_EVENTS = {
  ERROR: 'hlsError',
  AUDIO_TRACKS_UPDATED: 'hlsAudioTracksUpdated',
  AUDIO_TRACK_SWITCHED: 'hlsAudioTrackSwitched',
} as const

interface FakeMediaPlaylist {
  id: number
  groupId: string
  name: string
  lang?: string
}

class FakeHls {
  static Events = HLS_EVENTS
  static isSupported = () => true
  static instances: FakeHls[] = []

  // What `hls.audioTracks` returns: the selectable renditions of the
  // CURRENT audio group, not every rendition in the manifest.
  audioTracks: FakeMediaPlaylist[] = []
  // -1 until hls.js settles on a rendition — the real getter's initial value.
  audioTrack = -1
  destroyed = false
  loadedSources: string[] = []
  subtitleTrack = -1
  subtitleDisplay = false

  private handlers = new Map<string, Array<(event: string, data: unknown) => void>>()

  constructor() {
    FakeHls.instances.push(this)
  }

  on(event: string, handler: (event: string, data: unknown) => void): void {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
  }

  loadSource(url: string): void {
    this.loadedSources.push(url)
  }

  attachMedia(): void {}

  destroy(): void {
    this.destroyed = true
    this.handlers.clear()
  }

  emit(event: string, data?: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(event, data)
  }

  // Convenience for the common "the manifest declared these renditions and
  // hls.js picked the DEFAULT one itself" startup sequence.
  declareTracks(tracks: FakeMediaPlaylist[], selectedIndex: number): void {
    this.audioTracks = tracks
    this.emit(HLS_EVENTS.AUDIO_TRACKS_UPDATED, { audioTracks: tracks })
    this.audioTrack = selectedIndex
    this.emit(HLS_EVENTS.AUDIO_TRACK_SWITCHED, tracks[selectedIndex])
  }
}

vi.mock('hls.js', () => ({ default: FakeHls }))

// A V Sport Ultra-shaped manifest: one video presentation, three commentary
// renditions in one AUDIO group. Note the manifest ids do NOT start at 0 —
// hls.js assigns them while parsing EVERY media entry (subtitles included),
// so treating them as array indexes is wrong.
const SCANDI_TRACKS: FakeMediaPlaylist[] = [
  { id: 3, groupId: 'aud', name: 'Norsk', lang: 'nor' },
  { id: 4, groupId: 'aud', name: 'Svenska', lang: 'swe' },
  { id: 5, groupId: 'aud', name: 'Dansk', lang: 'dan' },
]

const HLS_URL = 'https://provider.example/vsport-ultra.m3u8'
const OTHER_HLS_URL = 'https://provider.example/other-channel.m3u8'
const TS_URL = 'https://panel.example/live/user/pass/1234.ts'

// jsdom gives `video.textTracks` as a bare Array with no EventTarget
// methods, unlike the real TextTrackList every browser (including Tizen's
// Chromium) provides. Nothing about subtitles is under test here — this
// only lets attach() bind its listeners the way it does on device instead
// of throwing before it reaches any audio code.
function stubTextTrackList(video: HTMLVideoElement): void {
  Object.defineProperty(video, 'textTracks', {
    value: Object.assign([], { addEventListener() {}, removeEventListener() {} }),
    configurable: true,
  })
}

function createVideo(): HTMLVideoElement {
  const video = document.createElement('video')
  stubTextTrackList(video)
  return video
}

function attachedPlayer() {
  const player = createHtmlVideoPlayer()
  const video = createVideo()
  const states: PlayerState[] = []
  player.subscribe((state) => states.push(state))
  player.attach(video)
  return { player, video, states }
}

// load() awaits a dynamic import before it touches the engine.
async function loadAndGetHls(player: ReturnType<typeof attachedPlayer>['player'], url = HLS_URL): Promise<FakeHls> {
  await player.load(url)
  const hls = FakeHls.instances.at(-1)
  if (!hls) throw new Error('expected an hls.js instance to have been created')
  return hls
}

beforeEach(() => {
  FakeHls.instances = []
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('audio tracks before anything is loaded', () => {
  it('starts with no audio tracks and nothing selected', () => {
    const { player } = attachedPlayer()
    expect(player.getState().audioTracks).toEqual([])
    expect(player.getState().activeAudioTrack).toBeNull()
    player.dispose()
  })
})

describe('HLS audio-track discovery', () => {
  it('turns declared audio renditions into platform-neutral AudioTracks', async () => {
    const { player } = attachedPlayer()
    const hls = await loadAndGetHls(player)

    hls.declareTracks(SCANDI_TRACKS, 0)

    // Labels and languages come from the manifest — nothing is inferred
    // from the channel name.
    expect(player.getState().audioTracks).toEqual([
      { id: 'hls:aud:3', label: 'Norsk', language: 'nor' },
      { id: 'hls:aud:4', label: 'Svenska', language: 'swe' },
      { id: 'hls:aud:5', label: 'Dansk', language: 'dan' },
    ])
    player.dispose()
  })

  it('reflects whichever rendition hls.js selected as the default', async () => {
    const { player } = attachedPlayer()
    const hls = await loadAndGetHls(player)

    // The manifest's DEFAULT is Swedish here — the viewer did not choose it,
    // so the checkmark has to follow the engine rather than position 0.
    hls.declareTracks(SCANDI_TRACKS, 1)

    expect(player.getState().activeAudioTrack).toBe('hls:aud:4')
    player.dispose()
  })

  it('reports no selection while hls.js has not settled on a rendition', async () => {
    const { player } = attachedPlayer()
    const hls = await loadAndGetHls(player)

    // audioTrack is still -1: tracks are known, the choice is not.
    hls.audioTracks = SCANDI_TRACKS
    hls.emit(HLS_EVENTS.AUDIO_TRACKS_UPDATED, { audioTracks: SCANDI_TRACKS })

    expect(player.getState().audioTracks).toHaveLength(3)
    // -1 must not index backwards into the array and pick 'Dansk'.
    expect(player.getState().activeAudioTrack).toBeNull()
    player.dispose()
  })

  it('leaves the list empty for a stream that declares no alternate audio', async () => {
    const { player } = attachedPlayer()
    await loadAndGetHls(player)

    // hls.js deliberately does not dispatch AUDIO_TRACKS_UPDATED when a
    // stream never had alternate audio, so nothing fires at all.
    expect(player.getState().audioTracks).toEqual([])
    expect(player.getState().activeAudioTrack).toBeNull()
    player.dispose()
  })

  it('creates no selectable state for a stream with exactly one rendition', async () => {
    const { player } = attachedPlayer()
    const hls = await loadAndGetHls(player)

    hls.declareTracks([SCANDI_TRACKS[0]], 0)

    // Reported honestly — the stream really does have one rendition — but
    // there is no CHOICE here, which is what the OSD keys its Audio control
    // off (see ChannelPlayerScreen.audioTracks.test.tsx).
    expect(player.getState().audioTracks).toHaveLength(1)
    player.dispose()
  })

  it('derives track identity from the manifest, not from array position', async () => {
    const { player } = attachedPlayer()
    const hls = await loadAndGetHls(player)

    hls.declareTracks(SCANDI_TRACKS, 0)

    // If ids were positional these would be '0'/'1'/'2' and would collide
    // with every other stream's — see the stale-id test below for why that
    // matters.
    expect(player.getState().audioTracks.map((track) => track.id)).toEqual(['hls:aud:3', 'hls:aud:4', 'hls:aud:5'])
    player.dispose()
  })
})

describe('HLS audio-track selection', () => {
  it('selects the correct hls.js track for a given id', async () => {
    const { player } = attachedPlayer()
    const hls = await loadAndGetHls(player)
    hls.declareTracks(SCANDI_TRACKS, 0)

    player.setAudioTrack('hls:aud:5')

    // Index 2 in `audioTracks`, NOT the manifest id 5 — the setter is
    // positional and conflating the two would select the wrong language.
    expect(hls.audioTrack).toBe(2)
    player.dispose()
  })

  it('does not move the checkmark until the engine confirms the switch', async () => {
    const { player } = attachedPlayer()
    const hls = await loadAndGetHls(player)
    hls.declareTracks(SCANDI_TRACKS, 0)

    player.setAudioTrack('hls:aud:4')
    // Asked for, not yet confirmed: hls.js switches asynchronously, and the
    // checkmark means "this is what you are hearing".
    expect(player.getState().activeAudioTrack).toBe('hls:aud:3')

    hls.audioTrack = 1
    hls.emit(HLS_EVENTS.AUDIO_TRACK_SWITCHED, SCANDI_TRACKS[1])
    expect(player.getState().activeAudioTrack).toBe('hls:aud:4')
    player.dispose()
  })

  it('follows a switch hls.js made on its own', async () => {
    const { player } = attachedPlayer()
    const hls = await loadAndGetHls(player)
    hls.declareTracks(SCANDI_TRACKS, 0)

    // e.g. a level switch moving playback to another rendition — nobody
    // pressed anything, and the OSD still has to be right.
    hls.audioTrack = 2
    hls.emit(HLS_EVENTS.AUDIO_TRACK_SWITCHED, SCANDI_TRACKS[2])

    expect(player.getState().activeAudioTrack).toBe('hls:aud:5')
    player.dispose()
  })

  it('ignores an id that is not in the current list', async () => {
    const { player } = attachedPlayer()
    const hls = await loadAndGetHls(player)
    hls.declareTracks(SCANDI_TRACKS, 0)

    player.setAudioTrack('hls:aud:99')
    player.setAudioTrack('')
    player.setAudioTrack('native:0')

    // Untouched: no engine call, no state change, no throw.
    expect(hls.audioTrack).toBe(0)
    expect(player.getState().activeAudioTrack).toBe('hls:aud:3')
    player.dispose()
  })

  it('does not disturb playback, mute or subtitles when switching', async () => {
    const { player, video } = attachedPlayer()
    const hls = await loadAndGetHls(player)
    hls.declareTracks(SCANDI_TRACKS, 0)
    player.setMuted(false)
    const sourcesBefore = [...hls.loadedSources]

    const statusBefore = player.getState().status

    player.setAudioTrack('hls:aud:4')

    expect(hls.loadedSources).toEqual(sourcesBefore) // no reload, no source change
    expect(hls.destroyed).toBe(false) // no engine teardown
    expect(video.muted).toBe(false) // mute untouched
    expect(hls.subtitleTrack).toBe(-1) // subtitles untouched
    expect(hls.subtitleDisplay).toBe(false)
    expect(player.getState().status).toBe(statusBefore) // playback state untouched
    player.dispose()
  })
})

describe('audio state across source changes', () => {
  // The failover case: Ninety rotates between candidate URLs on error, on
  // stall recovery, and on a manual quality pick. Every one of those calls
  // load() again.
  it('clears the previous source audio tracks on a new load', async () => {
    const { player } = attachedPlayer()
    const first = await loadAndGetHls(player)
    first.declareTracks(SCANDI_TRACKS, 0)
    expect(player.getState().audioTracks).toHaveLength(3)

    await player.load(OTHER_HLS_URL)

    expect(player.getState().audioTracks).toEqual([])
    expect(player.getState().activeAudioTrack).toBeNull()
    player.dispose()
  })

  it('never applies an id from the previous source to the new one', async () => {
    const { player } = attachedPlayer()
    const first = await loadAndGetHls(player)
    first.declareTracks(SCANDI_TRACKS, 0)

    const second = await loadAndGetHls(player, OTHER_HLS_URL)
    // A different channel: different group, different manifest ids, and a
    // different ORDER of languages. A positional id would have selected
    // Danish here while the viewer asked for Swedish.
    second.declareTracks(
      [
        { id: 1, groupId: 'audio-grp', name: 'English', lang: 'eng' },
        { id: 2, groupId: 'audio-grp', name: 'Dansk', lang: 'dan' },
      ],
      0,
    )

    player.setAudioTrack('hls:aud:4') // the old stream's Swedish track

    expect(second.audioTrack).toBe(0)
    expect(player.getState().activeAudioTrack).toBe('hls:audio-grp:1')
    player.dispose()
  })

  it('rebuilds the list from the newly loaded source', async () => {
    const { player } = attachedPlayer()
    const first = await loadAndGetHls(player)
    first.declareTracks(SCANDI_TRACKS, 0)

    const second = await loadAndGetHls(player, OTHER_HLS_URL)
    second.declareTracks([{ id: 0, groupId: 'a', name: 'Original', lang: 'eng' }], 0)

    expect(player.getState().audioTracks).toEqual([{ id: 'hls:a:0', label: 'Original', language: 'eng' }])
    player.dispose()
  })

  it('drops audio state entirely on dispose', async () => {
    const { player } = attachedPlayer()
    const hls = await loadAndGetHls(player)
    hls.declareTracks(SCANDI_TRACKS, 0)

    player.dispose()

    expect(player.getState().audioTracks).toEqual([])
    expect(player.getState().activeAudioTrack).toBeNull()
  })
})

describe('engines that cannot enumerate audio tracks', () => {
  // The V Sport Ultra case as Ninety actually receives it from an Xtream
  // panel. mpegts.js's TS demuxer keeps a single `already_has_audio` guard
  // while walking the PMT, so only the FIRST audio elementary stream is ever
  // demuxed; the second and third commentary PIDs never reach MSE, it never
  // reads the ISO 639 language descriptor for audio, and its Player exposes
  // no track API. An empty list is the honest answer, and fabricating rows
  // that cannot be switched would be worse than offering nothing.
  it('reports no tracks for a raw MPEG-TS source', async () => {
    const { player } = attachedPlayer()
    await player.load(TS_URL)

    expect(player.getState().audioTracks).toEqual([])
    expect(player.getState().activeAudioTrack).toBeNull()
    player.dispose()
  })

  it('is a safe no-op when asked to switch on such a source', async () => {
    const { player } = attachedPlayer()
    await player.load(TS_URL)

    expect(() => player.setAudioTrack('hls:aud:3')).not.toThrow()
    expect(player.getState().audioTracks).toEqual([])
    player.dispose()
  })

  it('reports no tracks when the runtime exposes no AudioTrackList at all', async () => {
    // Chromium ships AudioTrackList behind a disabled-by-default flag, so
    // on desktop Chrome and on the Tizen 6.5 (Chromium 76) firmware this
    // app targets, `video.audioTracks` is simply absent. The TypeScript DOM
    // lib declaring it does not make it exist, which is why this is
    // feature-detected rather than cast.
    const player = createHtmlVideoPlayer()
    const video = createVideo()
    Object.defineProperty(video, 'audioTracks', { value: undefined, configurable: true })
    player.attach(video)

    await player.load('https://provider.example/plain.mp4')

    expect(player.getState().audioTracks).toEqual([])
    expect(player.getState().activeAudioTrack).toBeNull()
    player.dispose()
  })

  it('reports no tracks for an empty AudioTrackList', async () => {
    // jsdom's own shape, and the shape a runtime gives before any track is
    // known: present but empty. Nothing to offer, and nothing to fake.
    const { player, video } = attachedPlayer()
    expect((video as unknown as { audioTracks: { length: number } }).audioTracks.length).toBe(0)

    await player.load('https://provider.example/plain.mp4')

    expect(player.getState().audioTracks).toEqual([])
    player.dispose()
  })
})

describe('native AudioTrackList, where a runtime does provide one', () => {
  // Modelled on the spec's AudioTrackList: a positional list whose entries
  // carry a writable `enabled` flag acting as a radio group.
  function withNativeAudioTracks(video: HTMLVideoElement) {
    const listeners = new Map<string, Array<() => void>>()
    const entries = [
      { id: 'a1', label: 'Norsk', language: 'nb', enabled: true },
      { id: 'a2', label: '', language: 'swe', enabled: false },
    ]
    const list = {
      length: entries.length,
      0: entries[0],
      1: entries[1],
      addEventListener(type: string, listener: () => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener])
      },
      fire(type: string) {
        for (const listener of listeners.get(type) ?? []) listener()
      },
    }
    Object.defineProperty(video, 'audioTracks', { value: list, configurable: true })
    return { list, entries }
  }

  it('enumerates and labels them behind the same contract', async () => {
    const player = createHtmlVideoPlayer()
    const video = createVideo()
    const { list } = withNativeAudioTracks(video)
    player.attach(video)
    await player.load('https://provider.example/plain.mp4')
    list.fire('addtrack')

    expect(player.getState().audioTracks).toEqual([
      { id: 'native:a1', label: 'Norsk', language: 'nb' },
      // No usable name on the second entry, so the normalized language name
      // carries the row.
      { id: 'native:a2', label: 'Svenska', language: 'swe' },
    ])
    expect(player.getState().activeAudioTrack).toBe('native:a1')
    player.dispose()
  })

  it('switches by flipping exactly one entry enabled', async () => {
    const player = createHtmlVideoPlayer()
    const video = createVideo()
    const { list, entries } = withNativeAudioTracks(video)
    player.attach(video)
    await player.load('https://provider.example/plain.mp4')
    list.fire('addtrack')

    player.setAudioTrack('native:a2')

    expect(entries.map((entry) => entry.enabled)).toEqual([false, true])
    expect(player.getState().activeAudioTrack).toBe('native:a2')
    player.dispose()
  })

  it('ignores a stale id on the native path too', async () => {
    const player = createHtmlVideoPlayer()
    const video = createVideo()
    const { list, entries } = withNativeAudioTracks(video)
    player.attach(video)
    await player.load('https://provider.example/plain.mp4')
    list.fire('addtrack')

    player.setAudioTrack('native:gone')

    expect(entries.map((entry) => entry.enabled)).toEqual([true, false])
    player.dispose()
  })

  it('does not treat a list it cannot switch as support', async () => {
    const player = createHtmlVideoPlayer()
    const video = createVideo()
    // A runtime that exposes entries WITHOUT a boolean `enabled` can list
    // tracks but cannot select one. Reporting them would put rows in the
    // menu that silently do nothing when pressed.
    Object.defineProperty(video, 'audioTracks', {
      value: { length: 1, 0: { id: 'x', label: 'Norsk', language: 'nor' } },
      configurable: true,
    })
    player.attach(video)
    await player.load('https://provider.example/plain.mp4')

    expect(player.getState().audioTracks).toEqual([])
    player.dispose()
  })
})
