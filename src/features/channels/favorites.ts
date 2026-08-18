// Categories are scoped to a country (the same mergedLabel can exist under
// different countries), so the favorite key needs both parts to stay unique.
export function categoryFavoriteKey(country: string, mergedLabel: string): string {
  return `${country}::${mergedLabel}`
}
