// Categories are scoped to a country (the same mergedLabel can exist under
// different countries), so the favorite key needs both parts to stay unique.
export function categoryFavoriteKey(country: string, mergedLabel: string): string {
  return `${country}::${mergedLabel}`
}

// Favorites pinned to the top, everyone else after — a stable sort (favorite
// status is the only thing this reorders on; anything already-equal, e.g.
// two non-favorites, keeps its relative order from `items`). Doesn't mutate
// `items`. Callers that need this order to stay fixed while favorite state
// keeps changing (BrowseCascadeScreen's channelsInCategory/searchResults —
// see the comments there) are responsible for only calling this once per
// dataset, not on every favorite toggle; this function itself is a plain,
// stateless sort with no memory of past calls.
export function sortFavoritesFirst<T>(items: T[], isFavorite: (item: T) => boolean): T[] {
  return [...items].sort((a, b) => {
    const aFav = isFavorite(a)
    const bFav = isFavorite(b)
    if (aFav === bFav) return 0
    return aFav ? -1 : 1
  })
}
