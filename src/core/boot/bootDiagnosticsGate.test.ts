import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import viteConfig from '../../../vite.config'

// Guards the split between "developer diagnostics" and "what a beta tester
// sees", which is enforced at BUILD time and therefore cannot be checked by
// rendering a component.
//
// The regression this exists for: index.html used to create a full-screen
// green-on-black stack-trace overlay unconditionally, on every startup, in
// every build. It was the normal failure UX for anyone running the app.

const INDEX_HTML = readFileSync(resolve(import.meta.dirname, '../../../index.html'), 'utf8')

// Resolves the config for a given build, then runs its index.html transform
// exactly as Vite would.
async function transformIndexHtml(env: { command: 'build' | 'serve'; mode: string; perfFlag?: string }) {
  const previous = process.env.VITE_PERF_DIAGNOSTICS
  if (env.perfFlag === undefined) delete process.env.VITE_PERF_DIAGNOSTICS
  else process.env.VITE_PERF_DIAGNOSTICS = env.perfFlag
  try {
    // The hook is declared in Vite's object form ({ order, handler }) so it
    // can run BEFORE inline-script minification strips its comment markers;
    // both forms are unwrapped here so this helper does not have to change
    // again if that ordering requirement ever goes away.
    type IndexHtmlHook =
      | ((html: string) => string)
      | { order?: string; handler: (html: string) => string }
    const factory = viteConfig as unknown as (e: { command: string; mode: string }) => {
      plugins: { name: string; transformIndexHtml?: IndexHtmlHook }[]
    }
    const resolved = await factory({ command: env.command, mode: env.mode })
    const plugin = resolved.plugins.flat().find((p) => p?.name === 'ninety-boot-diagnostics-flag')
    const hook = plugin?.transformIndexHtml
    if (!hook) throw new Error('boot diagnostics plugin not found in vite config')
    return typeof hook === 'function' ? hook(INDEX_HTML) : hook.handler(INDEX_HTML)
  } finally {
    if (previous === undefined) delete process.env.VITE_PERF_DIAGNOSTICS
    else process.env.VITE_PERF_DIAGNOSTICS = previous
  }
}

describe('index.html boot script', () => {
  it('gates the diagnostic overlay behind a build-time flag rather than always creating it', () => {
    expect(INDEX_HTML).toContain('__NINETY_DIAGNOSTICS__')
    // The overlay must be constructed inside the flag check, never at the
    // top level of the boot script.
    const overlayIndex = INDEX_HTML.indexOf("overlay.id = 'boot-diag'")
    const gateIndex = INDEX_HTML.indexOf('if (DIAGNOSTICS) {')
    expect(gateIndex).toBeGreaterThan(-1)
    expect(overlayIndex).toBeGreaterThan(gateIndex)
    // ...and inside the strippable region, so a production build removes it.
    const start = INDEX_HTML.indexOf('/* @diagnostics-only:start */')
    const end = INDEX_HTML.indexOf('/* @diagnostics-only:end */')
    expect(start).toBeGreaterThan(-1)
    expect(overlayIndex).toBeGreaterThan(start)
    expect(overlayIndex).toBeLessThan(end)
  })

  it('ships a branded, dependency-free crash panel in the markup itself', () => {
    expect(INDEX_HTML).toContain('ninety-boot-fallback')
    expect(INDEX_HTML).toContain('N I N E T Y')
    expect(INDEX_HTML).toContain('Something went wrong')
    // A real button, so the remote can activate it with no app code alive.
    expect(INDEX_HTML).toContain('id="boot-fallback-restart"')
  })

  it('has no external dependency in its crash path (inline CSS, no network)', () => {
    const head = INDEX_HTML.slice(0, INDEX_HTML.indexOf('</head>'))
    expect(head).not.toMatch(/<link[^>]+rel=["']stylesheet["']/)
    expect(head).toContain('<style>')
  })
})

describe('boot diagnostics flag substitution', () => {
  it('is OFF for a normal production build — the beta artifact has no overlay', async () => {
    const html = await transformIndexHtml({ command: 'build', mode: 'production' })
    expect(html).toContain('var DIAGNOSTICS = false')
    expect(html).not.toContain('__NINETY_DIAGNOSTICS__')
  })

  // Stronger than "the flag is false": the overlay code is REMOVED, so its
  // element id cannot appear in a release artifact at all. That is what
  // docs/BETA-RELEASE-CHECKLIST.md section D greps for.
  it('deletes the diagnostic block outright rather than leaving it unreachable', async () => {
    const html = await transformIndexHtml({ command: 'build', mode: 'production' })
    expect(html).not.toContain('boot-diag')
    expect(html).not.toContain('NINETY boot diagnostic')
    // The declaration itself must survive, or every `if (overlay)` guard
    // downstream throws on a ReferenceError instead of reading null.
    expect(html).toContain('var overlay = null')
  })

  it('keeps the block in a diagnostic build', async () => {
    const html = await transformIndexHtml({ command: 'build', mode: 'production', perfFlag: '1' })
    expect(html).toContain('boot-diag')
  })

  it('is ON when explicitly asked for, so on-device debugging still works', async () => {
    const html = await transformIndexHtml({ command: 'build', mode: 'production', perfFlag: '1' })
    expect(html).toContain('var DIAGNOSTICS = true')
  })

  it('is ON for the dev server', async () => {
    const html = await transformIndexHtml({ command: 'serve', mode: 'development' })
    expect(html).toContain('var DIAGNOSTICS = true')
  })

  // Same env var as core/perf/devPerf.ts's PERF_DIAGNOSTICS_ENABLED, on
  // purpose: one way to ask for on-device diagnostics, not two.
  it('ignores a value other than "1", so a stray env var cannot ship an overlay', async () => {
    const html = await transformIndexHtml({ command: 'build', mode: 'production', perfFlag: 'true' })
    expect(html).toContain('var DIAGNOSTICS = false')
  })
})
