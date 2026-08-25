import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetDeviceRegionProbeForTests, readBrowserLocaleTags, readDeviceLocale } from './deviceRegion'

// Every platform interface here is mocked — nothing in this suite needs (or
// would be improved by) a physical Samsung TV.

function stubTizenLocale(impl: TizenSystemInfoManager['getPropertyValue']) {
  vi.stubGlobal('window', { tizen: { systeminfo: { getPropertyValue: impl } } })
}

beforeEach(() => {
  __resetDeviceRegionProbeForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('readDeviceLocale', () => {
  it("returns Tizen's region-bearing locale value when the API answers", async () => {
    stubTizenLocale((_property, onSuccess) => onSuccess({ language: 'nor_NO', country: 'nor_NO' }))
    await expect(readDeviceLocale()).resolves.toBe('nor_NO')
  })

  it('falls back to `language` when `country` is absent', async () => {
    stubTizenLocale((_property, onSuccess) => onSuccess({ language: 'eng_GB' }))
    await expect(readDeviceLocale()).resolves.toBe('eng_GB')
  })

  it('resolves null when the Tizen API is not present at all (browser/dev)', async () => {
    vi.stubGlobal('window', {})
    await expect(readDeviceLocale()).resolves.toBeNull()
  })

  it('resolves null when the platform invokes the error callback', async () => {
    stubTizenLocale((_property, _onSuccess, onError) => onError?.(new Error('unsupported')))
    await expect(readDeviceLocale()).resolves.toBeNull()
  })

  it('resolves null (never rejects) when the call throws, e.g. a missing privilege', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubTizenLocale(() => {
      throw new Error('SecurityError')
    })
    await expect(readDeviceLocale()).resolves.toBeNull()
  })

  it('resolves null rather than hanging when neither callback is ever invoked', async () => {
    vi.useFakeTimers()
    try {
      stubTizenLocale(() => {
        /* firmware that never answers */
      })
      const pending = readDeviceLocale()
      await vi.advanceTimersByTimeAsync(2000)
      await expect(pending).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('probes the platform only once per session', async () => {
    const spy = vi.fn<TizenSystemInfoManager['getPropertyValue']>((_property, onSuccess) => onSuccess({ country: 'swe_SE' }))
    stubTizenLocale(spy)
    await readDeviceLocale()
    await readDeviceLocale()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('readBrowserLocaleTags', () => {
  it('returns navigator.languages first, then navigator.language', () => {
    vi.stubGlobal('navigator', { languages: ['nb-NO', 'en'], language: 'nb-NO' })
    expect(readBrowserLocaleTags()).toEqual(['nb-NO', 'en', 'nb-NO'])
  })

  it('copes with a runtime that has no navigator.languages', () => {
    vi.stubGlobal('navigator', { language: 'de-DE' })
    expect(readBrowserLocaleTags()).toEqual(['de-DE'])
  })

  it('returns nothing rather than throwing when navigator exposes no usable tag', () => {
    vi.stubGlobal('navigator', {})
    expect(readBrowserLocaleTags()).toEqual([])
  })
})
