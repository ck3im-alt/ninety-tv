import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Regression coverage for the CI failure that blocked this release.
//
// WHAT HAPPENED. CI pinned `node-version: 20`. jsdom@30 declares
// `^22.22.2 || ^24.15.0 || >=26.0.0`, and its undici@8 dependency calls
// `require('node:worker_threads').markAsUncloneable`, which does not exist
// before Node 22.10. Importing jsdom therefore threw outright and all 12
// `@vitest-environment jsdom` files died at worker startup before running a
// single test. The other files ran and passed, so it read as a test
// failure rather than an environment one. npm had been printing EBADENGINE
// on every run and nothing was watching.
//
// The fix was one line in ci.yml, which is exactly the kind of fix that
// silently rots: nothing connected the pin to the requirement that
// justified it. These tests are that connection.

const ROOT = resolve(import.meta.dirname, '../../..')
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
const ci = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')

// Parses the major versions out of a semver range like
// "^22.22.2 || ^24.15.0 || >=26.0.0".
function allowedMajors(range: string): number[] {
  return [...range.matchAll(/(\d+)\.\d+\.\d+/g)].map((m) => Number(m[1]))
}

describe('Node toolchain', () => {
  it('declares its Node requirement rather than leaving it implicit', () => {
    expect(pkg.engines?.node).toBeTruthy()
  })

  // The actual root cause. If a dependency bump raises the floor again,
  // this fails instead of 12 test files dying at worker startup.
  it("covers jsdom's own engine requirement", () => {
    const jsdom = JSON.parse(readFileSync(resolve(ROOT, 'node_modules/jsdom/package.json'), 'utf8'))
    expect(pkg.engines.node).toBe(jsdom.engines.node)
  })

  it('pins CI to a Node major the package actually supports', () => {
    const pinned = ci.match(/node-version:\s*(\d+)/)
    expect(pinned).not.toBeNull()
    expect(allowedMajors(pkg.engines.node)).toContain(Number(pinned![1]))
  })

  it('gives .nvmrc a version satisfying the same requirement', () => {
    const nvmrc = readFileSync(resolve(ROOT, '.nvmrc'), 'utf8').trim()
    expect(allowedMajors(pkg.engines.node)).toContain(Number(nvmrc.split('.')[0]))
  })

  // Node 20 is the specific version that broke; naming it makes the
  // failure message obvious if anyone reaches for it again.
  it('rejects Node 20, which cannot import jsdom@30 at all', () => {
    expect(allowedMajors(pkg.engines.node)).not.toContain(20)
  })
})

describe('CI workflow', () => {
  it('runs the full validation set the release depends on', () => {
    for (const step of ['npm ci', 'npm test', 'npm run lint', 'npm run build', 'npm run build:tizen']) {
      expect(ci).toContain(step)
    }
  })

  it('supplies the API URL the production build requires', () => {
    expect(ci).toContain('VITE_NINETY_API_URL')
  })
})

// Version drift between these two is silent and only shows up on a device:
// Tizen displays config.xml's version in its app list and uses it to decide
// whether an install is an upgrade, while package.json is what every human
// and every release note reads. They disagreed (0.0.0 vs 0.0.1) right up to
// the first beta.
describe('release version', () => {
  it('agrees between package.json and the Tizen widget manifest', () => {
    const configXml = readFileSync(resolve(ROOT, 'config.xml'), 'utf8')
    const widgetVersion = configXml.match(/\n\s+version="([^"]+)"/)?.[1]
    expect(widgetVersion).toBe(pkg.version)
  })

  // Tizen requires a plain numeric x.y.z widget version — it rejects
  // semver pre-release suffixes, so `0.1.0-beta.1` cannot go in config.xml.
  // The beta iteration lives in the git tag instead (v0.1.0-beta.1).
  it('uses a Tizen-legal numeric version, with no pre-release suffix', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
