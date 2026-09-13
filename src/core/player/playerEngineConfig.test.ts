import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAYER_ENGINE_CONFIG, resolvePlayerEngineConfig } from './playerEngineConfig'

describe('resolvePlayerEngineConfig', () => {
  it('returns the defaults when given no overrides', () => {
    expect(resolvePlayerEngineConfig()).toEqual(DEFAULT_PLAYER_ENGINE_CONFIG)
  })

  it('merges a partial mpegts override over the defaults, leaving the rest untouched', () => {
    const config = resolvePlayerEngineConfig({ mpegts: { enableWorker: true } })
    expect(config.mpegts).toEqual({ enableWorker: true, enableWorkerForMSE: false, fixAudioTimestampGap: false })
  })

  it('merges multiple mpegts overrides at once', () => {
    const config = resolvePlayerEngineConfig({ mpegts: { enableWorker: true, fixAudioTimestampGap: true } })
    expect(config.mpegts).toEqual({ enableWorker: true, enableWorkerForMSE: false, fixAudioTimestampGap: true })
  })

  it('never mutates the shared DEFAULT_PLAYER_ENGINE_CONFIG object', () => {
    const before = JSON.stringify(DEFAULT_PLAYER_ENGINE_CONFIG)
    resolvePlayerEngineConfig({ mpegts: { enableWorker: true } })
    expect(JSON.stringify(DEFAULT_PLAYER_ENGINE_CONFIG)).toBe(before)
  })
})
