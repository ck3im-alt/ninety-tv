// @vitest-environment jsdom
//
// Coverage for ListRow's `compact` (flag-only) mode, added 2026-08-26 for
// Browse Cascade's four-pane Country rail. The point of the mode is that the
// label/count/chevron are not RENDERED (not merely CSS-hidden) while the
// country itself stays identifiable and every existing callback keeps
// working — and that Category rows, which share this component, are
// unaffected.
//
// Rendering/semantics only: jsdom has no layout, so norigin's directional
// search can't be exercised here. The arrow handlers below are invoked
// directly against the row's own onArrowPress contract instead — see
// cascadeNavigation.test.ts for the pure "when does the rail collapse" rule.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { init } from '@noriginmedia/norigin-spatial-navigation'
import { ListRow } from './ListRow'

init({ debug: false, visualDebug: false })
Element.prototype.scrollIntoView = () => {}

const flag = <img className="flag-icon" src="no.svg" alt="" />
const row = () => document.querySelector('.list-row')!

afterEach(() => {
  cleanup()
})

describe('ListRow — full (default) mode', () => {
  it('renders the country name, channel count and chevron', () => {
    render(<ListRow label="Norway" count={412} icon={flag} onSelect={() => {}} />)
    expect(screen.getByText('Norway')).toBeTruthy()
    expect(screen.getByText('412 channels')).toBeTruthy()
    expect(row().querySelector('.list-row-chevron')).toBeTruthy()
    expect(row().className).not.toContain('list-row-compact')
  })

  it('does not put the label on the row as aria-label/title (the visible text already names it)', () => {
    render(<ListRow label="Norway" count={412} icon={flag} onSelect={() => {}} />)
    expect(row().getAttribute('aria-label')).toBeNull()
    expect(row().getAttribute('title')).toBeNull()
  })
})

describe('ListRow — compact (flag-only rail) mode', () => {
  it('renders the flag but not the label, count or chevron', () => {
    render(<ListRow label="Norway" count={412} icon={flag} onSelect={() => {}} compact />)
    expect(row().querySelector('.flag-icon')).toBeTruthy()
    expect(screen.queryByText('Norway')).toBeNull()
    expect(screen.queryByText('412 channels')).toBeNull()
    expect(row().querySelector('.list-row-chevron')).toBeNull()
  })

  // The label must not be LOST, only moved — a flag alone is not an
  // accessible name.
  it('keeps the country name available as the row’s accessible name and tooltip', () => {
    render(<ListRow label="Norway" count={412} icon={flag} onSelect={() => {}} compact />)
    expect(row().getAttribute('aria-label')).toBe('Norway')
    expect(row().getAttribute('title')).toBe('Norway')
  })

  it('marks itself with list-row-compact so the rail CSS can target it', () => {
    render(<ListRow label="Norway" count={412} icon={flag} onSelect={() => {}} compact />)
    expect(row().className).toContain('list-row-compact')
  })

  it('keeps the active and focused states distinguishable (both are class-driven, not label-driven)', () => {
    render(<ListRow label="Norway" count={412} icon={flag} onSelect={() => {}} compact active />)
    expect(row().className).toContain('active')
    expect(row().className).not.toContain('focused')
  })

  it('still fires onSelect — the row is a full target, not a decorative flag', () => {
    const onSelect = vi.fn()
    render(<ListRow label="Norway" count={412} icon={flag} onSelect={onSelect} compact />)
    ;(row() as HTMLElement).click()
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})

describe('ListRow — Category rows are unaffected by the country rail', () => {
  it('keeps its full row (label, count, chevron) when compact is not passed', () => {
    render(<ListRow label="Sports" count={57} onSelect={() => {}} focusKey="cat" favorited={false} onToggleFavorite={() => {}} />)
    expect(screen.getByText('Sports')).toBeTruthy()
    expect(screen.getByText('57 channels')).toBeTruthy()
    expect(row().querySelector('.list-row-chevron')).toBeTruthy()
    expect(row().querySelector('.list-row-favorite')).toBeTruthy()
  })
})
