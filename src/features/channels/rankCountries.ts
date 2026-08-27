// Preferred countries are a RANKING SIGNAL, never a filter.
//
// This is the whole rule, in one pure function, because it was previously
// implemented as its opposite: finishing onboarding seeded hiddenCountries
// with every playlist country the viewer had NOT preferred, so expressing
// "I mostly watch Norway" deleted Denmark, Germany and Spain from the
// Channels browser outright. A viewer with a 30,000-channel playlist could
// end up with four countries visible and no way to understand why.
//
// What a preference means here is only: put these first. Every country in
// the playlist is always in the returned list. The only thing that ever
// removes a country from Channels is the explicit Filter popup
// (hiddenCountries), which the viewer drives by hand and can undo in the
// same place they set it.
// The shape ChannelIndex.getCountries() returns. Declared structurally
// rather than imported so this module stays pure and trivially testable
// without constructing a whole index.
export interface CountryEntry {
  name: string
  code: string | null
  count: number
}

// The name Channels renders for a channel whose group title carries no
// recognizable country — always last, whatever the preferences say, because
// "Other" is not a country anyone can prefer.
export const OTHER_COUNTRY = 'Other'

export interface RankedCountry {
  country: CountryEntry
  // True for the contiguous run at the top of the list. The rail draws its
  // one divider at the boundary — see BrowseCascadeScreen.
  preferred: boolean
}

// Preferred countries first IN THE VIEWER'S OWN STORED ORDER (index 0 is
// their primary — see SportPreferences.favoriteCountries), then everything
// else biggest-first, then 'Other'. A preferred country the playlist does
// not actually contain simply contributes nothing.
export function rankCountries(
  countries: readonly CountryEntry[],
  preferredCountries: readonly string[],
): RankedCountry[] {
  const rank = new Map(preferredCountries.map((name, index) => [name, index]))
  return [...countries]
    .map((country) => ({
      country,
      // 'Other' can never be preferred, even if a playlist somehow produced
      // a literal country named that — it is a bucket, not a market.
      preferred: country.name !== OTHER_COUNTRY && rank.has(country.name),
    }))
    .sort((a, b) => {
      if (a.preferred !== b.preferred) return a.preferred ? -1 : 1
      if (a.preferred && b.preferred) return rank.get(a.country.name)! - rank.get(b.country.name)!
      if (a.country.name === OTHER_COUNTRY) return 1
      if (b.country.name === OTHER_COUNTRY) return -1
      return b.country.count - a.country.count
    })
}

// Index of the first non-preferred entry, or -1 when the split doesn't
// exist (nothing preferred, or everything is). The rail uses it to place a
// single divider rather than section headers: the country column is ~70px
// wide in the four-pane state, where a text heading cannot fit at all.
export function preferredBoundary(ranked: readonly RankedCountry[]): number {
  if (ranked.length === 0 || !ranked[0].preferred) return -1
  const index = ranked.findIndex((entry) => !entry.preferred)
  return index
}
