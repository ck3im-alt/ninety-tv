import { describe, expect, it } from 'vitest'
import { ROOT_FOCUS_KEY } from '@noriginmedia/norigin-spatial-navigation'
import { pickModalRestoreFocusKey } from './useModalFocusScope'

// Regression coverage for "invalid remembered target uses fallback" (see
// the navigation-hardening pass's focus-memory model): a modal (Filter,
// Admin, the player's Source/Text popups) must never restore focus to an
// opener that unmounted while the modal was open.
describe('pickModalRestoreFocusKey', () => {
  it('restores the exact opener when it still exists', () => {
    expect(pickModalRestoreFocusKey('filter-button', true)).toBe('filter-button')
  })

  it('falls back to ROOT_FOCUS_KEY by default when the opener no longer exists', () => {
    expect(pickModalRestoreFocusKey('category-channel-row-3', false)).toBe(ROOT_FOCUS_KEY)
  })

  it('falls back to a caller-supplied key when the opener no longer exists', () => {
    expect(pickModalRestoreFocusKey('category-channel-row-3', false, 'category-channels-back')).toBe('category-channels-back')
  })
})
