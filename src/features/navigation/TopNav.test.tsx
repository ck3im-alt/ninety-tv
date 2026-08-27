// @vitest-environment jsdom
//
// TopNav has to answer two different questions at once — "which screen am I
// on?" and "where is the remote?" — and it used to answer both with the
// same accent text colour. On Home with focus on Home the two states were
// indistinguishable; moving focus one tab across left TWO tabs looking
// identical, which is exactly the ambiguity this pass exists to remove.
//
// Colour can't be asserted in jsdom, so these tests pin the structural half:
// the two states are carried by separate, independently observable signals
// (`active` + its underline vs `focused`), and every reachable target is a
// real spatial-nav target while every dead one is excluded.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrentFocusKey, init, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { TopNav } from './TopNav'

init({ debug: false, visualDebug: false })
Element.prototype.scrollIntoView = () => {}

function renderNav(props: Parameters<typeof TopNav>[0] = {}) {
  const view = render(<TopNav onSelectHome={() => {}} onSelectChannels={() => {}} onSelectSchedule={() => {}} onOpenSettings={() => {}} {...props} />)
  const items = () => [...view.container.querySelectorAll('.nav-item')]
  const byLabel = (label: string) => items().find((n) => n.textContent?.startsWith(label))!
  return { ...view, items, byLabel }
}

beforeEach(async () => {
  await setFocus('test-neutral-focus-key')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TopNav active vs focused', () => {
  it('marks the current screen without claiming focus for it', async () => {
    const { byLabel, container } = renderNav({ activeItem: 'Home' })
    await act(async () => {
      await Promise.resolve()
    })

    const home = byLabel('Home')
    expect(home.className).toContain('active')
    expect(home.className).not.toContain('focused')
    // The "you are here" signal is the underline — a channel focus never
    // uses, so the two can coexist on one tab and still read apart.
    expect(home.querySelector('.nav-underline')).toBeTruthy()
    expect(container.querySelectorAll('.nav-underline')).toHaveLength(1)
  })

  it('keeps active and focused on separate tabs distinguishable', async () => {
    const { byLabel, container } = renderNav({ activeItem: 'Home' })
    await act(async () => {
      await setFocus('nav-Schedule')
    })

    expect(byLabel('Home').className).toContain('active')
    expect(byLabel('Home').className).not.toContain('focused')
    expect(byLabel('Schedule').className).toContain('focused')
    expect(byLabel('Schedule').className).not.toContain('active')
    // Exactly one of each, ever.
    expect(container.querySelectorAll('.nav-item.active')).toHaveLength(1)
    expect(container.querySelectorAll('.nav-item.focused')).toHaveLength(1)
  })

  it('shows both states on one tab when the viewer is focused on the screen they are already on', async () => {
    const { byLabel } = renderNav({ activeItem: 'Channels' })
    await act(async () => {
      await setFocus('nav-Channels')
    })

    const channels = byLabel('Channels')
    expect(channels.className).toContain('active')
    expect(channels.className).toContain('focused')
    expect(channels.querySelector('.nav-underline')).toBeTruthy()
  })
})

describe('TopNav focus targets', () => {
  it('registers every wired tab plus the avatar as reachable targets', async () => {
    renderNav()
    for (const key of ['nav-Home', 'nav-Schedule', 'nav-Channels', 'nav-avatar']) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await setFocus(key)
      })
      expect(getCurrentFocusKey()).toBe(key)
    }
  })

  // A tab with no handler (Channels before playlist hydration finishes) must
  // not be a dead landing spot the remote can stop on. Asserted through
  // norigin's own container resolution, which filters children by
  // `focusable` — with only Schedule wired, resolving the bar must skip
  // Home and Channels entirely rather than land on the first one rendered.
  it('excludes unwired tabs from the focus tree', async () => {
    const { container } = render(<TopNav activeItem="Home" onSelectSchedule={() => {}} />)
    await act(async () => {
      await setFocus('top-nav')
    })

    expect(getCurrentFocusKey()).toBe('nav-Schedule')
    const home = [...container.querySelectorAll('.nav-item')].find((n) => n.textContent?.startsWith('Home'))
    expect(home?.className).not.toContain('clickable')
  })

  it('sends Down out of the bar to the screen-supplied target when one is given', async () => {
    render(
      <>
        <TopNav onSelectHome={() => {}} onOpenSettings={() => {}} downFocusKey="setup-first-field" />
        <DownTarget />
      </>,
    )
    await act(async () => {
      await setFocus('nav-avatar')
    })
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40 } as KeyboardEventInit))
      await Promise.resolve()
    })

    expect(getCurrentFocusKey()).toBe('setup-first-field')
  })
})

// Stands in for the standalone setup screen's first field — the case
// useNavDownEscape exists for, where nothing sits geometrically under the
// avatar.
function DownTarget() {
  const { ref } = useFocusable({ focusKey: 'setup-first-field' })
  return <div ref={ref} />
}
