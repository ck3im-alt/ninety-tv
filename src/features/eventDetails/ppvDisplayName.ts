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
import { formatTimeOnly24h } from './eventTimeFormat'
import type { MatchGroup } from './groupChannelMatches'

const FALLBACK_NAME = 'PPV Event'

const WEEKDAY_RE = /\b(MON|TUE|WED|THU|FRI|SAT|SUN)(DAY)?\b/
const MONTH_RE = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/
const TIMEZONE_RE = /\b(UTC|GMT|CEST|CET|BST|EST|EDT|PST|PDT|WAT|WEST|SAST|AEST|WET)\b/

// Quality/marketing words stripped at TOKEN level from surviving text, not
// used to discard a whole segment — a real provider identity commonly
// shares a segment with one of these ("VIAPLAY PPV 4K", "VIAPLAY PPV ⱽᴵᴾ"),
// and the old whole-segment MARKETING_RE classification threw the provider
// away with the tag. Checked as exact folded tokens, so brands that merely
// CONTAIN one of these letter runs ("HD1", "Sky Ultra HD Cinema" keeps
// "Sky"/"Cinema") are unaffected. Deliberately excludes words that are real
// branding in the wild: RAW (WWE RAW), GOLD/PREMIUM (ITV Gold, TV 2 Sport
// Premium), LIVE (Sky Sports News LIVE).
const MARKETING_TOKENS = new Set(['8K', '4K', 'UHD', 'FHD', 'SD', 'HD', 'EXCLUSIVE', 'ULTRA', 'VIP', 'HEVC', 'H264', 'H265', '50FPS', '60FPS'])

// Date/time-region-only words, removed from an anchored segment's
// head/tail remainder (see cleanDateAnchoredSegment) — never from an
// ordinary kept segment, where e.g. a weekday letter-run could be part of
// real branding and the old whole-segment classification still applies.
const DATE_WORD_TOKENS = new Set([
  'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN',
  'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY',
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  'UTC', 'GMT', 'CEST', 'CET', 'BST', 'EST', 'EDT', 'PST', 'PDT', 'WAT', 'WEST', 'SAST', 'AEST', 'WET',
  'AM', 'PM',
])

const COUNTRY_CODE_SET = new Set(Object.keys(COUNTRY_NAMES))
const COUNTRY_NAME_SET = new Set(Object.values(COUNTRY_NAMES).map((name) => name.toUpperCase()))

function isStandaloneCountryMarker(foldedSegment: string): boolean {
  const bare = foldedSegment.replace(/[()]/g, '').trim()
  if (bare.length === 0) return false
  return COUNTRY_CODE_SET.has(bare) || COUNTRY_NAME_SET.has(bare)
}

// Colon-separated clock time, with an optional AM/PM suffix -- covers
// "20:00", "20:00 CEST", and "8:00 PM" (real-world shapes named
// explicitly, 2026-08-21). A colon is essentially never used as a date
// separator in these playlists (dates use "/" or "."), so this needs no
// extra disambiguation beyond the hour/minute range check itself.
const TIME_COLON_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\s*(AM|PM)?\b/i

// Dot-separated 24-hour clock time ("20.00", a common European shape) --
// the SAME digit shape as a "DD.MM" date fragment (e.g. "20.08.2026"), so
// this is guarded on both sides: not preceded by "digit.", not followed by
// ".digit" -- i.e. it must stand alone as exactly a two-part H.MM pair, not
// the first or middle segment of a longer dotted date. Verified against
// "20.08.2026" (a full date) producing no match at all, and "20.00"
// (standalone) matching correctly -- see ppvDisplayName.test.ts.
const TIME_DOT_RE = /(?<!\d\.)\b([01]?\d|2[0-3])\.([0-5]\d)(?!\.?\d)\b/

function to24Hour(hourText: string, meridiem?: string): number {
  let hour = Number(hourText)
  const upper = meridiem?.toUpperCase()
  if (upper === 'PM' && hour < 12) hour += 12
  if (upper === 'AM' && hour === 12) hour = 0
  return hour
}

// Extracts the PPV/event stream's own ADVERTISED start time as literal
// text from the raw playlist name -- e.g. "Fri 21 Aug 20:00 CEST (NO)" ->
// "20:00". Deliberately NOT parsed into a Date/reformatted through a
// timezone conversion: a PPV stream commonly starts before the fixture's
// real kickoff (pre-match studio, build-up, interviews), so its own
// advertised time is different, real information -- see
// PpvDisplayNameContext.dateTimeUtc's own comment for the real case this
// exists for. This just reads the clock digits as they appear and
// zero-pads them; it never touches what timezone they're implicitly in.
// Tries the (safer) colon shape first across the whole name; only falls
// back to the dot shape if no colon-time was found at all.
export function extractRawStreamStartTime(rawName: string): string | null {
  const folded = foldForDisplay(rawName)
  const colonMatch = folded.match(TIME_COLON_RE)
  if (colonMatch) {
    const hour = to24Hour(colonMatch[1], colonMatch[3])
    return `${String(hour).padStart(2, '0')}:${colonMatch[2]}`
  }
  const dotMatch = folded.match(TIME_DOT_RE)
  if (dotMatch) {
    return `${dotMatch[1].padStart(2, '0')}:${dotMatch[2]}`
  }
  return null
}

export interface PpvDisplayNameContext {
  homeTeam?: string
  awayTeam?: string
  // Canonical event title for a non-team event (F1 sessions, etc) — used
  // only by buildEventStreamDisplayParts's eventTitle segment below, never
  // by isNoiseSegment's team-text matching (which only ever needs team
  // names to recognize a duplicated event-title segment in the raw name).
  eventTitle?: string
  // Canonical event kickoff, ISO 8601 — FALLBACK ONLY for the display
  // startTime segment, used when the raw PPV stream name itself carries no
  // trustworthy advertised time (see extractRawStreamStartTime below). For
  // an event-specific stream, the PROVIDER'S OWN advertised start time is
  // the primary source and is deliberately preferred over this — real
  // user report, 2026-08-21: a PPV stream's raw name said "20:00" while the
  // canonical fixture kickoff was 21:00 (pre-match studio/build-up
  // coverage starting an hour early), and silently substituting the
  // fixture kickoff there is actively misleading about when the STREAM
  // itself starts. Optional; when neither source has a usable time, the
  // startTime segment is simply omitted, never fabricated.
  dateTimeUtc?: string | null
}

// Date/time ANCHORS: concrete, unambiguous date/time shapes that mark the
// "when" region of a raw event-entry name. A segment containing one is not
// discarded wholesale any more (the old whole-segment noise classification
// lost real provider identity written INTO the same segment — the reported
// regression "Fulham vs Chelsea @ Aug 24 8:15 PM \:Viaplay NO 03" has its
// entire identity in ONE segment); instead the text AFTER the last anchor
// (and, failing that, before the first) is treated as the provider-identity
// remainder and cleaned token-by-token. Standalone weekday/timezone WORDS
// are deliberately not anchors on their own — they're too brand-collidable
// ("Sun TV") — only these digit-bearing shapes are.
const ANCHOR_SOURCES: string[] = [
  String.raw`\b(?:[01]?\d|2[0-3]):[0-5]\d\s*(?:AM|PM)?\b`, // colon time, optional meridiem
  String.raw`\b\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b`, // "17 AUG"
  String.raw`\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{1,2}\b`, // "AUG 24"
  String.raw`\b\d{4}-\d{2}-\d{2}\b`, // ISO date
  String.raw`\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b`, // "21/08", "20.08.2026", dot time "20.00"
]

interface AnchorSpan {
  start: number
  end: number
}

function findDateTimeAnchors(folded: string): AnchorSpan[] {
  const spans: AnchorSpan[] = []
  for (const source of ANCHOR_SOURCES) {
    for (const match of folded.matchAll(new RegExp(source, 'g'))) {
      spans.push({ start: match.index, end: match.index + match[0].length })
    }
  }
  return spans
}

// Shared token pass: splits on whitespace, drops tokens with no
// alphanumeric content (stray "-"/"–" separators), and drops any token the
// supplied predicate rejects. Token text itself is left intact — a colon in
// "NO:" is load-bearing for stripLeadingCountryPrefix later, and "+" in
// "TV3+" is real channel identity (see the mislabeled-PPV passthrough
// tests). Returns null when nothing with a real letter survives — a bare
// leftover number ("03") is a feed slot, not a provider identity anyone
// could read.
function cleanTokens(text: string, isNoiseToken: (foldedToken: string) => boolean): string | null {
  const kept: string[] = []
  for (const token of text.split(/\s+/)) {
    if (!/[A-Za-z0-9]/.test(token)) continue
    if (isNoiseToken(foldForMatching(token))) continue
    kept.push(token)
  }
  const joined = kept.join(' ').trim()
  return joined.length >= 2 && /[A-Za-z]/.test(joined) ? joined : null
}

// Leading/trailing separator-punctuation runs on a head/tail REMAINDER of a
// date-anchored segment (e.g. the "\:" glue in "8:15 PM \:Viaplay NO 03")
// — trimmed off the candidate as a whole, never per token, so mid-name
// punctuation that carries identity ("PPV-12", "TV3+") is untouched.
function trimEdgeSeparators(text: string): string {
  return text.replace(/^[\s\\:.,;@|/#-]+|[\s\\:.,;@|/-]+$/g, '')
}

function isCandidateNoiseToken(foldedToken: string): boolean {
  // Parens and a trailing colon are marker formatting ("(NO)", "NO:"), not
  // part of what the token is — stripped for classification only.
  const bare = foldedToken.replace(/[():]/g, '')
  if (DATE_WORD_TOKENS.has(bare)) return true
  if (MARKETING_TOKENS.has(bare)) return true
  // The head/tail remainder of a date-anchored segment is metadata
  // territory — a standalone country code/name there ("NO", "(NO)") is a
  // market marker, never part of the provider's brand.
  return COUNTRY_CODE_SET.has(bare) || COUNTRY_NAME_SET.has(bare)
}

function isKeptSegmentNoiseToken(foldedToken: string): boolean {
  return MARKETING_TOKENS.has(foldedToken)
}

// The provider-identity remainder of a segment that carries date/time
// anchors: text after the LAST anchor first (real corpus shape — "teams @
// datetime <provider tail>"), text before the FIRST anchor as the fallback.
// The head fallback is skipped when it's just the event title (both team
// names, given context) — that text is already represented canonically.
function cleanDateAnchoredSegment(displaySegment: string, folded: string, anchors: AnchorSpan[], context?: PpvDisplayNameContext): string | null {
  const lastEnd = Math.max(...anchors.map((a) => a.end))
  const tail = cleanTokens(trimEdgeSeparators(displaySegment.slice(lastEnd)), isCandidateNoiseToken)
  if (tail) return tail

  const firstStart = Math.min(...anchors.map((a) => a.start))
  const head = displaySegment.slice(0, firstStart)
  if (context?.homeTeam && context?.awayTeam) {
    const foldedHead = folded.slice(0, firstStart)
    if (textMatchesTeam(foldedHead, context.homeTeam) && textMatchesTeam(foldedHead, context.awayTeam)) return null
  }
  return cleanTokens(trimEdgeSeparators(head), isCandidateNoiseToken)
}

// Reduces one '|'-separated segment to its usable display content, or null
// when nothing usable is in it. Segment-level discards are now reserved for
// segments that genuinely carry nothing else (a lone "LIVE" marker, a
// standalone country marker, a stray date-word segment, the event-title
// segment when team context identifies it); anything sharing a segment with
// noise is recovered token-by-token instead of being thrown away with it.
function cleanSegment(displaySegment: string, context?: PpvDisplayNameContext): string | null {
  const folded = foldForMatching(displaySegment).trim()
  if (folded === '') return null
  if (folded === 'LIVE') return null
  if (isStandaloneCountryMarker(folded)) return null

  const anchors = findDateTimeAnchors(folded)
  if (anchors.length > 0) return cleanDateAnchoredSegment(displaySegment, folded, anchors, context)

  // No concrete date/time anchors: stray date-word segments keep the old
  // whole-segment classification (brand-collidable words are not safe to
  // strip token-level from arbitrary channel text).
  if (WEEKDAY_RE.test(folded) || MONTH_RE.test(folded) || TIMEZONE_RE.test(folded)) return null
  if (context?.homeTeam && context?.awayTeam) {
    if (textMatchesTeam(folded, context.homeTeam) && textMatchesTeam(folded, context.awayTeam)) return null
  }
  return cleanTokens(displaySegment, isKeptSegmentNoiseToken)
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
//
// This is the GROUPING identity too (see groupChannelMatches.ts's
// groupKey) — deliberately preserves a trailing PPV/EVENT/FEED slot number
// ("VIAPLAY PPV 15") so two distinct one-off event slots from the same
// provider never collapse into the same display group merely because they
// clean down to the same provider name. Never change this function to
// strip the slot number — see extractProviderIdentity below for the
// DISPLAY-only variant that does, used exclusively by
// buildEventStreamDisplayParts, never by groupKey.
export function normalizePpvDisplayName(rawName: string, context?: PpvDisplayNameContext): string {
  const displayFolded = foldForDisplay(rawName)
  const segments = displayFolded
    .split('|')
    .map((segment) => stripDecorativeEdges(segment))
    .filter((segment) => segment.length > 0)

  const kept = segments.map((segment) => cleanSegment(segment, context)).filter((segment): segment is string => segment !== null)
  const providerSegment = kept[kept.length - 1]
  if (!providerSegment) return FALLBACK_NAME

  const cleaned = stripLeadingCountryPrefix(providerSegment)
  return cleaned.length > 0 ? cleaned : FALLBACK_NAME
}

// A disposable event-slot identifier glued onto an otherwise-real provider
// name — "PPV 15", "PPV-15", "PPV #15", "PPV15", or the same shapes with
// EVENT/FEED instead of PPV (real corpus patterns, Part R of the redesign
// task). Two additions beyond the numbered PPV/EVENT/FEED shapes:
// - a trailing bare "PPV" with no number at all ("VIAPLAY PPV" once the ⱽᴵᴾ
//   decoration is token-stripped) — deliberately ONLY "PPV", never bare
//   "EVENT"/"FEED", which are real channel branding ("Sky Sports Main
//   Event") that must survive untouched.
// - a trailing LEADING-ZERO number ("Viaplay 03", the anchored-segment tail
//   shape) — a zero-padded number is a rotating feed slot's formatting,
//   never how real numbered channels write themselves ("TV 2",
//   "Sky Sports 1", "TNT Sports 10" — all unaffected, no leading zero).
// The whole suffix must be preceded by whitespace or be the entire string,
// so a brand merely ENDING in these letters ("SUPPV"?) is never sliced.
const EVENT_SLOT_SUFFIX_RE = /(?:^|\s)[-#]?\s*(?:(?:PPV|EVENT|FEED)[\s#-]*\d+|PPV|0\d+)\.?\s*$/i

// DISPLAY-only provider identity: same cleanup as normalizePpvDisplayName,
// plus stripping a trailing disposable event-slot number when the event's
// own canonical identity is already known (so "PPV 15" is genuinely
// redundant, not the only thing distinguishing this stream from a sibling
// one-off). Never used for grouping — see normalizePpvDisplayName's own
// comment for why that must keep the slot number. Returns null (not an
// empty string) when nothing usable survives, so callers can cleanly fall
// back to the plain cleaned name instead of composing a display line
// around an empty provider.
export function extractProviderIdentity(rawName: string, context?: PpvDisplayNameContext): string | null {
  const cleaned = normalizePpvDisplayName(rawName, context)
  if (cleaned === FALLBACK_NAME) return null
  const withoutSlot = cleaned.replace(EVENT_SLOT_SUFFIX_RE, '').trim()
  return withoutSlot.length > 0 ? withoutSlot : cleaned
}

export interface EventStreamDisplayParts {
  provider: string | null
  eventTitle: string | null
  startTime: string | null
  quality: string | null
}

// Composes the structured contextual identity for an event-specific stream
// (Part N of the redesign task): provider identity from the raw playlist
// evidence (extractProviderIdentity above), event title from CANONICAL
// event data (never re-derived from the raw playlist name — see Part O),
// quality passed straight through from the existing metadata-based quality
// model (rankStreamQuality.ts — this function never computes quality
// itself, one source of truth per Part Q). Football uses "home - away";
// any other event (F1, etc) uses context.eventTitle.
//
// startTime is deliberately the PPV STREAM'S OWN advertised time
// (extractRawStreamStartTime, time-only — no date), not the canonical
// fixture kickoff: a PPV stream commonly starts before the real kickoff
// (pre-match studio/build-up/interviews), and the two are legitimately
// different, both-useful pieces of information — the event header
// elsewhere still shows the real fixture kickoff independently. Falls back
// to the canonical kickoff's own time-of-day (also time-only, same reason)
// ONLY when the raw name carries no extractable time at all — never the
// other way around, and a fixture kickoff must never silently overwrite a
// real advertised stream time. Any segment this fixture genuinely has no
// data for is simply omitted (formatEventStreamDisplayLine below drops
// nulls) — never a fabricated placeholder.
export function buildEventStreamDisplayParts(
  rawName: string,
  context: PpvDisplayNameContext | undefined,
  quality: string | null,
): EventStreamDisplayParts {
  const provider = context ? extractProviderIdentity(rawName, context) : null
  const eventTitle =
    context?.homeTeam && context?.awayTeam ? `${context.homeTeam} - ${context.awayTeam}` : (context?.eventTitle ?? null)
  const startTime = extractRawStreamStartTime(rawName) ?? (context?.dateTimeUtc ? formatTimeOnly24h(context.dateTimeUtc) || null : null)
  return { provider, eventTitle, startTime, quality }
}

// Joins whichever parts are actually present with " | ", e.g. "VIAPLAY |
// Arsenal - Coventry | 20:00 | 8K" — startTime is time-only (no date, see
// buildEventStreamDisplayParts's own comment). Used both for the compact
// Event Details display name (quality omitted — StreamRow already renders
// quality via its own pills, see Part X) and the full player-overlay line
// (quality included — the player has no separate quality pill). A single
// formatter for both keeps there being exactly one place that decides how
// parts join together.
export function formatEventStreamDisplayLine(parts: EventStreamDisplayParts): string {
  return [parts.provider, parts.eventTitle, parts.startTime, parts.quality].filter((p): p is string => Boolean(p)).join(' | ')
}

// Contextual PPV display name for Event Details' single-line stream rows
// (no quality — see formatEventStreamDisplayLine's own comment). Returns
// null only when there's no usable event context at all (falls back to the
// plain normalizePpvDisplayName cleanup, see getChannelDisplayName). When
// context exists but provider extraction found nothing usable, the line is
// composed from the CANONICAL event identity alone ("Fulham - Chelsea |
// 20:15") — the event is already resolved at this point, so a generic
// "PPV Event" placeholder would be discarding information the app
// verifiably has (see the redesign task: "PPV Event" must be a true last
// resort, reachable only when event identity cannot be determined).
function buildContextualPpvDisplayName(rawName: string, context?: PpvDisplayNameContext): string | null {
  if (!context || (!context.homeTeam && !context.eventTitle)) return null
  const parts = buildEventStreamDisplayParts(rawName, context, null)
  const line = formatEventStreamDisplayLine(parts)
  return line.length > 0 ? line : null
}

// Picks the identity a stream row should actually show, per priority:
// 1. ninety-api's own canonical broadcaster name, for a group a 'ninety'
//    match contributed to — cleaner than the raw playlist spelling for a
//    confidently-resolved stable linear channel.
// 2. for a group whose representative channel is playlist-categorized as
//    PPV (see parseCategory/isPpvCategory), the CONTEXTUAL event-stream
//    identity (provider + event title + start time — Part L-U of the
//    redesign task) when canonical event context is available and
//    provider extraction found something usable; otherwise the plain
//    normalized PPV display name (today's cleanup, unchanged) as a graceful
//    fallback — never a raw, unmangled playlist string either way.
// 3. the group's own (already merge-time-normalized, see normalize.ts)
//    playlist display name, for an ordinary linear channel.
// The underlying playable Channel/ChannelSource is untouched either way —
// this only decides what text represents the group.
export function getChannelDisplayName(group: MatchGroup, context?: PpvDisplayNameContext): string {
  if (group.canonicalBroadcastName) return group.canonicalBroadcastName
  const representative = group.sourceOptions[0]?.channel
  const category = parseCategory(representative?.groupTitle ?? '')
  if (isPpvCategory(category)) {
    return buildContextualPpvDisplayName(group.name, context) ?? normalizePpvDisplayName(group.name, context)
  }
  return group.name
}
