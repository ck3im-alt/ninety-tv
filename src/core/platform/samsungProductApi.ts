// One feature-detected accessor per Samsung Product API surface this app
// uses, and nothing else.
//
// `webapis` is injected by the Samsung TV web runtime, NOT by Tizen's own
// `tizen` namespace and NOT by any browser. Every unit test, every
// `vite dev` session and every non-Samsung target therefore has no
// `window.webapis` at all — so these must be probes that return null, never
// assumptions that throw. That is the same rule keys.ts/deviceRegion.ts
// already follow for `window.tizen`.
//
// Kept as accessors rather than cached module-level constants because the
// runtime injects `webapis` asynchronously on some firmware: reading it
// once at module-evaluation time can legitimately observe `undefined` on a
// TV that will have it a moment later.

export interface SamsungNetworkApi {
  // Samsung's own enum. Only the two gateway states are consumed here; the
  // rest are declared so a narrowing switch reads honestly.
  NetworkState: {
    GATEWAY_DISCONNECTED: number
    GATEWAY_CONNECTED: number
    [key: string]: number
  }
  isConnectedToGateway(): boolean
  addNetworkStateChangeListener(callback: (state: number) => void): number
  removeNetworkStateChangeListener(listenerId: number): void
}

export interface SamsungAppCommonApi {
  AppCommonScreenSaverState: {
    SCREEN_SAVER_ON: number
    SCREEN_SAVER_OFF: number
    [key: string]: number
  }
  setScreenSaver(state: number, callback?: (result: unknown) => void): void
}

export type SamsungAvPlayState = 'NONE' | 'IDLE' | 'READY' | 'PLAYING' | 'PAUSED'
export type SamsungAvPlayTrackType = 'VIDEO' | 'AUDIO' | 'TEXT'

export interface SamsungAvPlayTrackInfo {
  type: SamsungAvPlayTrackType
  index: number
  extra_info?: string
}

export interface SamsungAvPlayPlaybackCallback {
  onbufferingstart?(): void
  onbufferingprogress?(percent: number): void
  onbufferingcomplete?(): void
  oncurrentplaytime?(milliseconds: number): void
  onevent?(eventType: string, eventData: string): void
  onstreamcompleted?(): void
  onerror?(eventType: string): void
  onerrormsg?(eventType: string, errorMessage: string): void
  onsubtitlechange?(duration: number, text: string, data3: unknown, data4: unknown): void
  ondrmevent?(drmEvent: string, drmData: string): void
  onresourceconflicted?(): void
}

// Deliberately limited to the AVPlay surface Ninety uses. Samsung injects
// this as one process-global native player, so callers must feature-detect
// it and reserve it for one full-screen session at a time.
export interface SamsungAvPlayApi {
  open(url: string): void
  close(): void
  prepareAsync(onSuccess: () => void, onError: (error: unknown) => void): void
  play(): void
  pause(): void
  stop(): void
  getState(): SamsungAvPlayState
  setListener(listener: SamsungAvPlayPlaybackCallback): void
  setDisplayRect(x: number, y: number, width: number, height: number): void
  setDisplayMethod(displayMode: 'PLAYER_DISPLAY_MODE_LETTER_BOX' | 'PLAYER_DISPLAY_MODE_FULL_SCREEN' | 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO'): void
  getDuration(): number
  getStreamingProperty(property: string): string
  getTotalTrackInfo(): SamsungAvPlayTrackInfo[]
  getCurrentStreamInfo(): SamsungAvPlayTrackInfo[]
  setSelectTrack(type: 'AUDIO' | 'TEXT', index: number): void
  setSilentSubtitle(silent: boolean): void
  enableAudioStream(): void
  disableAudioStream(): void
  jumpForward(milliseconds: number): void
  jumpBackward(milliseconds: number): void
  seekTo(milliseconds: number, onSuccess?: () => void, onError?: (error: unknown) => void): void
}

function webapis(): Partial<SamsungWebapis> | null {
  if (typeof window === 'undefined') return null
  return window.webapis ?? null
}

// Null on anything that is not a Samsung TV, and also null on a Samsung TV
// whose firmware exposes `webapis` without the network module — both are
// "cannot ask the platform", which callers must already handle.
export function getSamsungNetworkApi(): SamsungNetworkApi | null {
  const api = webapis()?.network
  if (!api) return null
  if (typeof api.addNetworkStateChangeListener !== 'function') return null
  if (typeof api.isConnectedToGateway !== 'function') return null
  if (!api.NetworkState) return null
  return api as SamsungNetworkApi
}

export function getSamsungAppCommonApi(): SamsungAppCommonApi | null {
  const api = webapis()?.appcommon
  if (!api) return null
  if (typeof api.setScreenSaver !== 'function') return null
  if (!api.AppCommonScreenSaverState) return null
  return api as SamsungAppCommonApi
}

export function getSamsungAvPlayApi(): SamsungAvPlayApi | null {
  const api = webapis()?.avplay
  if (!api || typeof api !== 'object') return null
  const candidate = api as Partial<SamsungAvPlayApi>
  if (typeof candidate.open !== 'function') return null
  if (typeof candidate.close !== 'function') return null
  if (typeof candidate.prepareAsync !== 'function') return null
  if (typeof candidate.play !== 'function') return null
  if (typeof candidate.setListener !== 'function') return null
  return candidate as SamsungAvPlayApi
}
