// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { Suspense, lazy } from 'react'
import { LazyScreenFallback } from './LazyScreenFallback'

// App.tsx's Suspense boundary used `fallback={null}`, so a slow chunk on a
// TV produced a blank region under a still-drawn top bar — which reads as a
// dead app. These cover the replacement, including the part that matters
// most: no transition is allowed to expose an empty shell.

afterEach(() => {
  cleanup()
})

describe('LazyScreenFallback', () => {
  it('shows the Ninety loading shell immediately instead of an empty frame', () => {
    render(<LazyScreenFallback />)
    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.getByText('N I N E T Y')).toBeDefined()
    expect(screen.getByText('Loading NINETY')).toBeDefined()
  })

  it('shows no progress percentage — a dynamic import cannot report one', () => {
    const { container } = render(<LazyScreenFallback />)
    expect(container.textContent).not.toMatch(/\d+\s*%/)
  })

  it('registers no focusable node, so it cannot steal or duplicate spatial focus', () => {
    const { container } = render(<LazyScreenFallback />)
    expect(container.querySelectorAll('button, a, input, [tabindex]').length).toBe(0)
  })
})

describe('LazyScreenFallback inside a real Suspense boundary', () => {
  it('covers even a chunk that resolves immediately, then leaves no residue', async () => {
    const Screen = lazy(async () => ({ default: () => <div>loaded screen</div> }))
    render(
      <Suspense fallback={<LazyScreenFallback />}>
        <Screen />
      </Suspense>,
    )
    expect(screen.getByRole('status')).toBeDefined()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('loaded screen')).toBeDefined()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('appears for a slow chunk and is replaced by the screen when it arrives', async () => {
    let resolveChunk!: () => void
    const gate = new Promise<void>((resolve) => {
      resolveChunk = resolve
    })
    const Screen = lazy(async () => {
      await gate
      return { default: () => <div>loaded screen</div> }
    })
    render(
      <Suspense fallback={<LazyScreenFallback />}>
        <Screen />
      </Suspense>,
    )
    expect(screen.getByRole('status')).toBeDefined()

    resolveChunk()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('loaded screen')).toBeDefined()
    // Fully torn down — no leftover panel over the arrived screen.
    expect(screen.queryByRole('status')).toBeNull()
  })
})
