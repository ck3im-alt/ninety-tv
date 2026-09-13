// Structured, per-engine playback configuration — kept as its own module
// (rather than scattered `if (multiview)`-style branches inside
// htmlVideoPlayer.ts or feature code) so engine-level tuning has one clear
// home:
//
//   HTML video player
//     ├─ HLS configuration
//     └─ MPEG-TS configuration
//          ├─ enableWorker
//          ├─ fixAudioTimestampGap
//          └─ other live-stream options
//
// None of these options are Multiview-specific — a caller (ChannelPlayerScreen,
// a Multiview pane, or a future test harness) can override any subset; the
// rest stay at mpegts.js's own documented defaults. See htmlVideoPlayer.ts
// for where this actually gets threaded into mpegts.createPlayer/hls.js.
export interface MpegTsEngineConfig {
  // @default false (mpegts.js's own default) — moves demux/remux work to a
  // DedicatedWorker instead of the main thread. Being evaluated as a fix
  // for a real main-thread-contention theory (see the stall-watchdog work)
  // — not yet proven, hence configurable/experimentable rather than
  // hardcoded either way.
  enableWorker: boolean
  // @default false (mpegts.js's own default) — separately moves MediaSource
  // itself into a worker. Newer/less broadly supported than enableWorker;
  // must not be turned on without verifying Tizen/Samsung support first.
  enableWorkerForMSE: boolean
  // mpegts.js defaults this to true, but a real provider discontinuity was
  // observed producing ~4.4 million silent frames synchronously and blowing
  // the JS call stack. A short audio discontinuity is preferable to a frozen
  // live stream, so Ninety deliberately uses the safer false default.
  fixAudioTimestampGap: boolean
}

// Placeholder for symmetry with MpegTsEngineConfig — hls.js isn't implicated
// in the failure this config seam was introduced for, but keeping it as its
// own named slot (rather than adding fields ad hoc later) is what keeps this
// a real per-engine seam instead of a single flat bag of options.
export interface HlsEngineConfig {}

export interface PlayerEngineConfig {
  hls: HlsEngineConfig
  mpegts: MpegTsEngineConfig
}

export const DEFAULT_PLAYER_ENGINE_CONFIG: PlayerEngineConfig = {
  hls: {},
  mpegts: {
    enableWorker: false,
    enableWorkerForMSE: false,
    fixAudioTimestampGap: false,
  },
}

export function resolvePlayerEngineConfig(overrides?: Partial<{ hls: Partial<HlsEngineConfig>; mpegts: Partial<MpegTsEngineConfig> }>): PlayerEngineConfig {
  return {
    hls: { ...DEFAULT_PLAYER_ENGINE_CONFIG.hls, ...overrides?.hls },
    mpegts: { ...DEFAULT_PLAYER_ENGINE_CONFIG.mpegts, ...overrides?.mpegts },
  }
}
