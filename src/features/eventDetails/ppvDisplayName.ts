// Cleans a raw one-off PPV playlist entry name (e.g. "LIVE | DEPORTIVO –
// ELCHE | Mon 17 Aug 20:55 CEST (NO) | 8K EXCLUSIVE | NO: TV2 PLAY PPV 9")
// down to just the provider/channel identity ("TV2 PLAY PPV 9") for
// display — see the Event Details redesign task, section 16.
//
// Display-only: this never touches the raw channel name used for matching
// (matchViaPpvChannelName in channelMatch.ts, which needs the team names
// and date literally present in the string). Called separately, purely to
// decide what text a stream row shows.
//
// Deliberately does NOT re-case the surviving provider segment (no "PLAY"
// -> "Play" title-casing) — there's no reliable way to tell a real
// all-caps brand acronym ("PPV", "DAZN") apart from an ordinary word
// without a maintained brand dictionary, and guessing wrong mangles real
// branding. Whatever casing the playlist already used for the provider
// slot is preserved as-is.
import { foldForDisplay, foldForMatching, stripDecorativeEdges } from '../../data/fancyUnicode'
import { COUNTRY_NAMES } from '../../data/countryCodes'
import { textMatchesTeam } from '../../data/sports/channelMatchCore'
import { parseCategory, isPpvCategory } from '../channels/parseCategory'
import type { MatchGroup } from './groupChannelMatches'

const FALLBACK_NAME = 'PPV Event'

const WEEKDAY_RE = /\b(MON|TUE|WED|THU|FRI|SAT|SUN)(DAY)?\b/
const TIME_RE = /\b\d{1,2}:\d{2}\b/
const MONTH_RE = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/
const TIMEZONE_RE = /\b(UTC|GMT|CEST|CET|BST|EST|EDT|PST|PDT|WAT|WEST|SAST|AEST|WET)\b/
const MARKETING_RE = /\b(8K|4K|UHD|FHD|EXCLUSIVE|ULTRA)\b/

const COUNTRY_CODE_SET = new Set(Object.keys(COUNTRY_NAMES))
const COUNTRY_NAME_SET = new Set(Object.values(COUNTRY_NAMES).map((name) => name.toUpperCase()))

function isStandaloneCountryMarker(foldedSegment: string): boolean {
  const bare = foldedSegment.replace(/[()]/g, '').trim()
  if (bare.length === 0) return false
  return COUNTRY_CODE_SET.has(bare) || COUNTRY_NAME_SET.has(bare)
}

export interface PpvDisplayNameContext {
  homeTeam?: string
  awayTeam?: string
}

// A segment is display noise when it's the "LIVE" marker, a date/time/
// timezone stamp, purely a country marker, pure technical marketing
// ("8K EXCLUSIVE"), or — when the calling event's team names are known —
// the event-title segment itself (both team names present).
function isNoiseSegment(rawSegment: string, context?: PpvDisplayNameContext): boolean {
  const folded = foldForMatching(rawSegment).trim()
  if (folded === '') return true
  if (folded === 'LIVE') return true
  if (WEEKDAY_RE.test(folded)) return true
  if (TIME_RE.test(folded)) return true
  if (MONTH_RE.test(folded)) return true
  if (TIMEZONE_RE.test(folded)) return true
  if (MARKETING_RE.test(folded)) return true
  if (isStandaloneCountryMarker(folded)) return true
  if (context?.homeTeam && context?.awayTeam) {
    if (textMatchesTeam(folded, context.homeTeam) && textMatchesTeam(folded, context.awayTeam)) return true
  }
  return false
}

// Strips a leading "XX: " country-code prefix from the final surviving
// segment (e.g. "NO: TV2 PLAY PPV 9" -> "TV2 PLAY PPV 9") — only when that
// leading token is actually a recognized country code, so an ordinary
// two-letter word followed by a colon is never mistaken for one.
function stripLeadingCountryPrefix(segment: string): string {
  const trimmed = segment.trim()
  const match = trimmed.match(/^([A-Za-z]{2,3}):\s*(.+)$/)
  if (!match) return trimmed
  if (!COUNTRY_CODE_SET.has(match[1].toUpperCase())) return trimmed
  return match[2].trim()
}

// Reduces a raw PPV playlist entry name to just its provider/channel
// identity. `context` (the event's own team names), when supplied, lets a
// same-named event-title segment be recognized and dropped even if it
// doesn't otherwise look like noise.
export function normalizePpvDisplayName(rawName: string, context?: PpvDisplayNameContext): string {
  const displayFolded = foldForDisplay(rawName)
  const segments = displayFolded
    .split('|')
    .map((segment) => stripDecorativeEdges(segment))
    .filter((segment) => segment.length > 0)

  const kept = segments.filter((segment) => !isNoiseSegment(segment, context))
  const providerSegment = kept[kept.length - 1]
  if (!providerSegment) return FALLBACK_NAME

  const cleaned = stripLeadingCountryPrefix(providerSegment)
  return cleaned.length > 0 ? cleaned : FALLBACK_NAME
}

// Picks the identity a stream row should actually show, per priority:
// 1. ninety-api's own canonical broadcaster name, for a group a 'ninety'
//    match contributed to — cleaner than the raw playlist spelling for a
//    confidently-resolved stable linear channel.
// 2. the normalized PPV display name, for a group whose representative
//    channel is playlist-categorized as PPV (see parseCategory/
//    isPpvCategory) — the raw entry name IS the event title here, so it
//    needs the cleanup above, not just display-as-is.
// 3. the group's own (already merge-time-normalized, see normalize.ts)
//    playlist display name, for an ordinary linear channel.
// The underlying playable Channel/ChannelSource is untouched either way —
// this only decides what text represents the group.
export function getChannelDisplayName(group: MatchGroup, context?: PpvDisplayNameContext): string {
  if (group.canonicalBroadcastName) return group.canonicalBroadcastName
  const representative = group.sourceOptions[0]?.channel
  const category = parseCategory(representative?.groupTitle ?? '')
  if (isPpvCategory(category)) return normalizePpvDisplayName(group.name, context)
  return group.name
}
