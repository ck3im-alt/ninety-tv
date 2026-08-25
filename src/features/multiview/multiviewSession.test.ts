import { describe, expect, it } from 'vitest'
import {
  MAX_MULTIVIEW_STREAMS,
  addPane,
  createMultiviewSession,
  removePane,
  replacePaneAssignment,
  rerankPaneForActiveCount,
  selectPaneSource,
  setAudioPane,
  setFocusedPane,
  setMaximizedPane,
  setMuted,
  updatePaneCandidates,
} from './multiviewSession'
import type { PaneAssignment } from './multiviewSession'
import type { MultiviewSourceCandidate } from './multiviewCandidates'
import type { Channel } from '../../data/channel'
import type { QualityTier } from '../eventDetails/rankStreamQuality'

let counter = 0
function channelAssignment(name = 'Channel'): PaneAssignment {
  counter += 1
  const channel: Channel = { id: `ch-${counter}`, name, sources: [{ label: 'Default', url: `http://x/${counter}` }] }
  return { kind: 'channel', channel }
}

function candidateList(...tiers: QualityTier[]): MultiviewSourceCandidate[] {
  return tiers.map((qualityTier, i) => {
    counter += 1
    const channel: Channel = { id: `cand-${counter}`, name: 'Cand', sources: [] }
    return {
      channel,
      source: { label: String(i), url: `http://y/${counter}` },
      qualityTier,
      qualityLabel: null,
      displayName: 'Cand',
    }
  })
}

describe('multiviewSession', () => {
  it('creates a 1-pane session with focus and audio on that pane', () => {
    const session = createMultiviewSession(channelAssignment())
    expect(session.panes).toHaveLength(1)
    expect(session.focusedPaneId).toBe(session.panes[0].id)
    expect(session.audioPaneId).toBe(session.panes[0].id)
    expect(session.maximizedPaneId).toBeNull()
    expect(session.muted).toBe(false)
  })

  it('adds panes into free slots and moves focus to the newly added pane', () => {
    let session = createMultiviewSession(channelAssignment())
    session = addPane(session, channelAssignment())
    expect(session.panes).toHaveLength(2)
    expect(session.focusedPaneId).toBe(session.panes[1].id)
  })

  it('enforces MAX_MULTIVIEW_STREAMS — a 5th pane is rejected', () => {
    let session = createMultiviewSession(channelAssignment())
    for (let i = 0; i < 5; i++) session = addPane(session, channelAssignment())
    expect(session.panes).toHaveLength(MAX_MULTIVIEW_STREAMS)
  })

  it('removePane drops the pane and leaves the rest untouched', () => {
    let session = createMultiviewSession(channelAssignment())
    session = addPane(session, channelAssignment())
    session = addPane(session, channelAssignment())
    const [p0, , p2] = session.panes
    session = removePane(session, session.panes[1].id)
    expect(session.panes.map((p) => p.id)).toEqual([p0.id, p2.id])
  })

  it('removing the FOCUSED pane reassigns focus to the first remaining pane, without touching audio', () => {
    let session = createMultiviewSession(channelAssignment())
    session = addPane(session, channelAssignment())
    const audioBefore = session.panes[0].id
    session = setAudioPane(session, audioBefore)
    session = setFocusedPane(session, session.panes[1].id)
    session = removePane(session, session.panes[1].id) // remove the focused pane
    expect(session.focusedPaneId).toBe(session.panes[0].id)
    expect(session.audioPaneId).toBe(audioBefore) // unaffected
  })

  it('removing the AUDIO pane reassigns audio to the first remaining pane, without touching focus', () => {
    let session = createMultiviewSession(channelAssignment())
    session = addPane(session, channelAssignment())
    session = setFocusedPane(session, session.panes[0].id)
    const audioPaneId = session.panes[1].id
    session = setAudioPane(session, audioPaneId)
    session = removePane(session, audioPaneId)
    expect(session.audioPaneId).toBe(session.panes[0].id)
    expect(session.focusedPaneId).toBe(session.panes[0].id)
  })

  it('removePane clears maximizedPaneId only if the maximized pane itself was removed', () => {
    let session = createMultiviewSession(channelAssignment())
    session = addPane(session, channelAssignment())
    const other = session.panes[0].id
    const maximized = session.panes[1].id
    session = setMaximizedPane(session, maximized)
    session = removePane(session, other)
    expect(session.maximizedPaneId).toBe(maximized)
    session = removePane(session, maximized)
    expect(session.maximizedPaneId).toBeNull()
  })

  it('replacePaneAssignment keeps the slot id but resets assignmentId/candidates/resolution', () => {
    let session = createMultiviewSession(channelAssignment())
    const paneId = session.panes[0].id
    const originalAssignmentId = session.panes[0].assignmentId
    session = updatePaneCandidates(session, paneId, candidateList(3), 'ready')
    session = replacePaneAssignment(session, paneId, channelAssignment('New channel'))
    const pane = session.panes[0]
    expect(pane.id).toBe(paneId)
    expect(pane.assignmentId).not.toBe(originalAssignmentId)
    expect(pane.candidates).toEqual([])
    expect(pane.resolution).toBe('loading')
    expect(pane.userPickedSource).toBe(false)
  })

  describe('focus vs audio independence', () => {
    it('setFocusedPane never changes audioPaneId', () => {
      let session = createMultiviewSession(channelAssignment())
      session = addPane(session, channelAssignment())
      const audioBefore = session.audioPaneId
      session = setFocusedPane(session, session.panes[1].id)
      expect(session.focusedPaneId).toBe(session.panes[1].id)
      expect(session.audioPaneId).toBe(audioBefore)
    })

    it('setAudioPane never changes focusedPaneId, and clears session mute', () => {
      let session = createMultiviewSession(channelAssignment())
      session = addPane(session, channelAssignment())
      session = setMuted(session, true)
      const focusBefore = session.focusedPaneId
      session = setAudioPane(session, session.panes[1].id)
      expect(session.audioPaneId).toBe(session.panes[1].id)
      expect(session.focusedPaneId).toBe(focusBefore)
      expect(session.muted).toBe(false)
    })

    it('is a no-op for an unknown pane id', () => {
      const session = createMultiviewSession(channelAssignment())
      expect(setFocusedPane(session, 'nope')).toBe(session)
      expect(setAudioPane(session, 'nope')).toBe(session)
    })
  })

  describe('Multiview-aware ranking triggers only at explicit points', () => {
    it('updatePaneCandidates auto-selects using the CURRENT pane count at assignment time', () => {
      let session = createMultiviewSession(channelAssignment())
      session = addPane(session, channelAssignment())
      session = addPane(session, channelAssignment()) // 3 panes now, ceiling = tier 3
      const paneId = session.panes[2].id
      session = updatePaneCandidates(session, paneId, candidateList(5, 3), 'ready')
      expect(session.panes[2].sourceIndex).toBe(1) // skips the tier-5 pick, takes tier-3
    })

    it('adding or removing a DIFFERENT pane never re-ranks or reloads an already-resolved pane', () => {
      let session = createMultiviewSession(channelAssignment())
      const firstPaneId = session.panes[0].id
      session = updatePaneCandidates(session, firstPaneId, candidateList(5), 'ready') // 1 pane, tier 5 chosen
      const beforeSourceIndex = session.panes[0].sourceIndex
      const beforeCandidates = session.panes[0].candidates

      session = addPane(session, channelAssignment())
      session = addPane(session, channelAssignment())
      const secondPane = session.panes[1]
      session = removePane(session, secondPane.id)

      const firstPaneAfter = session.panes.find((p) => p.id === firstPaneId)!
      expect(firstPaneAfter.sourceIndex).toBe(beforeSourceIndex)
      expect(firstPaneAfter.candidates).toBe(beforeCandidates)
    })

    it('a manually picked source is never overridden by updatePaneCandidates', () => {
      let session = createMultiviewSession(channelAssignment())
      const paneId = session.panes[0].id
      session = updatePaneCandidates(session, paneId, candidateList(5, 3), 'ready')
      session = selectPaneSource(session, paneId, 1) // user manually picks the tier-3 one
      session = updatePaneCandidates(session, paneId, candidateList(5, 3), 'ready') // re-resolved again
      expect(session.panes[0].sourceIndex).toBe(1)
      expect(session.panes[0].userPickedSource).toBe(true)
    })

    it('rerankPaneForActiveCount upgrades a maximized pane (treated as count=1) and respects manual picks', () => {
      let session = createMultiviewSession(channelAssignment())
      session = addPane(session, channelAssignment())
      session = addPane(session, channelAssignment())
      const paneId = session.panes[0].id
      session = updatePaneCandidates(session, paneId, candidateList(5, 3), 'ready') // 3 panes -> tier 3 chosen
      expect(session.panes[0].sourceIndex).toBe(1)

      session = rerankPaneForActiveCount(session, paneId, 1) // maximized -> upgrade
      expect(session.panes[0].sourceIndex).toBe(0)

      session = selectPaneSource(session, paneId, 1) // user overrides back to tier 3 manually
      session = rerankPaneForActiveCount(session, paneId, 1) // maximize again — must respect the manual pick
      expect(session.panes[0].sourceIndex).toBe(1)
    })
  })
})
