// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { collectPairingDeviceMetadata, formatMacAddress, getDisplayMacAddress, getInstallationId } from './deviceIdentity'

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

  it('normalizes a valid MAC for display and rejects malformed values', () => {
    expect(formatMacAddress('50-b7-a3-c2-96-11')).toBe('50:B7:A3:C2:96:11')
    expect(formatMacAddress('50b7.a3c2.9611')).toBe('50:B7:A3:C2:96:11')
    expect(formatMacAddress('not-a-mac')).toBeNull()
  })

  it('reads only the display MAC through the display helper', () => {
    window.webapis = { network: { getMac: () => '50b7a3c29611' } }
    expect(getDisplayMacAddress()).toBe('50:B7:A3:C2:96:11')
  })
})
