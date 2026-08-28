// The React half of focusRecovery.ts: turning "the focused item just
// disappeared" into an actual setFocus call.
//
// focusRecovery.ts decides WHERE focus should go (next item, else previous,
// else nothing) and stays pure so that decision is unit-testable. Several
// screens then hand-rolled the same wiring around it — a prevRef, an effect
// keyed on the list, findIndex, setFocus (see CategoryChannelsScreen and
// BrowseCascadeScreen). This is that wiring, stated once, for the case those
// two cannot express: a list with NO selection state of its own, where the
// only record of what the user was on is the spatial-navigation focus key.
//
// WHY AN EFFECT AND NOT THE ACTION HANDLER. When a focused focusable
// unmounts, the library schedules a debounced (300ms) "restore focus to my
// parent" — which walks up to the screen root and re-resolves from
// lastFocusedChild/preferredChildFocusKey, i.e. somewhere else entirely.
// Recovering from an effect wins that race deterministically: React flushes
// passive unmount effects (the vanished row's deregistration) and then
// passive mount effects (its replacement's registration) BEFORE this
// effect runs, so by the time it calls setFocus the destination is already
// registered — and setFocus cancels the pending auto-restore outright.
// Calling setFocus from the action handler instead races the render: the
// unmount can land between setFocus's cancel and its completion, which
// re-arms the auto-restore with nothing left to cancel it.
import { useEffect, useRef } from 'react'
import { getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { pickFallbackAfterIdRemoval } from './focusRecovery'

// One focusable row of a list that can change under the user's remote.
// `id` is the row's stable identity (a playlist id, a country name, a league
// id); `focusKey` is what it is registered under RIGHT NOW — the two are
// separate because a row's focus key can change while the row itself stays
// (a reorder that moves which row owns the pane's entry key, say).
export interface FocusListEntry {
  id: string
  focusKey: string
}

export interface FocusRecoveryOptions {
  // The list as it is rendered THIS render, in display order.
  items: readonly FocusListEntry[]
  // Where to go when the list can no longer supply a target — it emptied,
  // or a control this region owns vanished. Must be something that is still
  // mounted in the same region; null disables the anchor entirely.
  anchorFocusKey: string | null
  // Optional: focus keys that belong to this region but are not rows, and
  // that exist only for as long as the list does — a master/detail pane's
  // action column, which details the highlighted row and unmounts wholesale
  // when the last row goes. Focus sitting on one of those when `items`
  // empties is recovered to the anchor.
  //
  // Deliberately NOT "any key that has stopped existing": deregistration
  // runs through the library's own scheduler and is not guaranteed to have
  // happened by the time this effect runs, so asking it whether a key still
  // exists is a race. `items.length === 0` is a fact about this render.
  // Must be referentially stable — it is an effect dependency.
  dependentFocusKeys?: (focusKey: string) => boolean
}

export function useFocusRecovery({ items, anchorFocusKey, dependentFocusKeys }: FocusRecoveryOptions): void {
  const previousRef = useRef(items)

  useEffect(() => {
    const previous = previousRef.current
    previousRef.current = items
    if (previous === items) return

    const current = getCurrentFocusKey()
    if (!current) return

    const owner = previous.find((item) => item.focusKey === current)
    if (owner) {
      const survivor = items.find((item) => item.id === owner.id)
      if (survivor) {
        // Still in the list, but registered under a different key now.
        // The library captures a focusable's key at REGISTRATION, so the
        // row remounted and the key focus points at is retired.
        if (survivor.focusKey !== owner.focusKey) void setFocus(survivor.focusKey)
        return
      }
      const fallback = pickFallbackAfterIdRemoval(previous, items, owner.id, (item) => item.id)
      if (fallback) void setFocus(fallback.item.focusKey)
      else if (anchorFocusKey) void setFocus(anchorFocusKey)
      return
    }

    // Not a row — but a control that only existed because the list did,
    // and the list has just emptied. Nothing in `items` can name a
    // neighbour for it, so the anchor is the answer.
    if (anchorFocusKey && items.length === 0 && previous.length > 0 && dependentFocusKeys?.(current)) {
      void setFocus(anchorFocusKey)
    }
  }, [items, anchorFocusKey, dependentFocusKeys])
}
