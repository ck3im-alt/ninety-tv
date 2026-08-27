import { useState } from 'react'
import { setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useFocusScrollIntoView } from '../../core/platform'
import { StreamRow } from './StreamRow'
import { groupOptionsByCountry } from './buildEventStreamOptions'
import type { CountryGroupSection, PartitionedStreamOptions, RankedEventStreamOption } from './buildEventStreamOptions'
import { flagSrc } from '../../data/countryCodes'
import { BACK_FOCUS_KEY, CANDIDATE_TOGGLE_FOCUS_KEY } from './eventDetailsFocusKeys'
import type { EventPlaybackGroup } from './eventPlaybackGroup'

interface SharedRowProps {
  favoriteChannels: ReadonlySet<string>
  // Whole-row favorite semantics — see StreamRow's own prop comment.
  onToggleFavoriteChannels: (channelIds: string[]) => void
  // Playback receives the entire logical stream group (every quality
  // variant), not a single channel/source pair — see eventPlaybackGroup.ts.
  onWatch: (group: EventPlaybackGroup) => void
}

// Subtle section header above a contiguous run of same-country rows: flag +
// uppercase name, and nothing else — no rule, no border, no card. The trailing
// hairline that used to run from the name to the right edge was removed once
// the match artwork started bleeding down behind this row: a 1px line drawn
// across a photo reads as a seam rather than as structure. The flat 'other'
// bucket (every non-preferred country, unsplit) gets a plain muted label
// instead of a flag.
function CountrySectionHeader({ section }: { section: CountryGroupSection }) {
  if (section.kind === 'other') {
    return (
      <div className="stream-country-header stream-country-header-other">
        <span className="stream-country-header-name">Other countries</span>
      </div>
    )
  }
  const flag = section.countryCode ? flagSrc(section.countryCode) : null
  return (
    <div className="stream-country-header">
      {flag && <img className="stream-country-header-flag" src={flag} alt="" />}
      <span className="stream-country-header-name">{section.countryName ?? section.countryCode}</span>
    </div>
  )
}

// The whole stream area once matches are ready: every trusted group,
// grouped into subtle per-country sections, as one flowing list — no filter
// pills, no "Recommended" vs "All" view switch, no ranking-explanation copy
// (task section 24). The single best stream across the whole event is
// called out via `topPickKey` (StreamRow's `primary` prop) rather than a
// separate section — row order and country grouping already communicate
// rank.
export function StreamList({
  partitioned,
  favoriteCountries,
  topPickKey,
  ...shared
}: {
  partitioned: PartitionedStreamOptions
  // The user's own ORDERED preferred-country list — index 0 is primary
  // (see data/preferences.ts) — threaded through purely to decide country
  // section headers; ranking itself already baked this in upstream (see
  // EventDetailsScreen.tsx's rankEventStreamOptions call).
  favoriteCountries: readonly string[]
  topPickKey?: string
} & SharedRowProps) {
  const options = partitioned.trusted
  const candidates = partitioned.candidates

  // Country is a section HEADING for every bucket that names a single
  // country, and a per-row tag inside the one bucket that does not — see
  // renderRow. groupOptionsByCountry returns one section per distinguishable
  // bucket (primary/preferred countries individually, everything else as one
  // shared "other" bucket), so this always has at least one section whenever
  // there's at least one trusted option.
  const sections = groupOptionsByCountry(options, favoriteCountries)

  function renderRow(option: RankedEventStreamOption, isFirstOverall: boolean, section: CountryGroupSection) {
    return (
      <StreamRow
        key={option.key}
        focusKey={option.key}
        option={option}
        variant="default"
        primary={option.key === topPickKey}
        // Only inside the flat "Other countries" bucket. Every other
        // section is one country with its own flag and name in the heading
        // above, so a per-row tag there would just repeat it — see
        // StreamRow's showCountry.
        showCountry={section.kind === 'other'}
        onArrowUp={isFirstOverall ? () => void setFocus(BACK_FOCUS_KEY) : undefined}
        {...shared}
      />
    )
  }

  return (
    <>
      {sections.map((section, sectionIndex) => (
        <div key={`${section.kind}-${section.countryCode ?? 'other'}-${sectionIndex}`} className="stream-country-section">
          <CountrySectionHeader section={section} />
          <div className="stream-row-list">
            {section.options.map((option, rowIndex) => renderRow(option, sectionIndex === 0 && rowIndex === 0, section))}
          </div>
        </div>
      ))}

      {candidates.length > 0 && (
        <CandidateStreamList
          options={candidates}
          defaultOpen={options.length === 0}
          onFirstRowUp={options.length === 0 ? () => void setFocus(BACK_FOCUS_KEY) : undefined}
          {...shared}
        />
      )}
    </>
  )
}

// Loose/fuzzy candidates (see streamConfidence.ts) — collapsed by default
// once trusted matches exist (a dozen loose guesses under a confident pick
// is noise), open by default when they're all there is to show. One-way
// expand, same as the old "Show N more channels" toggle it replaces.
export function CandidateStreamList({
  options,
  defaultOpen,
  onFirstRowUp,
  ...shared
}: { options: RankedEventStreamOption[]; defaultOpen: boolean; onFirstRowUp?: () => void } & SharedRowProps) {
  const [open, setOpen] = useState(defaultOpen)
  const { ref: toggleRef, focused: toggleFocused } = useFocusable({
    focusKey: CANDIDATE_TOGGLE_FOCUS_KEY,
    onEnterPress: () => {
      setOpen(true)
      // The toggle button unmounts the instant `open` becomes true (see
      // `{!open && <button>...}` below) and is replaced by the candidate
      // rows — without explicitly moving focus, it was left pointing at a
      // component that had just been removed from the tree. Uses a stable
      // key (see StreamRow's `focusKey` prop, `option.key`) rather than a
      // timer, same pattern as every other "an action is replaced by newly
      // rendered children" case in this pass.
      if (options[0]) void setFocus(options[0].key)
    },
  })
  useFocusScrollIntoView(toggleRef, toggleFocused)

  if (options.length === 0) return null
  return (
    <section className="stream-section-candidates">
      {!open && (
        <button ref={toggleRef} className={`stream-section-toggle ${toggleFocused ? 'focused' : ''}`} onClick={() => setOpen(true)}>
          {options.length} more channel{options.length === 1 ? '' : 's'} that might have it
        </button>
      )}
      {open && (
        <div className="stream-row-list stream-row-list-compact">
          {options.map((option, index) => (
            <StreamRow
              key={option.key}
              focusKey={option.key}
              option={option}
              variant="candidate"
              // Candidates are one flat, ungrouped list with no country
              // headings at all, so every row here has to carry its own.
              showCountry
              onArrowUp={index === 0 ? onFirstRowUp : undefined}
              {...shared}
            />
          ))}
        </div>
      )}
    </section>
  )
}
