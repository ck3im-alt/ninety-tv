// Credential-free, deterministic synthetic playlist generator used by tests
// and the benchmark script (scripts/benchmarkChannelIndex.ts) to exercise
// ChannelIndex/parseCategory/matchLeadingCountry at realistic scale (up to
// ~30,925 channels, matching the real playlist size performance work is
// measured against) without ever touching a real user's playlist data.
import type { RawChannel } from '../rawChannel'
import { COUNTRY_NAMES } from '../countryCodes'

export interface SyntheticPlaylistOptions {
  channelCount: number
  // Country codes to cycle through — defaults to every code this app
  // recognizes, so generated groupTitles exercise matchLeadingCountry
  // realistically instead of falling into the "Other" bucket.
  countries?: string[]
  categoriesPerCountry?: number
  // >1 simulates the real-world "same channel, several quality variants"
  // pattern mergeChannelSources exists to collapse (e.g. "... RAW"/"... UHD"
  // duplicates that should merge into one Channel with multiple sources).
  qualityVariantsPerChannel?: number
}

const CATEGORY_NAMES = ['Sports', 'Movies', 'Kids', 'News', 'Entertainment', 'Music', 'Documentary', 'General']
const VARIANT_TAGS = ['RAW', 'UHD', 'HD', 'FHD', 'SD']

export function generateSyntheticRawChannels(options: SyntheticPlaylistOptions): RawChannel[] {
  const countries = options.countries ?? Object.keys(COUNTRY_NAMES)
  const categoriesPerCountry = Math.max(1, options.categoriesPerCountry ?? 8)
  const qualityVariantsPerChannel = Math.max(1, options.qualityVariantsPerChannel ?? 1)

  const raw: RawChannel[] = []
  let index = 0
  let logicalChannelIndex = 0

  while (raw.length < options.channelCount) {
    const country = countries[logicalChannelIndex % countries.length]
    const categorySlot = Math.floor(logicalChannelIndex / countries.length) % categoriesPerCountry
    const categoryName = CATEGORY_NAMES[categorySlot % CATEGORY_NAMES.length]
    const categoryNumber = Math.floor(categorySlot / CATEGORY_NAMES.length) + 1
    const groupTitle = `${country}| ${categoryName} ${categoryNumber}`
    const channelNumber = logicalChannelIndex + 1
    const baseName = `${categoryName} Channel ${channelNumber}`

    for (let variant = 0; variant < qualityVariantsPerChannel && raw.length < options.channelCount; variant++) {
      const tag = VARIANT_TAGS[variant % VARIANT_TAGS.length]
      const name = qualityVariantsPerChannel > 1 ? `${baseName} ${tag}` : baseName
      raw.push({
        id: `synthetic-${index}`,
        name,
        groupTitle,
        url: `https://example.invalid/stream/${index}.m3u8`,
        epgChannelId: index % 3 === 0 ? undefined : `epg.synthetic.${logicalChannelIndex}`,
      })
      index += 1
    }
    logicalChannelIndex += 1
  }

  return raw
}
