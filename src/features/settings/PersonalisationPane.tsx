// "What should Ninety recommend, and how should it rank what it finds?"
//
// TWO GROUPS, TWO DIFFERENT KINDS OF PREFERENCE, and the distinction is
// load-bearing rather than cosmetic:
//
//   HOME RECOMMENDATIONS decide what Home may SHOW you. These modes can and
//   do hide events — that is the entire point of "My leagues only" — so
//   nothing in this group may ever be described as harmless.
//
//   STREAM PREFERENCE decides the ORDER two ways of watching the same match
//   are offered in. It is a ranking boost and never a filter: the
//   non-preferred kind still appears whenever it is better or the only way
//   to watch (see buildEventStreamOptions.ts's scoring).
//
// That is why "it never hides anything" stays attached to the stream group's
// own copy and is NOT promoted to the pane hint — as a statement about the
// whole pane it would be flatly untrue, and untrue in the direction that
// makes a viewer distrust the app when matches go missing.
//
// This pane was called Playback until 2026-08-28, when it held only the
// stream-type choice. See settingsSections.ts for why it was renamed rather
// than joined by a sixth rail destination.
//
// Consumer wording only: "Event Streams", never the IPTV-internal "PPV".
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { SettingsColumnHeader, SettingsPaneHeader, SettingsRow } from './settingsPrimitives'
import { PANE_ENTRY_FOCUS_KEY } from './useSettingsFocusable'
import { HOME_CONTENT_MODE_CHOICES } from '../../data/sports/homeContentModeChoices'
import type { HomeContentMode, StreamTypePreference } from '../../data/preferences'

// Descriptions are this SURFACE's own, while the ids, order, names and the
// recommended marker come from the shared choice model — so Settings and
// onboarding can never disagree about what the modes are, only about how
// much room they have to explain them.
const HOME_MODE_DESCRIPTIONS: Record<HomeContentMode, string> = {
  all: 'Show all relevant matches. Your leagues and teams rank higher.',
  highlights: 'Prioritise what you follow, while still surfacing major matches from elsewhere.',
  favorites_only: 'Only show football from leagues you follow.',
}

const STREAM_CHOICES: Array<{ id: StreamTypePreference; label: string; description: string }> = [
  { id: 'auto', label: 'Auto', description: 'Choose the best available stream' },
  { id: 'tv', label: 'TV Channels', description: 'Prefer regular broadcast channels' },
  { id: 'event', label: 'Event Streams', description: 'Prefer match-specific streams' },
]

// THE VERTICAL FOCUS CHAIN, stated once as data.
//
// With one group this pane could get away with "first row is the pane entry,
// everything else is index arithmetic". With two, every boundary press —
// Down off the last Home mode, Up off the first stream choice — crosses a
// heading and a group container, which is exactly the case norigin's
// geometric search (>=20% overlap required) gets wrong. So both groups are
// flattened into ONE ordered list of focus keys and every Up/Down is
// answered by looking the current key up in it.
//
// Deliberately does not wrap: Up at the top and Down at the bottom consume
// the press and stay put, matching every other Settings pane and the rail
// itself. Left always returns to the rail; Right is consumed so focus can
// never escape to the (invisible) screen root.
const HOME_MODE_FOCUS_PREFIX = 'settings-home-mode-'
const STREAM_FOCUS_PREFIX = 'settings-stream-type-'

function homeModeFocusKey(mode: HomeContentMode): string {
  // The first row of the first group is the pane's shared entry point, so
  // "Right from the rail" is one deterministic setFocus (see
  // PANE_ENTRY_FOCUS_KEY) rather than a geometric guess.
  return mode === HOME_CONTENT_MODE_CHOICES[0].id ? PANE_ENTRY_FOCUS_KEY : `${HOME_MODE_FOCUS_PREFIX}${mode}`
}

function streamTypeFocusKey(streamType: StreamTypePreference): string {
  return `${STREAM_FOCUS_PREFIX}${streamType}`
}

const FOCUS_CHAIN: readonly string[] = [
  ...HOME_CONTENT_MODE_CHOICES.map((choice) => homeModeFocusKey(choice.id)),
  ...STREAM_CHOICES.map((choice) => streamTypeFocusKey(choice.id)),
]

function move(from: string, delta: 1 | -1): () => void {
  const index = FOCUS_CHAIN.indexOf(from)
  const target = FOCUS_CHAIN[index + delta]
  // No neighbour in that direction means the edge of the pane: consume the
  // press rather than letting the search escape upward to a root focusable
  // that draws no ring at all.
  return target ? () => void setFocus(target) : () => {}
}

export function PersonalisationPane({
  homeContentMode,
  streamType,
  onSelectHomeContentMode,
  onSelectStreamType,
  onLeaveToRail,
}: {
  homeContentMode: HomeContentMode
  streamType: StreamTypePreference
  onSelectHomeContentMode: (value: HomeContentMode) => void
  onSelectStreamType: (value: StreamTypePreference) => void
  onLeaveToRail: () => void
}) {
  return (
    <>
      <SettingsPaneHeader
        title="Personalisation"
        hint="Control what Ninety surfaces on Home and how it ranks available streams."
      />

      <section className="settings-group">
        <SettingsColumnHeader title="Home recommendations" />
        <div className="settings-list bounded">
          {HOME_CONTENT_MODE_CHOICES.map((choice) => {
            const key = homeModeFocusKey(choice.id)
            return (
              <SettingsRow
                key={choice.id}
                focusKey={key}
                label={choice.label}
                sublabel={HOME_MODE_DESCRIPTIONS[choice.id]}
                // The recommendation rides in the row's existing right-hand
                // value slot rather than introducing a badge component — a
                // new visual language for one word would be the only thing
                // on this screen that looks like nothing else on it.
                value={choice.recommended ? 'Recommended' : undefined}
                mark="radio"
                selected={homeContentMode === choice.id}
                onEnter={() => onSelectHomeContentMode(choice.id)}
                onLeft={onLeaveToRail}
                onRight={() => {}}
                onUp={move(key, -1)}
                onDown={move(key, 1)}
              />
            )
          })}
        </div>
      </section>

      <section className="settings-group">
        <SettingsColumnHeader title="Stream preference" />
        <p className="settings-group-hint">
          Which kind of stream should rank first when a match is available on both? This changes the order Ninety
          suggests them in — it never hides anything.
        </p>
        <div className="settings-list bounded">
          {STREAM_CHOICES.map((choice) => {
            const key = streamTypeFocusKey(choice.id)
            return (
              <SettingsRow
                key={choice.id}
                focusKey={key}
                label={choice.label}
                sublabel={choice.description}
                mark="radio"
                selected={streamType === choice.id}
                onEnter={() => onSelectStreamType(choice.id)}
                onLeft={onLeaveToRail}
                onRight={() => {}}
                onUp={move(key, -1)}
                onDown={move(key, 1)}
              />
            )
          })}
        </div>
      </section>
    </>
  )
}
