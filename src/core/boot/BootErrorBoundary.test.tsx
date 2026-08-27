// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BootErrorBoundary } from './BootErrorBoundary'

// What a beta tester sees when the app crashes after startup.
//
// The regression these guard: this boundary used to `render() { return
// null }`, so any fatal render throw produced a completely black screen —
// no branding, no message, nothing to press, and on a TV no way to tell it
// apart from the set having lost input.

function Boom(): never {
  throw new Error('kaboom at http://provider.test/get.php?username=alice&password=hunter2')
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // React logs caught boundary errors; silence the noise without hiding
  // real failures from the assertions below.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  consoleError.mockRestore()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('BootErrorBoundary — healthy tree', () => {
  it('renders children untouched when nothing throws', () => {
    render(
      <BootErrorBoundary>
        <div>real app</div>
      </BootErrorBoundary>,
    )
    expect(screen.getByText('real app')).toBeDefined()
    expect(document.querySelector('.ninety-boot-fallback')).toBeNull()
  })
})

describe('BootErrorBoundary — fatal render error', () => {
  it('shows a branded crash state instead of a blank screen', () => {
    render(
      <BootErrorBoundary>
        <Boom />
      </BootErrorBoundary>,
    )
    const panel = document.querySelector('.ninety-boot-fallback')
    expect(panel).not.toBeNull()
    expect(screen.getByText('N I N E T Y')).toBeDefined()
    expect(screen.getByText('Something went wrong')).toBeDefined()
  })

  it('offers a Restart control that a remote can reach and press', () => {
    render(
      <BootErrorBoundary>
        <Boom />
      </BootErrorBoundary>,
    )
    const button = screen.getByRole('button', { name: 'Restart' })
    // autoFocus means OK/Enter on the remote activates it with no spatial
    // navigation involved — the focus tree died with the crashed subtree.
    expect(document.activeElement).toBe(button)
  })

  it('announces itself assertively for accessibility', () => {
    render(
      <BootErrorBoundary>
        <Boom />
      </BootErrorBoundary>,
    )
    const panel = document.querySelector('.ninety-boot-fallback')!
    expect(panel.getAttribute('role')).toBe('alert')
    expect(panel.getAttribute('aria-live')).toBe('assertive')
  })

  it('reports the error to its caller (which routes it to the boot log)', () => {
    const onError = vi.fn()
    render(
      <BootErrorBoundary onError={onError}>
        <Boom />
      </BootErrorBoundary>,
    )
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
  })

  it('survives a missing onError prop', () => {
    expect(() =>
      render(
        <BootErrorBoundary>
          <Boom />
        </BootErrorBoundary>,
      ),
    ).not.toThrow()
  })
})

// The secret-leak guard. Error messages routinely carry the URL of the
// request that failed, and for this app that URL can be an Xtream
// get.php?username=...&password=... .
describe('BootErrorBoundary — no stack traces or credentials on screen', () => {
  it('never renders the stack or the error message in a non-diagnostic build', async () => {
    vi.resetModules()
    vi.doMock('../perf/devPerf', () => ({ PERF_DIAGNOSTICS_ENABLED: false }))
    const { BootErrorBoundary: Production } = await import('./BootErrorBoundary')
    render(
      <Production>
        <Boom />
      </Production>,
    )
    expect(document.body.textContent).not.toContain('hunter2')
    expect(document.body.textContent).not.toContain('alice')
    expect(document.body.textContent).not.toContain('kaboom')
    expect(document.querySelector('pre')).toBeNull()
    vi.doUnmock('../perf/devPerf')
  })

  it('DOES show the stack in a diagnostic build, so on-device debugging still works', async () => {
    vi.resetModules()
    vi.doMock('../perf/devPerf', () => ({ PERF_DIAGNOSTICS_ENABLED: true }))
    const { BootErrorBoundary: Diagnostic } = await import('./BootErrorBoundary')
    render(
      <Diagnostic>
        <Boom />
      </Diagnostic>,
    )
    expect(document.querySelector('pre')).not.toBeNull()
    expect(document.body.textContent).toContain('kaboom')
    vi.doUnmock('../perf/devPerf')
  })
})
