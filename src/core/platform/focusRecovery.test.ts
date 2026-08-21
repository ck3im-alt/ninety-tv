import { describe, expect, it } from 'vitest'
import { pickFallbackAfterIdRemoval, pickFallbackAfterRemoval } from './focusRecovery'

describe('pickFallbackAfterRemoval', () => {
  it('prefers the item that slid into the removed index ("next item")', () => {
    const next = ['b', 'c', 'd'] // 'a' was removed from index 0
    expect(pickFallbackAfterRemoval(0, next)).toEqual({ item: 'b', index: 0 })
  })

  it('falls back to the new last item when the removed item was last', () => {
    const next = ['a', 'b', 'c']
    // 'd' used to be at index 3, now out of range
    expect(pickFallbackAfterRemoval(3, next)).toEqual({ item: 'c', index: 2 })
  })

  it('returns null when the list is now empty — caller must use a fixed fallback anchor', () => {
    expect(pickFallbackAfterRemoval(0, [])).toBeNull()
  })
})

describe('pickFallbackAfterIdRemoval', () => {
  interface Item {
    id: string
  }
  const getId = (item: Item) => item.id

  it('returns null when the selected id is still present (nothing to recover from)', () => {
    const prev: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const next: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(pickFallbackAfterIdRemoval(prev, next, 'b', getId)).toBeNull()
  })

  it('picks the next item at the same position when the selected item was removed from the middle', () => {
    const prev: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const next: Item[] = [{ id: 'a' }, { id: 'c' }]
    expect(pickFallbackAfterIdRemoval(prev, next, 'b', getId)).toEqual({ item: { id: 'c' }, index: 1 })
  })

  it('picks the previous item when the removed item was last in the list', () => {
    const prev: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const next: Item[] = [{ id: 'a' }, { id: 'b' }]
    expect(pickFallbackAfterIdRemoval(prev, next, 'c', getId)).toEqual({ item: { id: 'b' }, index: 1 })
  })

  it('returns null (not a crash) when the list becomes empty — caller falls back to a fixed anchor', () => {
    const prev: Item[] = [{ id: 'a' }]
    const next: Item[] = []
    expect(pickFallbackAfterIdRemoval(prev, next, 'a', getId)).toBeNull()
  })

  it('returns null when the "removed" id was never in the previous list either (not actually a removal)', () => {
    const prev: Item[] = [{ id: 'a' }]
    const next: Item[] = [{ id: 'a' }]
    expect(pickFallbackAfterIdRemoval(prev, next, 'never-existed', getId)).toBeNull()
  })
})
