import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Package-weight guard for public/.
//
// Vite copies public/ into dist/ wholesale, so anything sitting there is
// shipped inside the Tizen .wgt whether or not a single line of code refers
// to it. Before the pre-beta cleanup that meant ~10.2 MB of superseded
// design experiments and one-off images travelling to every tester's TV —
// invisible in code review, because a dead asset looks exactly like a live
// one until you go looking for the reference.
//
// This is a REFERENCE test, not an allowlist: it reads what the source
// actually points at. Adding artwork and wiring it up passes; adding
// artwork and forgetting to wire it up fails, which is the case worth
// catching. To retire an image, delete the file — do not add an exception.

const ROOT = resolve(import.meta.dirname, '../../..')
const BACKGROUNDS = resolve(ROOT, 'public/backgrounds')

// Every `backgrounds/...` path literal anywhere in src/, which is the only
// way this app addresses these files (competitionArtwork.ts's map,
// leagues.ts's staticBackground, mapEvent.ts's fallback).
function referencedBackgroundPaths(): Set<string> {
  const referenced = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(ts|tsx|css)$/.test(entry.name)) continue
      const source = readFileSync(full, 'utf8')
      for (const match of source.matchAll(/backgrounds\/([A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|avif))/g)) {
        referenced.add(match[1])
      }
    }
  }
  walk(resolve(ROOT, 'src'))
  return referenced
}

function backgroundFilesOnDisk(): string[] {
  const files: string[] = []
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(resolve(dir, entry.name), `${prefix}${entry.name}/`)
        continue
      }
      files.push(`${prefix}${entry.name}`)
    }
  }
  walk(BACKGROUNDS, '')
  return files
}

describe('public/backgrounds', () => {
  it('ships no image that nothing in src refers to', () => {
    const referenced = referencedBackgroundPaths()
    const orphans = backgroundFilesOnDisk().filter((file) => !referenced.has(file))
    expect(orphans).toEqual([])
  })

  it('refers to no image that is missing from disk — a broken path is a blank header on a TV', () => {
    const onDisk = new Set(backgroundFilesOnDisk())
    const missing = [...referencedBackgroundPaths()].filter((file) => !onDisk.has(file))
    expect(missing).toEqual([])
  })

  // OS/editor droppings are gitignored, so they never appear in a diff, but
  // Vite still copies them into dist/ and from there into the .wgt.
  // vite.config.ts strips them at build time; this catches them at source.
  it('contains no OS or editor debris', () => {
    const debris = backgroundFilesOnDisk().filter((file) => file.split('/').pop()!.startsWith('.'))
    expect(debris).toEqual([])
  })
})
