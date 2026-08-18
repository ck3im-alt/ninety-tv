import { describe, expect, it } from 'vitest'
import { projectChannelIdentity } from './channelIdentityProjection'
import type { Channel } from '../channel'

function channel(overrides: Partial<Channel> & Pick<Channel, 'id' | 'name'>): Channel {
  return {
    sources: [
      { label: 'HD', url: 'http://user:pass@example.invalid:8080/live/user/pass/12345.m3u8', epgChannelId: 'tvg-1', originalName: 'UK| TNT SPORTS 1 HD' },
      { label: 'RAW', url: 'http://user:pass@example.invalid:8080/live/user/pass/67890.ts' },
    ],
    ...overrides,
  }
}

describe('projectChannelIdentity', () => {
  it('carries only identity-relevant fields, never a stream URL or credential', () => {
    const c = channel({ id: 'p1', name: 'TNT SPORTS 1', groupTitle: 'UK| SPORT', epgChannelIds: ['tvg-1'], rawNames: ['UK| TNT SPORTS 1 HD'] })
    const projection = projectChannelIdentity(c)

    expect(projection).toEqual({
      id: 'p1',
      name: 'TNT SPORTS 1',
      groupTitle: 'UK| SPORT',
      epgChannelIds: ['tvg-1'],
      rawNames: ['UK| TNT SPORTS 1 HD'],
      sources: [
        { epgChannelId: 'tvg-1', originalName: 'UK| TNT SPORTS 1 HD' },
        { epgChannelId: undefined, originalName: undefined },
      ],
    })

    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain('http')
    expect(serialized).not.toContain('user:pass')
    expect(serialized).not.toContain('8080')
  })

  it('never includes a `url` or `label` key anywhere in the projection, even nested', () => {
    const c = channel({ id: 'p2', name: 'Sky Sports 1' })
    const projection = projectChannelIdentity(c)

    const keys = new Set<string>()
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk)
      } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          keys.add(k)
          walk(v)
        }
      }
    }
    walk(projection)

    expect(keys.has('url')).toBe(false)
    expect(keys.has('label')).toBe(false)
  })

  it('omits groupTitle/epgChannelIds/rawNames entirely when the source Channel has none', () => {
    const c = channel({ id: 'p3', name: 'Bare Channel' })
    const projection = projectChannelIdentity(c)
    expect(projection.groupTitle).toBeUndefined()
    expect(projection.epgChannelIds).toBeUndefined()
    expect(projection.rawNames).toBeUndefined()
  })
})
