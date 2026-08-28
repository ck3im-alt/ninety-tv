import { describe, expect, it } from 'vitest'
import {
  INITIAL_SETTINGS_SECTION,
  SETTINGS_SECTIONS,
  adjacentSection,
  isRailFocusKey,
  railFocusKey,
} from './settingsSections'

describe('SETTINGS_SECTIONS', () => {
  it('is exactly the five questions Settings exists to answer, in order', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      'playlists',
      'sports',
      'countries',
      'personalisation',
      'visibility',
    ])
  })

  it('opens on Playlists — the most concrete and actionable section', () => {
    expect(INITIAL_SETTINGS_SECTION).toBe('playlists')
    expect(SETTINGS_SECTIONS[0].id).toBe(INITIAL_SETTINGS_SECTION)
  })
})

describe('SETTINGS_SECTIONS — the 2026-08-28 rename', () => {
  // The section grew a second, unrelated control (Home content breadth) and
  // stopped being about playback at all. Renamed rather than joined by a
  // sixth rail destination, and renamed all the way down to its id — a
  // route name that no longer describes its contents is a small lie that
  // costs the next reader real time.
  it('has no "playback" section left anywhere in the model', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).not.toContain('playback')
    expect(SETTINGS_SECTIONS.map((section) => section.label)).not.toContain('Playback')
  })

  it('still offers exactly five rail destinations', () => {
    expect(SETTINGS_SECTIONS).toHaveLength(5)
  })

  it('labels the renamed section "Personalisation"', () => {
    expect(SETTINGS_SECTIONS.find((section) => section.id === 'personalisation')?.label).toBe('Personalisation')
  })
})

describe('adjacentSection', () => {
  it('moves one section per press', () => {
    expect(adjacentSection('playlists', 1)).toBe('sports')
    expect(adjacentSection('countries', -1)).toBe('sports')
    expect(adjacentSection('countries', 1)).toBe('personalisation')
    expect(adjacentSection('visibility', -1)).toBe('personalisation')
  })

  it('clamps at both ends rather than wrapping — a D-pad press must never jump the length of the rail', () => {
    expect(adjacentSection('playlists', -1)).toBe('playlists')
    expect(adjacentSection('visibility', 1)).toBe('visibility')
  })
})

describe('railFocusKey / isRailFocusKey', () => {
  it('round-trips every section', () => {
    for (const section of SETTINGS_SECTIONS) expect(isRailFocusKey(railFocusKey(section.id))).toBe(true)
  })

  it('does not mistake a pane control for a rail row — this is what decides whether Back exits Settings', () => {
    expect(isRailFocusKey('settings-pane-entry')).toBe(false)
    expect(isRailFocusKey('settings-playlist-pl-1')).toBe(false)
    expect(isRailFocusKey(null)).toBe(false)
    expect(isRailFocusKey(undefined)).toBe(false)
  })
})
