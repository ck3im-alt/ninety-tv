import { describe, expect, it } from 'vitest'
import { CASCADE_FULL_PANE_COUNT, isCompactCountryRail, previousCascadeStep } from './cascadeNavigation'

describe('previousCascadeStep', () => {
  it('steps preview -> channel', () => {
    expect(previousCascadeStep('preview')).toEqual({ level: 'channel' })
  })

  it('steps channel -> category', () => {
    expect(previousCascadeStep('channel')).toEqual({ level: 'category' })
  })

  it('steps category -> country', () => {
    expect(previousCascadeStep('category')).toEqual({ level: 'country' })
  })

  it('exits the screen from country (the top level)', () => {
    expect(previousCascadeStep('country')).toEqual({ exit: true })
  })
})

// The Country column collapses to a flag-only rail in the four-pane state
// only. One shared rule so the TSX (ListRow's `compact` prop) and the CSS
// ([data-cols='4']) cannot disagree — see isCompactCountryRail's own comment.
describe('isCompactCountryRail', () => {
  it('collapses the Country column at four panes', () => {
    expect(isCompactCountryRail(4)).toBe(true)
  })

  it('leaves the Country column full-width at one, two and three panes', () => {
    expect(isCompactCountryRail(1)).toBe(false)
    expect(isCompactCountryRail(2)).toBe(false)
    expect(isCompactCountryRail(3)).toBe(false)
  })

  it('matches the documented pane count rather than a loose magic number', () => {
    expect(CASCADE_FULL_PANE_COUNT).toBe(4)
  })
})
