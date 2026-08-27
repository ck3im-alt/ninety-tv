// @vitest-environment jsdom
//
// A pane menu's "Change source" sub-view must arrive with real, visible
// focus on a real row.
//
// It used to arrive with none. The two views shared one mounted component
// and swapped the focusKey passed to useModalFocusScope — but norigin
// registers a container in a mount-only effect, so the container stayed
// registered under the main menu's key, updateFocusable(newKey, ...) had
// nothing to update, and the scope's setFocus(newKey) parked spatial focus
// on a key with no component behind it. The source list rendered with no
// focused row, OK did nothing, and only the hardware Back key got the
// viewer out — inside Multiview, with up to four streams still decoding.
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { doesFocusableExist, getCurrentFocusKey, init } from '@noriginmedia/norigin-spatial-navigation'
import { handleBackPress } from '../../core/platform/backHandler'
import { PaneMenu } from './PaneMenu'
import type { MultiviewSourceCandidate } from './multiviewCandidates'

init({ debug: false, visualDebug: false })
Element.prototype.scrollIntoView = () => {}

function candidates(): MultiviewSourceCandidate[] {
  return (['HD', 'SD'] as const).map((label, i) => ({
    channel: { id: `ch-${label}`, name: label, sources: [{ label, url: `https://provider.example/${label}.ts` }] },
    source: { label, url: `https://provider.example/${label}.ts` },
    qualityTier: (2 - i) as MultiviewSourceCandidate['qualityTier'],
    qualityLabel: label,
    displayName: label,
  }))
}

function renderMenu(overrides: Partial<{ activeSourceIndex: number }> = {}) {
  const onSelectSource = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <PaneMenu
      paneId="pane-0"
      isMaximized={false}
      isAudioPane
      sessionMuted={false}
      candidates={candidates()}
      activeSourceIndex={overrides.activeSourceIndex ?? 0}
      canGoLive
      onMakeFullscreen={() => {}}
      onRestoreGrid={() => {}}
      onSelectSource={onSelectSource}
      onUseAudio={() => {}}
      onToggleSessionMute={() => {}}
      onRestart={() => {}}
      onGoLive={() => {}}
      onReplaceEvent={() => {}}
      onRemove={() => {}}
      onClose={onClose}
    />,
  )
  const rows = () => [...view.container.querySelectorAll('.pane-menu-row')]
  const focusedRow = () => view.container.querySelector('.pane-menu-row.focused')?.textContent
  return { ...view, rows, focusedRow, onSelectSource, onClose }
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

afterEach(cleanup)

describe('the Multiview pane menu', () => {
  it('opens the source list with the current source focused and actionable', async () => {
    const { rows, focusedRow, onSelectSource } = renderMenu({ activeSourceIndex: 1 })
    await settle()

    await act(async () => {
      ;(rows().find((r) => r.textContent?.includes('Change source')) as HTMLElement).click()
    })
    await settle()

    // Whatever holds focus must actually exist — this is what "OK does
    // nothing and no row is highlighted" looked like from the couch.
    const key = getCurrentFocusKey()
    expect(key).not.toBeNull()
    expect(doesFocusableExist(key!)).toBe(true)
    // And it must be the source the pane is playing, visibly.
    expect(key).toBe('pane-0-menu-sources-1')
    expect(focusedRow()).toContain('SD')

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 })
    })
    expect(onSelectSource).toHaveBeenCalledWith(1)
  })

  it('returns to the main menu on Back, with focus on a real row', async () => {
    const { rows, focusedRow, onClose } = renderMenu()
    await settle()

    await act(async () => {
      ;(rows().find((r) => r.textContent?.includes('Change source')) as HTMLElement).click()
    })
    await settle()
    expect(rows().some((r) => r.textContent?.includes('Change source'))).toBe(false)

    // main.tsx's attachGlobalBackListener is not installed in a unit test,
    // so the press is delivered through the stack the way that listener
    // would deliver it.
    await act(async () => {
      expect(handleBackPress()).toBe(true)
    })
    await settle()

    // Back out of the sub-view returns to the menu, not out of the menu.
    expect(onClose).not.toHaveBeenCalled()
    expect(rows().some((r) => r.textContent?.includes('Change source'))).toBe(true)
    expect(doesFocusableExist(getCurrentFocusKey()!)).toBe(true)
    expect(focusedRow()).toBeTruthy()
  })
})
