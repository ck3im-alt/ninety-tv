// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { collectPairingDeviceMetadata, getInstallationId } from './deviceIdentity'

describe('Samsung pairing device metadata', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) }, configurable: true })
    window.webapis = undefined
  })

  it('keeps a stable random installation fallback when Samsung APIs are unavailable', () => {
    expect(getInstallationId()).toBe(getInstallationId())
    expect(collectPairingDeviceMetadata()).toMatchObject({ platform: 'samsung-tizen', installationId: '07'.repeat(24) })
  })

  it('collects ProductInfo and Network values without logging them', () => {
    const log = vi.spyOn(console, 'log')
    window.webapis = {
      productinfo: { getDuid: () => 'duid-secret', getModel: () => 'QE65', getModelCode: () => 'QE65X' },
      network: { getMac: () => '00:11:22:33:44:55' },
    }
    expect(collectPairingDeviceMetadata()).toMatchObject({ duid: 'duid-secret', mac: '00:11:22:33:44:55', model: 'QE65' })
    expect(log).not.toHaveBeenCalled()
  })

  it('degrades safely when a Samsung method throws', () => {
    window.webapis = { productinfo: { getDuid: () => { throw new Error('denied') } } }
    expect(collectPairingDeviceMetadata().duid).toBeUndefined()
  })
})
