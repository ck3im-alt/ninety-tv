import { describe, expect, it } from 'vitest'
import { classifyPlaybackSource } from './playbackSource'

describe('classifyPlaybackSource', () => {
  it('recognizes HLS with case, query, and fragment noise', () => {
    expect(classifyPlaybackSource('https://provider.example/live/1.M3U8?token=abc#live')).toBe('hls')
  })

  it('recognizes MPEG-TS when an expiring token follows the extension', () => {
    expect(classifyPlaybackSource('https://provider.example/live/1.ts?token=abc')).toBe('mpegts')
  })

  it('recognizes an extension-less Xtream live URL', () => {
    expect(classifyPlaybackSource('https://panel.example/live/user/password/12345?token=abc')).toBe('mpegts')
  })

  it('keeps ordinary browser-native media on the native path', () => {
    expect(classifyPlaybackSource('https://provider.example/archive/game.mp4?token=abc')).toBe('native')
  })
})
