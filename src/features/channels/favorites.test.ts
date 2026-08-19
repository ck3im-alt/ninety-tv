import { describe, expect, it } from 'vitest'
import { categoryFavoriteKey, sortFavoritesFirst } from './favorites'

describe('categoryFavoriteKey', () => {
  it('combines country and category into one key', () => {
    expect(categoryFavoriteKey('Sweden', 'Sports')).toBe('Sweden::Sports')
  })
})

describe('sortFavoritesFirst', () => {
  it('moves favorited items to the front, keeping the rest of the order stable', () => {
    const items = ['a', 'b', 'c', 'd']
    const favorites = new Set(['c'])
    expect(sortFavoritesFirst(items, (id) => favorites.has(id))).toEqual(['c', 'a', 'b', 'd'])
  })

  it('keeps favorited items in their original relative order (multiple favorites)', () => {
    const items = ['a', 'b', 'c', 'd']
    const favorites = new Set(['b', 'd'])
    expect(sortFavoritesFirst(items, (id) => favorites.has(id))).toEqual(['b', 'd', 'a', 'c'])
  })

  it('returns items unchanged when nothing is favorited', () => {
    const items = ['a', 'b', 'c']
    expect(sortFavoritesFirst(items, () => false)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input array', () => {
    const items = ['a', 'b', 'c']
    const favorites = new Set(['c'])
    sortFavoritesFirst(items, (id) => favorites.has(id))
    expect(items).toEqual(['a', 'b', 'c'])
  })
})
