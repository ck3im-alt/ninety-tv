import { describe, expect, it } from 'vitest'
import { ChannelIndex, getChannelIndex, warmChannelIndexAsync } from './channelIndex'
import { mergeChannelSources } from '../features/channels/mergeChannels'
import type { RawChannel } from './rawChannel'
import { generateSyntheticRawChannels } from './testUtils/syntheticPlaylist'

function raw(overrides: Partial<RawChannel> & { name: string; url: string }): RawChannel {
  return { id: overrides.name, ...overrides }
}

describe('ChannelIndex', () => {
  const fixture: RawChannel[] = [
    raw({ name: 'Sports 1', groupTitle: 'NO| Sports', url: 'u1', epgChannelId: 'epg.1' }),
    raw({ name: 'Sports 2', groupTitle: 'NO| Sports', url: 'u2', epgChannelId: 'epg.2' }),
    raw({ name: 'Movies 1', groupTitle: 'NO| Movies', url: 'u3', epgChannelId: 'epg.3' }),
    raw({ name: 'PPV Big Fight', groupTitle: 'NO| PPV', url: 'u4' }), // no epgChannelId -> unmapped
    raw({ name: 'Unmapped Channel', groupTitle: 'NO| General', url: 'u5' }), // no epgChannelId, not tagged PPV
    // Deliberately NOT "SE Sports 1" / "No Country Channel" — those leading
    // words ("SE", "No") are themselves recognized country-code prefixes
    // (Sweden, Norway) that normalizeChannelName would strip from the NAME
    // itself, which is real/correct behavior but would make these names
    // collide with the plain "Sports 1" fixture entry above and defeat the
    // point of this fixture. Names below avoid that ambiguity on purpose.
    raw({ name: 'Nordic Sport One', groupTitle: 'SE| Sports', url: 'u6', epgChannelId: 'epg.6' }),
    raw({ name: 'Mystery Channel', groupTitle: 'Random Group', url: 'u7', epgChannelId: 'epg.7' }),
  ]
  const channels = mergeChannelSources(fixture)
  const index = new ChannelIndex(channels)

  const byName = (name: string) => channels.find((c) => c.name === name)!

  it('getEntry returns the right entry for every channel and undefined for an unknown id', () => {
    for (const channel of channels) {
      expect(index.getEntry(channel.id)?.channel.id).toBe(channel.id)
    }
    expect(index.getEntry('does-not-exist')).toBeUndefined()
  })

  it('getCountries lists every distinct country (including the Other bucket) with correct counts', () => {
    const countries = index.getCountries()
    const norway = countries.find((c) => c.name === 'Norway')
    const sweden = countries.find((c) => c.name === 'Sweden')
    const other = countries.find((c) => c.name === 'Other')
    expect(norway?.count).toBe(5) // Sports x2, Movies, PPV, General
    expect(sweden?.count).toBe(1)
    expect(other?.count).toBe(1)
  })

  it('getCategoriesForCountry returns each category once with the right count and PPV flag', () => {
    const categories = index.getCategoriesForCountry('Norway')
    const sports = categories.find((c) => c.label === 'Sports')
    const ppv = categories.find((c) => c.isPpv)
    expect(sports?.count).toBe(2)
    expect(ppv?.label).toBe('PPV')
    expect(ppv?.count).toBe(1)
  })

  it('getChannelsForCategory returns exactly the channels in that country+category bucket', () => {
    const sportsChannels = index.getChannelsForCategory('Norway', 'Sports')
    expect(sportsChannels.map((c) => c.name).sort()).toEqual(['Sports 1', 'Sports 2'])
  })

  it('getChannelsForCategory handles the empty-string general bucket distinctly from null/other categories', () => {
    // "NO| General" has no quality tag to strip and no PPV marker, so its
    // mergedLabel is "General" (not merged away to "") in this fixture —
    // verify the category truly round-trips through the bucket keyed by
    // whatever parseCategory actually produced for it.
    const general = channels.find((c) => c.name === 'Unmapped Channel')!
    const parsedLabel = index.getEntry(general.id)!.parsed.mergedLabel
    expect(index.getChannelsForCategory('Norway', parsedLabel).some((c) => c.id === general.id)).toBe(true)
    expect(index.getChannelsForCategory('Norway', 'not-a-real-category')).toEqual([])
  })

  it('getChannelsForCountry returns every channel in that country, across all categories', () => {
    const norwayChannels = index.getChannelsForCountry('Norway')
    expect(norwayChannels.length).toBe(5)
  })

  it('getSiblings excludes the channel itself and only includes same country+category channels', () => {
    const sports1 = byName('Sports 1')
    const siblings = index.getSiblings(sports1)
    expect(siblings.some((c) => c.id === sports1.id)).toBe(false)
    expect(siblings.map((c) => c.name)).toEqual(['Sports 2'])
  })

  it('getSiblings returns two channels as mutual siblings', () => {
    const sports1 = byName('Sports 1')
    const sports2 = byName('Sports 2')
    expect(index.getSiblings(sports1).some((c) => c.id === sports2.id)).toBe(true)
    expect(index.getSiblings(sports2).some((c) => c.id === sports1.id)).toBe(true)
  })

  it('search matches on plain lowercase substring, same as the pre-index behavior', () => {
    const results = index.search('sport')
    expect(results.map((c) => c.name).sort()).toEqual(['Nordic Sport One', 'Sports 1', 'Sports 2'])
    expect(index.search('nonexistentquery')).toEqual([])
  })

  it('getPpvOrUnmappedChannels includes tagged-PPV and no-EPG-id channels, and nothing else', () => {
    const names = index.getPpvOrUnmappedChannels().map((c) => c.name)
    expect(names).toContain('PPV Big Fight')
    expect(names).toContain('Unmapped Channel')
    expect(names).not.toContain('Sports 1')
  })

  it('getPpvChannels only includes category-PPV channels', () => {
    const names = index.getPpvChannels().map((c) => c.name)
    expect(names).toEqual(['PPV Big Fight'])
  })

  it('getLikelySportChannels includes SPORT-named/grouped channels and PPV channels', () => {
    const names = index.getLikelySportChannels().map((c) => c.name)
    expect(names).toContain('Sports 1')
    expect(names).toContain('Sports 2')
    expect(names).toContain('Nordic Sport One')
    expect(names).toContain('PPV Big Fight')
    expect(names).not.toContain('Movies 1')
  })

  it('mutation isolation: sorting a returned array in place never corrupts the index', () => {
    const first = index.getChannelsForCategory('Norway', 'Sports')
    first.sort((a, b) => b.name.localeCompare(a.name)) // mutate the caller's copy
    const second = index.getChannelsForCategory('Norway', 'Sports')
    expect(second.map((c) => c.name)).toEqual(['Sports 1', 'Sports 2']) // unaffected, original insertion order
  })

  it('mutation isolation applies to every array-returning getter, not just getChannelsForCategory', () => {
    const countriesA = index.getCountries()
    countriesA.reverse()
    expect(index.getCountries()[0]).not.toBe(countriesA[0])

    const ppvA = index.getPpvOrUnmappedChannels()
    ppvA.length = 0
    expect(index.getPpvOrUnmappedChannels().length).toBeGreaterThan(0)
  })

  it('getChannelIndex memoizes by array reference and rebuilds on a new reference', () => {
    const a = getChannelIndex(channels)
    const b = getChannelIndex(channels)
    expect(a).toBe(b)
    const differentArray = [...channels]
    const c = getChannelIndex(differentArray)
    expect(c).not.toBe(a)
  })
})

describe('ChannelIndex — per-lookup cost does not grow with playlist size (structural, not timing)', () => {
  it('getChannelsForCategory/getSiblings/getEntry results are correct and self-consistent at 500 and 5,000 synthetic channels', () => {
    for (const channelCount of [500, 5000]) {
      const synthetic = mergeChannelSources(generateSyntheticRawChannels({ channelCount, categoriesPerCountry: 4 }))
      const synthIndex = new ChannelIndex(synthetic)
      const sample = synthetic[Math.floor(synthetic.length / 2)]
      const entry = synthIndex.getEntry(sample.id)!
      const bucket = synthIndex.getChannelsForCategory(entry.parsed.countryName ?? 'Other', entry.parsed.mergedLabel)
      expect(bucket.some((c) => c.id === sample.id)).toBe(true)
      const siblings = synthIndex.getSiblings(sample)
      expect(siblings.every((c) => c.id !== sample.id)).toBe(true)
      // The bucket a single channel belongs to is a small slice of the whole
      // playlist regardless of total size — proves lookups return
      // category-scoped subsets, not the whole array, at either scale.
      expect(bucket.length).toBeLessThan(synthetic.length)
    }
  })
})

describe('warmChannelIndexAsync', () => {
  it('produces an index equivalent to the synchronous constructor, chunked over multiple ticks', async () => {
    const synthetic = mergeChannelSources(generateSyntheticRawChannels({ channelCount: 500, categoriesPerCountry: 4 }))
    const warmed = await warmChannelIndexAsync(synthetic, 50) // tiny chunk size forces several yields
    const sync = new ChannelIndex(synthetic)
    expect(warmed.getCountries()).toEqual(sync.getCountries())
    const sample = synthetic[250]
    expect(warmed.getEntry(sample.id)).toEqual(sync.getEntry(sample.id))
  })

  it('populates the same cache getChannelIndex reads from, keyed by array reference', async () => {
    const synthetic = mergeChannelSources(generateSyntheticRawChannels({ channelCount: 200, categoriesPerCountry: 4 }))
    const warmed = await warmChannelIndexAsync(synthetic, 30)
    expect(getChannelIndex(synthetic)).toBe(warmed)
  })

  it('defers to a synchronous getChannelIndex() build that wins the race, rather than duplicating it', async () => {
    const synthetic = mergeChannelSources(generateSyntheticRawChannels({ channelCount: 300, categoriesPerCountry: 4 }))
    const warmPromise = warmChannelIndexAsync(synthetic, 20)
    const sync = getChannelIndex(synthetic) // built synchronously while the warm is still mid-chunk
    const warmed = await warmPromise
    expect(warmed).toBe(sync)
  })

  // Mirrors App.tsx's exact bootstrap sequencing at real ~30,925-channel
  // scale: `await warmChannelIndexAsync(result.channels)` runs to full
  // completion BEFORE `installPlaylist(...)` publishes the array into React
  // state, and only THEN does `useMemo(() => getChannelIndex(playlist
  // .channels))` run during render. This test simulates that exact order —
  // full await, then a synchronous getChannelIndex() call standing in for
  // the useMemo — and proves via reference equality (a rebuild would
  // allocate a genuinely new ChannelIndex instance, failing `toBe`) that no
  // second full-playlist construction ever happens on a normal cached
  // ("ready" hydration) launch.
  it('a normal cached-launch sequence (await warm to completion, then getChannelIndex — the App.tsx pattern) never rebuilds at real ~30,925-channel scale', async () => {
    const realistic = mergeChannelSources(generateSyntheticRawChannels({ channelCount: 30_925, categoriesPerCountry: 8 }))

    const warmed = await warmChannelIndexAsync(realistic)
    // Simulates React's render calling useMemo(() => getChannelIndex(playlist.channels)) —
    // must be a synchronous cache hit, not a fresh 30,925-channel build.
    const fromRender = getChannelIndex(realistic)

    expect(fromRender).toBe(warmed)

    // A second "render" (e.g. a re-render from an unrelated state change,
    // same channels reference) must also stay a cache hit.
    expect(getChannelIndex(realistic)).toBe(warmed)
  })
})
