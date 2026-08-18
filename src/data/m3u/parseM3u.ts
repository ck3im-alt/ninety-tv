import type { RawChannel } from '../rawChannel'

const ATTR_PATTERN = /(\w[\w-]*)="([^"]*)"/g

function parseAttrs(extinfLine: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of extinfLine.matchAll(ATTR_PATTERN)) {
    attrs[match[1]] = match[2]
  }
  return attrs
}

function parseName(extinfLine: string): string {
  const commaIndex = extinfLine.lastIndexOf(',')
  return commaIndex === -1 ? '' : extinfLine.slice(commaIndex + 1).trim()
}

// Minimal EXTM3U parser: reads #EXTINF lines paired with the stream URL on
// the following non-comment line. Ignores unknown #EXT directives. Returns
// raw (pre-merge) entries — quality-variant merging and name normalization
// happen in mergeChannels.ts, not here.
export function parseM3u(playlistText: string): RawChannel[] {
  const lines = playlistText.split(/\r?\n/)
  const channels: RawChannel[] = []
  let pendingAttrs: Record<string, string> | null = null
  let pendingName = ''
  let index = 0

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (line.startsWith('#EXTINF')) {
      pendingAttrs = parseAttrs(line)
      pendingName = parseName(line)
      continue
    }

    if (line.startsWith('#')) continue // other directives (#EXTM3U, #EXTGRP, ...) — not needed yet

    // A non-comment line while we have pending EXTINF metadata is the stream URL.
    if (pendingAttrs !== null) {
      channels.push({
        id: pendingAttrs['tvg-id'] || `channel-${index}`,
        name: pendingName || `Channel ${index + 1}`,
        logo: pendingAttrs['tvg-logo'],
        groupTitle: pendingAttrs['group-title'],
        url: line,
        epgChannelId: pendingAttrs['tvg-id'] || undefined,
      })
      index += 1
      pendingAttrs = null
      pendingName = ''
    }
  }

  return channels
}
