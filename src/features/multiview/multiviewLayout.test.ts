import { describe, expect, it } from 'vitest'
import { multiviewLayoutFor } from './multiviewLayout'

describe('multiviewLayoutFor', () => {
  it('returns single for 0 or 1 panes', () => {
    expect(multiviewLayoutFor(0)).toBe('single')
    expect(multiviewLayoutFor(1)).toBe('single')
  })

  it('returns two for 2 panes', () => {
    expect(multiviewLayoutFor(2)).toBe('two')
  })

  it('returns three for 3 panes', () => {
    expect(multiviewLayoutFor(3)).toBe('three')
  })

  it('returns four for 4 panes', () => {
    expect(multiviewLayoutFor(4)).toBe('four')
  })
})
