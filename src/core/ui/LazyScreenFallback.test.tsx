// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { Suspense, lazy } from 'react'
import { LazyScreenFallback } from './LazyScreenFallback'
import { SHOW_DELAY_MS } from './useDeferredBusy'

// App.tsx's Suspense boundary used `fallback={null}`, so a slow chunk on a
// TV produced a blank region under a still-drawn top bar — which reads as a
// dead app. These cover the replacement, including the part that matters
// most: it must NOT regress the fast case into a flash.

const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('LazyScreenFallback', () => {
  it('renders NOTHING initially, so a fast chunk looks exactly as it does today', () => {
    const { container } = render(<LazyScreenFallback />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the Ninety loading shell once the transition is genuinely slow', async () => {
    render(<LazyScreenFallback />)
    await advance(SHOW_DELAY_MS + 1)
    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.getByText('N I N E T Y')).toBeDefined()
  })

  it('shows no progress percentage — a dynamic import cannot report one', async () => {
    const { container } = render(<LazyScreenFallback />)
    await advance(SHOW_DELAY_MS + 1)
    expect(container.textContent).not.toMatch(/\d+\s*%/)
  })

  it('registers no focusable node, so it cannot steal or duplicate spatial focus', async () => {
    const { container } = render(<LazyScreenFallback />)
    await advance(SHOW_DELAY_MS + 1)
    expect(container.querySelectorAll('button, a, input, [tabindex]').length).toBe(0)
  })
})

describe('LazyScreenFallback inside a real Suspense boundary', () => {
  it('never appears for a chunk that resolves immediately', async () => {
    const Screen = lazy(async () => ({ default: () => <div>loaded screen</div> }))
    const { container } = render(
      <Suspense fallback={<LazyScreenFallback />}>
        <Screen />
      </Suspense>,
    )
    // The fallback is mounted here, but renders nothing.
    expect(container.textContent).toBe('')
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
    await advance(SHOW_DELAY_MS + 1)
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

  it('leaves no timer behind once it unmounts', async () => {
    const view = render(<LazyScreenFallback />)
    await advance(SHOW_DELAY_MS + 1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
