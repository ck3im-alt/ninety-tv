// @vitest-environment jsdom
//
// The wiring, not the decision — pickFallbackAfterRemoval's own choice of
// "next, else previous, else nothing" is covered in focusRecovery.test.ts.
// What is asserted here is the part that only shows up against a real focus
// tree: WHICH render this hook acts on, and that it beats the library's own
// debounced "the focused component vanished, focus its parent" restore.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { useState } from 'react'
import {
  FocusContext,
  destroy,
  getCurrentFocusKey,
  init,
  setFocus,
  useFocusable,
} from '@noriginmedia/norigin-spatial-navigation'
import { useFocusRecovery } from './useFocusRecovery'

init({ debug: false, visualDebug: false })
Element.prototype.scrollIntoView = () => {}

afterEach(() => {
  cleanup()
  destroy()
  init({ debug: false, visualDebug: false })
})

// AUTO_RESTORE_FOCUS_DELAY in norigin-spatial-navigation-core. Every
// assertion waits past it, because the failure this hook exists to prevent
// only happens once that debounce fires.
const settleAutoRestore = () => new Promise((resolve) => setTimeout(resolve, 400))

function Row({ focusKey }: { focusKey: string }) {
  const { ref } = useFocusable({ focusKey })
  return <div ref={ref} data-testid={focusKey} />
}

// A container standing in for a pane: a list that can shrink, one anchor
// control that never does, and the recovery hook wired over the list.
function Harness({ ids, anchorFocusKey = 'anchor' }: { ids: string[]; anchorFocusKey?: string }) {
  const { ref, focusKey } = useFocusable({ focusKey: 'root', trackChildren: true, preferredChildFocusKey: 'anchor' })
  useFocusRecovery({ items: ids.map((id) => ({ id, focusKey: `row-${id}` })), anchorFocusKey })
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref}>
        {ids.map((id) => (
          <Row key={id} focusKey={`row-${id}`} />
        ))}
        <Row focusKey="anchor" />
      </div>
    </FocusContext.Provider>
  )
}

function Controlled({ initial }: { initial: string[] }) {
  const [ids, setIds] = useState(initial)
  return (
    <>
      <button data-testid="drop-b" onClick={() => setIds((current) => current.filter((id) => id !== 'b'))} />
      <button data-testid="drop-c" onClick={() => setIds((current) => current.filter((id) => id !== 'c'))} />
      <button data-testid="drop-all" onClick={() => setIds([])} />
      <Harness ids={ids} />
    </>
  )
}

describe('useFocusRecovery', () => {
  it('moves focus to the item that slid into the removed one’s place', async () => {
    const { getByTestId } = render(<Controlled initial={['a', 'b', 'c']} />)
    void setFocus('row-b')
    await waitFor(() => expect(getCurrentFocusKey()).toBe('row-b'))

    getByTestId('drop-b').click()

    await settleAutoRestore()
    expect(getCurrentFocusKey()).toBe('row-c')
  })

  it('falls back to the previous item when the removed one was last', async () => {
    const { getByTestId } = render(<Controlled initial={['a', 'b', 'c']} />)
    void setFocus('row-c')
    await waitFor(() => expect(getCurrentFocusKey()).toBe('row-c'))

    getByTestId('drop-c').click()

    await settleAutoRestore()
    expect(getCurrentFocusKey()).toBe('row-b')
  })

  it('falls back to the anchor when the list empties', async () => {
    const { getByTestId } = render(<Controlled initial={['a', 'b']} />)
    void setFocus('row-a')
    await waitFor(() => expect(getCurrentFocusKey()).toBe('row-a'))

    getByTestId('drop-all').click()

    await settleAutoRestore()
    expect(getCurrentFocusKey()).toBe('anchor')
  })

  it('leaves focus alone when the removed item was not the one holding it', async () => {
    const { getByTestId } = render(<Controlled initial={['a', 'b', 'c']} />)
    void setFocus('row-a')
    await waitFor(() => expect(getCurrentFocusKey()).toBe('row-a'))

    getByTestId('drop-c').click()

    await settleAutoRestore()
    expect(getCurrentFocusKey()).toBe('row-a')
  })

  // The other half of the contract: an item can survive a re-render under a
  // DIFFERENT focus key (a reorder that moves which row owns a shared entry
  // key). The library captures a focusable's key at registration, so the row
  // remounts and the key focus points at is retired even though the row the
  // user was on is still on screen.
  it('follows an item that survived under a new focus key', async () => {
    function Reordering() {
      const [reversed, setReversed] = useState(false)
      // 'x' is registered as `row-first` while it is first, and as `row-x`
      // once it is not — the shape CountriesPane and PlaylistsPane use for
      // their pane-entry row.
      const order = reversed ? ['y', 'x'] : ['x', 'y']
      const items = order.map((id, index) => ({ id, focusKey: index === 0 ? 'row-first' : `row-${id}` }))
      const { ref, focusKey } = useFocusable({ focusKey: 'root', trackChildren: true })
      useFocusRecovery({ items, anchorFocusKey: 'anchor' })
      return (
        <FocusContext.Provider value={focusKey}>
          <div ref={ref}>
            <button data-testid="reverse" onClick={() => setReversed(true)} />
            {items.map((item, index) => (
              <Row key={`${item.id}-${index === 0 ? 'first' : 'rest'}`} focusKey={item.focusKey} />
            ))}
            <Row focusKey="anchor" />
          </div>
        </FocusContext.Provider>
      )
    }
    const { getByTestId } = render(<Reordering />)
    void setFocus('row-first')
    await waitFor(() => expect(getCurrentFocusKey()).toBe('row-first'))

    getByTestId('reverse').click()

    await settleAutoRestore()
    // Still standing on 'x', which is now the second row.
    expect(getCurrentFocusKey()).toBe('row-x')
  })

  // A master/detail pane's action column: not a row, so no neighbour in
  // `items` can be named for it, but it exists only for as long as there is
  // a row to detail. Deliberately keyed off `items.length`, not off asking
  // the library whether the key still exists — deregistration runs through
  // its scheduler and is not guaranteed to have happened yet.
  it('recovers a dependent control to the anchor when the list it details empties', async () => {
    function MasterDetail() {
      const [ids, setIds] = useState(['a'])
      const { ref, focusKey } = useFocusable({ focusKey: 'root', trackChildren: true })
      useFocusRecovery({
        items: ids.map((id) => ({ id, focusKey: `row-${id}` })),
        anchorFocusKey: 'anchor',
        dependentFocusKeys: (key) => key === 'detail-action',
      })
      return (
        <FocusContext.Provider value={focusKey}>
          <div ref={ref}>
            <button data-testid="drop-all" onClick={() => setIds([])} />
            {ids.map((id) => (
              <Row key={id} focusKey={`row-${id}`} />
            ))}
            {ids.length > 0 && <Row focusKey="detail-action" />}
            <Row focusKey="anchor" />
          </div>
        </FocusContext.Provider>
      )
    }
    const { getByTestId } = render(<MasterDetail />)
    void setFocus('detail-action')
    await waitFor(() => expect(getCurrentFocusKey()).toBe('detail-action'))

    getByTestId('drop-all').click()

    await settleAutoRestore()
    expect(getCurrentFocusKey()).toBe('anchor')
  })
})
