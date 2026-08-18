import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllAppStorage, readStored, writeStored } from './localStore'
import { makeFakeLocalStorage } from './testFakeLocalStorage'

beforeEach(() => {
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('readStored', () => {
  it('returns the fallback when nothing is stored', () => {
    expect(readStored('ninety.missing', 'fallback')).toBe('fallback')
  })

  it('round-trips a written value', () => {
    writeStored('ninety.thing', { a: 1 })
    expect(readStored('ninety.thing', null)).toEqual({ a: 1 })
  })

  it('returns the fallback when the stored value is corrupt JSON', () => {
    localStorage.setItem('ninety.thing', '{not json')
    expect(readStored('ninety.thing', 'fallback')).toBe('fallback')
  })
})

describe('writeStored', () => {
  it('returns true on success', () => {
    expect(writeStored('ninety.thing', { a: 1 })).toBe(true)
  })

  it('returns false and does not throw when localStorage.setItem fails', () => {
    const fake = makeFakeLocalStorage()
    Object.defineProperty(fake, 'setItem', {
      value: () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      },
    })
    vi.stubGlobal('localStorage', fake)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => writeStored('ninety.thing', { a: 1 })).not.toThrow()
    expect(writeStored('ninety.thing', { a: 1 })).toBe(false)
  })
})

describe('clearAllAppStorage', () => {
  it('only removes keys under the app prefix', () => {
    localStorage.setItem('ninety.foo', '1')
    localStorage.setItem('other.bar', '2')
    clearAllAppStorage()
    expect(localStorage.getItem('ninety.foo')).toBeNull()
    expect(localStorage.getItem('other.bar')).toBe('2')
  })
})
