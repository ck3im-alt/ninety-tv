// The "+ Add event" grid cell — just the next empty slot, focusable only
// while under MAX_MULTIVIEW_STREAMS (see App.tsx/MultiviewScreen, which
// stop rendering this at all once the session is full, rather than
// rendering a disabled/dead focus target — see the app's own hardened-nav
// precedent against always-registered-but-meaningless focusables).
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import './AddEventSlot.css'

export function AddEventSlot({ focusKey, forceFocus, onSelect }: { focusKey: string; forceFocus: boolean; onSelect: () => void }) {
  const { ref, focused } = useFocusable({ focusKey, forceFocus, onEnterPress: onSelect })
  return (
    <button ref={ref} className={`add-event-slot ${focused ? 'focused' : ''}`} onClick={onSelect}>
      <span className="add-event-slot-icon">+</span>
      <span className="add-event-slot-label">Add event</span>
    </button>
  )
}
