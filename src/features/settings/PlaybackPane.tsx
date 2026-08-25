// "How should Ninety rank streams?"
//
// One real preference, because there is exactly one real product capability
// here: StreamTypePreference. It is a RANKING BOOST, never a filter — the
// non-preferred kind still appears whenever it is better or the only way to
// watch (see buildEventStreamOptions.ts's scoring), and the copy below is
// careful not to imply otherwise.
//
// Consumer wording only: "Event Streams", never the IPTV-internal "PPV".
// Nothing else lives here. Quality preference in particular is deliberately
// absent: the player already owns quality ranking and failover, and there is
// no persisted quality setting for Settings to expose — inventing one would
// mean inventing the behaviour behind it too.
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { SettingsPaneHeader, SettingsRow } from './settingsPrimitives'
import { PANE_ENTRY_FOCUS_KEY } from './useSettingsFocusable'
import type { StreamTypePreference } from '../../data/preferences'

const CHOICES: Array<{ id: StreamTypePreference; label: string; description: string }> = [
  { id: 'auto', label: 'Auto', description: 'Choose the best available stream' },
  { id: 'tv', label: 'TV Channels', description: 'Prefer regular broadcast channels' },
  { id: 'event', label: 'Event Streams', description: 'Prefer match-specific streams' },
]

export function PlaybackPane({
  streamType,
  onSelect,
  onLeaveToRail,
}: {
  streamType: StreamTypePreference
  onSelect: (value: StreamTypePreference) => void
  onLeaveToRail: () => void
}) {
  return (
    <>
      <SettingsPaneHeader
        title="Playback"
        hint="Which kind of stream should rank first when a match is available on both? This changes the order Ninety suggests them in — it never hides anything."
      />
      <div className="settings-list bounded">
        {CHOICES.map((choice, index) => (
          <SettingsRow
            key={choice.id}
            focusKey={index === 0 ? PANE_ENTRY_FOCUS_KEY : `settings-playback-${choice.id}`}
            label={choice.label}
            sublabel={choice.description}
            mark="radio"
            selected={streamType === choice.id}
            onEnter={() => onSelect(choice.id)}
            onLeft={onLeaveToRail}
            onRight={() => {}}
            onUp={index === 0 ? () => {} : () => void setFocus(focusKeyFor(index - 1))}
            onDown={index === CHOICES.length - 1 ? () => {} : () => void setFocus(focusKeyFor(index + 1))}
          />
        ))}
      </div>
    </>
  )
}

function focusKeyFor(index: number): string {
  return index === 0 ? PANE_ENTRY_FOCUS_KEY : `settings-playback-${CHOICES[index].id}`
}
