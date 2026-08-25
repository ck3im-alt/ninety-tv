// Formalizes scripts/evaluate-m3u-corpus.ts's corpus (fixtures/m3u-corpus)
// as a real regression-blocking test suite — see that script's header for
// the full methodology. Covers three parts of the M3U-matching validation
// task (2026-08-20):
//   Part 3/4 — realistic dirty playlist names resolve against the real
//     catalog snapshot (or are honestly flagged as a known gap).
//   Part 5 — sibling/numbered channels stay distinguishable (never
//     false-positive-merged).
//   Part 6 — quality-variant merging keeps one logical channel with
//     multiple selectable-quality sources, never encodes quality into
//     channel identity.
import { describe, expect, it } from 'vitest'
import { mergeChannelSources } from '../../features/channels/mergeChannels'
import { resolveChannelIdentities } from './channelIdentityResolver'
import type { NinetyLogicalChannel } from './ninetyApiClient'
import type { RawChannel } from '../rawChannel'
import { M3U_CORPUS } from '../../../fixtures/m3u-corpus/cases'
import catalogSnapshot from '../../../fixtures/m3u-corpus/catalog-snapshot.json'

const catalog = catalogSnapshot as unknown as NinetyLogicalChannel[]

// Cases with a REAL known gap are tracked here so this suite still fails
// loudly if the resolver's behavior changes in either direction: a listed
// case unexpectedly starting to pass is fine (delete it from the list), but
// a NEW, previously-passing case failing means something regressed.
//
// The other 6 corpus cases that originally failed this evaluation
// (es_movistar_laliga_tv, nl_espn_1, mx_fox_sports, br_sportv, us_fs1,
// ca_rds2) were fixed via targeted, collision-checked production aliases —
// see ninety-api's scripts/seed-m3u-corpus-aliases.ts — and are no longer
// listed here. The 2 remaining below were deliberately NOT aliased: both
// are the identical "catalog name has no space (ESPN2), playlist has a
// space (ESPN 2)" pattern, but a live collision check found 3+ OTHER real
// logical channels already literally named "ESPN 2" in other markets, and
// GET /v1/channels/catalog exposes aliases as a flat, country-unscoped
// array — adding a bare "ESPN 2" alias would risk exactly the kind of
// cross-market false positive this whole resolver exists to prevent. Left
// as a documented gap rather than violating the "cannot collide" alias
// criterion (see the task's final report, Part 10).
const KNOWN_GAPS = new Set([
  'US|USA: ESPN 2 HD', // catalog name "ESPN2" has no space; alias would collide with nl/mx/br "ESPN 2"
  'AU|AUS: ESPN 2 FHD', // same — catalog name "ESPN2" has no space; alias would collide
])

function resolveCorpusEntry(playlistName: string) {
  const raw: RawChannel[] = [{ id: 'corpus-entry', name: playlistName, url: 'http://example.invalid/stream' }]
  const [channel] = mergeChannelSources(raw)
  return { channel, resolutions: resolveChannelIdentities(catalog, [channel]) }
}

describe('M3U corpus — realistic dirty playlist names resolve against the real catalog', () => {
  for (const c of M3U_CORPUS) {
    const key = `${c.market}|${c.playlistName}`
    const knownGap = KNOWN_GAPS.has(key)
    const label = knownGap ? `[known gap] ${c.market} "${c.playlistName}"` : `${c.market} "${c.playlistName}"`

    it(label, () => {
      const { channel, resolutions } = resolveCorpusEntry(c.playlistName)
      if (c.expectedLogicalChannelId === null) {
        const anyConfirmed = [...resolutions.values()].some((r) => r.classification === 'CONFIRMED' || r.classification === 'STRONG')
        expect(anyConfirmed).toBe(false)
        return
      }

      const res = resolutions.get(c.expectedLogicalChannelId)
      const classification = res?.classification ?? 'NONE'
      const matchedThisChannel = (res?.matches ?? []).some((m) => m.playlistChannelId === channel.id)
      const resolvedCorrectly = (classification === 'CONFIRMED' || classification === 'STRONG') && matchedThisChannel

      if (knownGap) {
        // Documented, evidence-based gap (see KNOWN_GAPS above) — asserting
        // failure here means a real fix removes this from the list, not
        // that the test silently stops covering it.
        expect(resolvedCorrectly).toBe(false)
      } else {
        expect(resolvedCorrectly).toBe(true)
      }
    })
  }
})

describe('Part 5 — channel identity protection (never merge distinct siblings)', () => {
  // Every pair below must classify as CONFIRMED/STRONG for at most ONE side
  // when checked against a playlist containing only the highest-signal name
  // — the resolver must never let the lower channel silently absorb the
  // other via fuzzy/structured overlap.
  const catalogFamilies: Array<{ id: string; name: string }[]> = [
    [
      { id: 'x_espn', name: 'ESPN' },
      { id: 'x_espn2', name: 'ESPN2' },
      { id: 'x_espn3', name: 'ESPN3' },
      { id: 'x_espn_deportes', name: 'ESPN Deportes' },
    ],
    [
      { id: 'x_fs1', name: 'FS1' },
      { id: 'x_fs2', name: 'FS2' },
    ],
    [
      { id: 'x_tsn1', name: 'TSN 1' },
      { id: 'x_tsn2', name: 'TSN 2' },
      { id: 'x_tsn3', name: 'TSN 3' },
      { id: 'x_tsn4', name: 'TSN 4' },
      { id: 'x_tsn5', name: 'TSN 5' },
    ],
    [
      { id: 'x_sky1', name: 'Sky Sport 1' },
      { id: 'x_sky2', name: 'Sky Sport 2' },
    ],
    [
      { id: 'x_ziggo1', name: 'Ziggo Sport 1' },
      { id: 'x_ziggo2', name: 'Ziggo Sport 2' },
    ],
    [
      { id: 'x_bein1', name: 'beIN Sports 1' },
      { id: 'x_bein2', name: 'beIN Sports 2' },
    ],
    [
      { id: 'x_tv2', name: 'TV2' },
      { id: 'x_tv2sport', name: 'TV2 Sport' },
      { id: 'x_tv2sportpremium', name: 'TV2 Sport Premium' },
    ],
  ]

  function logical(id: string, name: string): NinetyLogicalChannel {
    return {
      id,
      name,
      country: null,
      broadcast_type: 'LINEAR',
      network_name: null,
      channel_number: null,
      channel_variant: null,
      aliases: [],
      external_ids: [],
      source_names: [],
    }
  }

  for (const family of catalogFamilies) {
    for (const target of family) {
      it(`a playlist entry named exactly "${target.name}" only confirms ${target.id}, never a sibling`, () => {
        const localCatalog = family.map((f) => logical(f.id, f.name))
        const raw: RawChannel[] = [{ id: 'p1', name: target.name, url: 'http://example.invalid/stream' }]
        const [channel] = mergeChannelSources(raw)
        const resolutions = resolveChannelIdentities(localCatalog, [channel])

        for (const sibling of family) {
          const classification = resolutions.get(sibling.id)?.classification ?? 'NONE'
          if (sibling.id === target.id) {
            expect(classification, `${sibling.id} should confirm for "${target.name}"`).toMatch(/CONFIRMED|STRONG/)
          } else {
            expect(classification, `${sibling.id} must NOT auto-match "${target.name}"`).toMatch(/AMBIGUOUS|NONE/)
          }
        }
      })
    }
  }
})

describe('Part 7 — Premier Sports 1 dirty-name variants resolve, and never collide across GB/IE/PH', () => {
  // The live catalog (checked 2026-08-24) has three real channels literally
  // named "Premier Sports 1"/"Premier Sports" across GB/IE/PH
  // (uk_premier_sports_1, ie_premier_sports_1, ph_premier_sports_1) — a
  // country-less playlist entry is genuinely ambiguous between them, but a
  // country-carrying one must resolve to exactly the right one and reject
  // the other two, never silently picking one.
  function premierSportsCatalog(): NinetyLogicalChannel[] {
    return [
      { id: 'uk_premier_sports_1', name: 'Premier Sports 1', country: 'GB', broadcast_type: 'LINEAR', network_name: 'Premier Sports', channel_number: null, channel_variant: null, aliases: [], external_ids: [], source_names: ['Premier Sports 1 HD'] },
      { id: 'uk_premier_sports_2', name: 'Premier Sports 2', country: 'GB', broadcast_type: 'LINEAR', network_name: 'Premier Sports', channel_number: null, channel_variant: null, aliases: [], external_ids: [], source_names: ['Premier Sports 2 HD'] },
      { id: 'ie_premier_sports_1', name: 'Premier Sports 1', country: 'IE', broadcast_type: 'LINEAR', network_name: 'Premier Sports 1', channel_number: null, channel_variant: null, aliases: [], external_ids: [], source_names: [] },
      { id: 'ie_premier_sports_2', name: 'Premier Sports 2', country: 'IE', broadcast_type: 'LINEAR', network_name: 'Premier Sports 2', channel_number: null, channel_variant: null, aliases: [], external_ids: [], source_names: [] },
      { id: 'ph_premier_sports_1', name: 'Premier Sports', country: 'PH', broadcast_type: 'LINEAR', network_name: 'Premier Sports', channel_number: null, channel_variant: null, aliases: [], external_ids: [], source_names: [] },
    ]
  }

  function resolveAgainst(playlistName: string) {
    const raw: RawChannel[] = [{ id: 'p1', name: playlistName, url: 'http://example.invalid/stream' }]
    const [channel] = mergeChannelSources(raw)
    return resolveChannelIdentities(premierSportsCatalog(), [channel])
  }

  // Deliberately excludes any country-less variant ("PREMIER SPORTS 1 FHD")
  // — with a real ie_premier_sports_1 in the catalog, a bare name genuinely
  // is ambiguous, covered separately below, not a case that should confirm.
  const gbDirtyVariants = ['Premier Sports 1 (GB)', 'Premier Sports 1 UK', 'UK: Premier Sports 1', 'Premier Sports 1 HD UK']

  for (const variant of gbDirtyVariants) {
    it(`"${variant}" confirms uk_premier_sports_1 only, never ie/ph`, () => {
      const resolutions = resolveAgainst(variant)
      const ukClassification = resolutions.get('uk_premier_sports_1')?.classification ?? 'NONE'
      expect(ukClassification, `uk_premier_sports_1 should confirm for "${variant}"`).toMatch(/CONFIRMED|STRONG/)
      expect(resolutions.get('uk_premier_sports_2')?.classification ?? 'NONE').toBe('NONE')
      expect(resolutions.get('ie_premier_sports_1')?.classification ?? 'NONE').toMatch(/AMBIGUOUS|NONE/)
      expect(resolutions.get('ph_premier_sports_1')?.classification ?? 'NONE').toMatch(/AMBIGUOUS|NONE/)
    })
  }

  for (const bareVariant of ['Premier Sports 1', 'PREMIER SPORTS 1 FHD']) {
    it(`a country-less "${bareVariant}" is genuinely ambiguous between GB and IE, not silently picked`, () => {
      const resolutions = resolveAgainst(bareVariant)
      const gb = resolutions.get('uk_premier_sports_1')?.classification ?? 'NONE'
      const ie = resolutions.get('ie_premier_sports_1')?.classification ?? 'NONE'
      // Neither side may be silently CONFIRMED/STRONG off a bare name shared
      // by two real catalog channels with no disambiguating signal.
      expect(gb).not.toMatch(/CONFIRMED|STRONG/)
      expect(ie).not.toMatch(/CONFIRMED|STRONG/)
    })
  }

  it('Ireland variant "IE: Premier Sports 1" confirms ie_premier_sports_1 only, never uk/ph', () => {
    const resolutions = resolveAgainst('IE: Premier Sports 1')
    expect(resolutions.get('ie_premier_sports_1')?.classification ?? 'NONE').toMatch(/CONFIRMED|STRONG/)
    expect(resolutions.get('uk_premier_sports_1')?.classification ?? 'NONE').toMatch(/AMBIGUOUS|NONE/)
  })

  it('Premier Sports 1 and 2 never collapse into each other for either GB or IE', () => {
    const resolutions = resolveAgainst('UK: Premier Sports 2')
    expect(resolutions.get('uk_premier_sports_2')?.classification ?? 'NONE').toMatch(/CONFIRMED|STRONG/)
    expect(resolutions.get('uk_premier_sports_1')?.classification ?? 'NONE').toBe('NONE')
  })
})

describe('Part 6 — quality-variant merging keeps identity separate from quality', () => {
  it('ESPN FHD / ESPN UHD / ESPN HD from one provider merge into ONE channel with 3 selectable sources', () => {
    const raw: RawChannel[] = [
      { id: 'r1', name: 'ESPN FHD', url: 'http://example.invalid/fhd' },
      { id: 'r2', name: 'ESPN UHD', url: 'http://example.invalid/uhd' },
      { id: 'r3', name: 'ESPN HD', url: 'http://example.invalid/hd' },
    ]
    const channels = mergeChannelSources(raw)
    expect(channels).toHaveLength(1)
    expect(channels[0].name).toBe('ESPN')
    const labels = channels[0].sources.map((s) => s.label).sort()
    expect(labels).toEqual(['FHD', 'HD', 'UHD'])
  })

  it('quality variants across DIFFERENT country-prefixed names still merge into one channel', () => {
    const raw: RawChannel[] = [
      { id: 'r1', name: 'US | ESPN FHD', url: 'http://example.invalid/fhd' },
      { id: 'r2', name: 'US | ESPN UHD', url: 'http://example.invalid/uhd' },
    ]
    const channels = mergeChannelSources(raw)
    expect(channels).toHaveLength(1)
    expect(channels[0].sources.map((s) => s.label).sort()).toEqual(['FHD', 'UHD'])
  })

  it('does not merge two genuinely different numbered siblings just because they share a quality tag', () => {
    const raw: RawChannel[] = [
      { id: 'r1', name: 'TSN 1 HD', url: 'http://example.invalid/1' },
      { id: 'r2', name: 'TSN 2 HD', url: 'http://example.invalid/2' },
    ]
    const channels = mergeChannelSources(raw)
    expect(channels).toHaveLength(2)
  })

  it('a merged channel resolves against the catalog by its quality-stripped identity, and each source keeps its own quality label', () => {
    const localCatalog: NinetyLogicalChannel[] = [
      {
        id: 'us_espn',
        name: 'ESPN',
        country: 'US',
        broadcast_type: 'LINEAR',
        network_name: null,
        channel_number: null,
        channel_variant: null,
        aliases: [],
        external_ids: [],
        source_names: [],
      },
    ]
    const raw: RawChannel[] = [
      { id: 'r1', name: 'US | ESPN FHD', url: 'http://example.invalid/fhd' },
      { id: 'r2', name: 'US | ESPN UHD', url: 'http://example.invalid/uhd' },
      { id: 'r3', name: 'US | ESPN HD', url: 'http://example.invalid/hd' },
    ]
    const channels = mergeChannelSources(raw)
    expect(channels).toHaveLength(1)
    const resolutions = resolveChannelIdentities(localCatalog, channels)
    const resolution = resolutions.get('us_espn')
    expect(resolution?.classification).toMatch(/CONFIRMED|STRONG/)
    // Quality never became part of the logical channel's own identity —
    // the merged channel's canonical name is quality-tag-free.
    expect(channels[0].name).toBe('ESPN')
    expect(channels[0].sources.map((s) => s.label).sort()).toEqual(['FHD', 'HD', 'UHD'])
  })
})
