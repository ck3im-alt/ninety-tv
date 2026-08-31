import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// TOOLCHAIN REGRESSION GUARD for the Tizen/Chromium Worker compatibility
// decision. Not a behaviour test — a guard on the two build-time facts the
// app's platform floor rests on, which nothing else can observe:
//
//   1. Every production Worker constructor is CLASSIC (no `type: 'module'`).
//   2. Vite's worker output format is pinned to 'iife', which is what makes
//      (1) valid — a classic constructor pointed at an ES-module chunk
//      would fail at runtime on every TV, not just old ones.
//
// Module Workers require Chromium 80. Samsung maps 2021 sets to Tizen 6.0 /
// Chromium M76 and 2022 sets to Tizen 6.5 / Chromium M85, so `{ type:
// 'module' }` throws at construction on a 2021 set. The playlist builder
// survives that (it has a synchronous main-thread fallback); channel
// identity resolution does not, by design — it just never produces an
// index, and Match View's Ninety-stage matching silently weakens.
//
// Both of those are invisible in a unit test, invisible in `vite dev` (dev
// runs a current Chromium AND deliberately uses the module branch), and
// invisible in `npm run build`. This file is the only place the mistake can
// be caught before a TV catches it.
//
// The DEV branch is exempt and must stay: `vite dev` serves the worker
// entry unbundled with its real `import` statements, so it genuinely
// requires a module Worker. import.meta.env.DEV is statically replaced at
// build time, so that branch is dropped from the production bundle — the
// assertion below is about which branch SHIPS.

const repoRoot = resolve(import.meta.dirname, '../../..')

const WORKER_CLIENTS = ['src/data/playlists/playlistBuildWorkerClient.ts', 'src/data/sports/channelIdentityWorkerClient.ts']

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8')
}

// Comments legitimately discuss `{ type: 'module' }` at length — stripping
// them is what makes this assert on CODE rather than on prose, so the
// explanation of the rule cannot trip the rule.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

describe('Tizen Worker compatibility', () => {
  it.each(WORKER_CLIENTS)('%s constructs a classic Worker on every non-DEV path', (file) => {
    const code = stripComments(read(file))

    const constructors = [...code.matchAll(/new Worker\((?:[^()]|\([^()]*\))*\)/g)].map((match) => match[0])
    expect(constructors.length).toBeGreaterThan(0)

    const moduleConstructors = constructors.filter((call) => /type\s*:\s*['"`]module['"`]/.test(call))

    // Exactly one module constructor is allowed, and only inside the
    // `import.meta.env.DEV` branch — anything else means a module Worker
    // would reach a TV.
    expect(moduleConstructors.length).toBeLessThanOrEqual(1)
    if (moduleConstructors.length === 1) {
      expect(code).toMatch(/if\s*\(\s*import\.meta\.env\.DEV\s*\)/)
      const devBranchStart = code.indexOf('import.meta.env.DEV')
      const moduleCallStart = code.indexOf(moduleConstructors[0])
      expect(moduleCallStart).toBeGreaterThan(devBranchStart)
    }

    // ...and there must be a real classic constructor to ship.
    expect(constructors.some((call) => !/type\s*:/.test(call))).toBe(true)
  })

  it('vite.config.ts pins worker output to the classic (iife) format', () => {
    const config = stripComments(read('vite.config.ts'))
    expect(config).toMatch(/worker\s*:\s*\{\s*format\s*:\s*['"]iife['"]\s*\}/)
    // 'es' would emit ES-module worker chunks, which a classic constructor
    // cannot load at all.
    expect(config).not.toMatch(/format\s*:\s*['"]es['"]/)
  })

  it('the build target stays at a level Chromium M85 can parse', () => {
    // Syntax is transpiled to this target; built-INS are not polyfilled.
    // es2017 keeps optional chaining, nullish coalescing and logical
    // assignment (all Chromium 80+/85+) out of the output, which is what
    // lets the floor be a firmware version rather than a guess.
    const config = stripComments(read('vite.config.ts'))
    expect(config).toMatch(/target\s*:\s*['"]es2017['"]/)
  })
})
