// Pure Multiview session model. Lives in App.tsx state (same lifting
// pattern as the cascade-browser's drill-down position) so it survives the
// grid<->maximized view toggle and Back-to-Multiview — but holds no player
// instances (those are non-serializable and exist only inside each mounted
// pane's own usePlayerSession call, see MultiviewPane.tsx).
//
// Three things are DELIBERATELY kept independent, per real product
// feedback on an earlier draft of this feature:
//  - focusedPaneId (pure navigation) vs audioPaneId (only ever changed by
//    an explicit "Use audio" action) — see setFocusedPane/setAudioPane.
//  - Multiview-aware ranking (selectMultiviewSource) is invoked ONLY from
//    updatePaneCandidates (a pane's own resolution just finished) and
//    rerankPaneForActiveCount (that ONE pane is being maximized/
//    un-maximized) — there is deliberately no "pane count changed, re-rank
//    everyone" helper here. Adding/removing a pane never touches a
//    different, already-playing pane's selection.
import { selectMultiviewSource } from './multiviewStreamRanking'
import type { MultiviewSourceCandidate } from './multiviewCandidates'
import type { Channel } from '../../data/channel'
import type { SportEvent } from '../../data/sports/types'

// Bounds how many slots the UI ever offers. This is a PRODUCT ceiling, not
// a claim that the hardware can decode this many streams reliably — see
// MultiviewPane.tsx's independent per-pane error handling, which is the
// real safety net regardless of where the true hardware ceiling falls.
export const MAX_MULTIVIEW_STREAMS = 4

const SLOT_IDS = ['pane-0', 'pane-1', 'pane-2', 'pane-3'] as const satisfies readonly string[]

export type PaneAssignment = { kind: 'event'; event: SportEvent } | { kind: 'channel'; channel: Channel }

export type PaneResolutionStatus = 'loading' | 'ready' | 'not-found'

export interface MultiviewPane {
  // Stable grid-slot identity (pane-0..pane-3) — never changes once a pane
  // occupies a slot, even across Replace Event.
  id: string
  // Regenerated on a real reassignment (Add/Replace event or channel) —
  // NOT on a pure quality-tier change (Change source). MultiviewPane.tsx
  // keys its player-bearing subtree on this, so a real reassignment gets
  // guaranteed clean disposal via React's own unmount, while a quality
  // change stays on the same live controller/player instance.
  assignmentId: string
  assignment: PaneAssignment
  candidates: MultiviewSourceCandidate[]
  sourceIndex: number
  // Once true, automatic Multiview-aware re-ranking (updatePaneCandidates/
  // rerankPaneForActiveCount) never overrides this pane's selection again —
  // mirrors ChannelPlayerScreen's existing "explicit user choice wins"
  // precedent (userMutedRef).
  userPickedSource: boolean
  resolution: PaneResolutionStatus
}

export interface MultiviewSession {
  panes: MultiviewPane[]
  focusedPaneId: string
  // Which pane's Player currently has setMuted(false) — independent of
  // focusedPaneId, see the module header.
  audioPaneId: string
  maximizedPaneId: string | null
  // Session-wide "silence everything" toggle (the pane menu's Mute/Unmute
  // action) — independent of which pane holds audioPaneId.
  muted: boolean
}

let assignmentCounter = 0
export function generateAssignmentId(): string {
  assignmentCounter += 1
  return `assignment-${assignmentCounter}`
}

function nextFreeSlotId(session: Pick<MultiviewSession, 'panes'>): string | null {
  const used = new Set(session.panes.map((pane) => pane.id))
  return SLOT_IDS.find((id) => !used.has(id)) ?? null
}

function freshPane(id: string, assignment: PaneAssignment): MultiviewPane {
  return {
    id,
    assignmentId: generateAssignmentId(),
    assignment,
    candidates: [],
    sourceIndex: 0,
    userPickedSource: false,
    resolution: 'loading',
  }
}

// Builds a brand-new 1-pane session — the entry point from
// ChannelPlayerScreen's "Add to Multiview" (see App.tsx).
export function createMultiviewSession(assignment: PaneAssignment): MultiviewSession {
  const pane = freshPane(SLOT_IDS[0], assignment)
  return {
    panes: [pane],
    focusedPaneId: pane.id,
    audioPaneId: pane.id,
    maximizedPaneId: null,
    muted: false,
  }
}

// Adds a pane in the next free slot. No-ops (returns the same session) once
// MAX_MULTIVIEW_STREAMS is reached, or if every slot id is somehow already
// occupied — callers (AddEventSlot) are expected to hide the "+ Add event"
// affordance once full, but this is the actual enforcement point.
export function addPane(session: MultiviewSession, assignment: PaneAssignment): MultiviewSession {
  if (session.panes.length >= MAX_MULTIVIEW_STREAMS) return session
  const id = nextFreeSlotId(session)
  if (!id) return session
  const pane = freshPane(id, assignment)
  return { ...session, panes: [...session.panes, pane], focusedPaneId: pane.id }
}

// Removes a pane and deterministically reassigns focus/audio/maximize away
// from it if it held any of those roles — falls back to the first
// remaining pane (lowest slot index), never left dangling on a pane that no
// longer exists. A session left with zero panes is still valid data
// (MultiviewScreen/App.tsx decide whether an empty session means "exit
// Multiview entirely").
export function removePane(session: MultiviewSession, paneId: string): MultiviewSession {
  const panes = session.panes.filter((pane) => pane.id !== paneId)
  if (panes.length === session.panes.length) return session
  const fallbackId = panes[0]?.id ?? ''
  return {
    ...session,
    panes,
    focusedPaneId: session.focusedPaneId === paneId ? fallbackId : session.focusedPaneId,
    audioPaneId: session.audioPaneId === paneId ? fallbackId : session.audioPaneId,
    maximizedPaneId: session.maximizedPaneId === paneId ? null : session.maximizedPaneId,
  }
}

// Replaces what a slot is showing (Replace Event / picking a channel into
// an existing slot) — keeps the same slot id, gets a fresh assignmentId
// (full teardown/recreate of that pane's player, see the MultiviewPane
// field comment above) and resets its resolution state to start over.
export function replacePaneAssignment(session: MultiviewSession, paneId: string, assignment: PaneAssignment): MultiviewSession {
  return {
    ...session,
    panes: session.panes.map((pane) => (pane.id === paneId ? freshPane(pane.id, assignment) : pane)),
  }
}

// Pure navigation — never touches audioPaneId. No-op if paneId isn't a real
// pane (e.g. a stale focus target after a removal race).
export function setFocusedPane(session: MultiviewSession, paneId: string): MultiviewSession {
  if (!session.panes.some((pane) => pane.id === paneId)) return session
  return { ...session, focusedPaneId: paneId }
}

// The ONLY way audioPaneId changes besides pane removal's fallback above —
// always an explicit user action (a pane menu's "Use audio"). Also clears a
// session-wide mute, since picking a specific pane to listen to implies the
// user wants to hear it.
export function setAudioPane(session: MultiviewSession, paneId: string): MultiviewSession {
  if (!session.panes.some((pane) => pane.id === paneId)) return session
  return { ...session, audioPaneId: paneId, muted: false }
}

export function setMuted(session: MultiviewSession, muted: boolean): MultiviewSession {
  return { ...session, muted }
}

// Maximize/un-maximize — pass null to return to the grid. See
// MultiviewPane.tsx for how every OTHER pane responds by unmounting its
// player subtree while one is maximized.
export function setMaximizedPane(session: MultiviewSession, paneId: string | null): MultiviewSession {
  if (paneId != null && !session.panes.some((pane) => pane.id === paneId)) return session
  return { ...session, maximizedPaneId: paneId }
}

// Called once a pane's own resolution (useMultiviewPaneResolution) finishes
// — the ONLY place a pane's initial source gets Multiview-aware-ranked
// (selectMultiviewSource), using the pane count AT THIS MOMENT. Respects an
// already-manual pick: if the user already used Change source on this pane
// before its (re-)resolution settled, their choice is kept instead of being
// overridden by the auto-pick.
export function updatePaneCandidates(
  session: MultiviewSession,
  paneId: string,
  candidates: MultiviewSourceCandidate[],
  resolution: PaneResolutionStatus,
): MultiviewSession {
  return {
    ...session,
    panes: session.panes.map((pane) => {
      if (pane.id !== paneId) return pane
      if (pane.userPickedSource) return { ...pane, candidates, resolution }
      const chosen = selectMultiviewSource(candidates, session.panes.length)
      return { ...pane, candidates, resolution, sourceIndex: chosen === -1 ? 0 : chosen }
    }),
  }
}

// A manual "Change source" pick — marks the pane so future automatic
// re-ranking (updatePaneCandidates/rerankPaneForActiveCount) leaves it
// alone, matching ChannelPlayerScreen's existing userMutedRef precedent.
export function selectPaneSource(session: MultiviewSession, paneId: string, sourceIndex: number): MultiviewSession {
  return {
    ...session,
    panes: session.panes.map((pane) => (pane.id === paneId ? { ...pane, sourceIndex, userPickedSource: true } : pane)),
  }
}

// Re-ranks exactly ONE pane's already-resolved candidates for a new active
// pane count — invoked only when THAT pane is being maximized (count=1,
// upgrade) or un-maximized (real count, possible downgrade). Deliberately
// has no "for every pane" variant — see the module header: adding/removing
// a different pane must never restart this one.
export function rerankPaneForActiveCount(session: MultiviewSession, paneId: string, activePaneCount: number): MultiviewSession {
  return {
    ...session,
    panes: session.panes.map((pane) => {
      if (pane.id !== paneId || pane.userPickedSource || pane.candidates.length === 0) return pane
      const chosen = selectMultiviewSource(pane.candidates, activePaneCount)
      return chosen === -1 ? pane : { ...pane, sourceIndex: chosen }
    }),
  }
}
