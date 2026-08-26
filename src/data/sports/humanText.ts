// Repairs the one data-quality defect that shows up repeatedly in
// third-party sports metadata: text that was correctly encoded as UTF-8
// somewhere upstream but decoded once as Latin-1/Windows-1252 on its way to
// us, so "Estadio Santiago Bernabéu" arrives as "Estadio Santiago
// BernabÃ©u". This is applied at the event-mapping boundary (mapEvent.ts,
// both pathways) rather than in any one screen, so every surface reading
// SportEvent.venue gets repaired text without knowing this exists.
//
// Deliberately scoped to sports event text (venues today). Channel/EPG
// strings have their own normalization pipeline with completely different
// rules (data/normalize.ts + data/fancyUnicode.ts, which intentionally
// PRESERVE decorative Unicode that IPTV panels use as real branding) —
// running this over them would be a second, conflicting authority on the
// same strings.
//
// Conservative by construction: a repair is only attempted when the exact
// mojibake byte signature is present, only applied when the recovered bytes
// are valid UTF-8, and abandoned (returning the input untouched) at the
// first sign that the input wasn't mojibake after all. Already-correct
// Unicode is never modified. No dependency, no TextDecoder/Intl feature
// detection — plain ES2017 that behaves identically in Node, jsdom and
// Tizen's Chromium.

// Windows-1252 assigns printable characters to the 0x80–0x9F byte window
// that Latin-1 leaves as C1 controls. When a CP1252 decoder is what
// mangled the text, those bytes come back as these specific code points,
// so recovering the original byte means mapping them back. (A true Latin-1
// decoder leaves them as U+0080–U+009F, which byteOf below handles via the
// plain code-point path.)
const CP1252_TO_BYTE: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  'ƒ': 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  'ˆ': 0x88,
  '‰': 0x89,
  'Š': 0x8a,
  '‹': 0x8b,
  'Œ': 0x8c,
  'Ž': 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  'š': 0x9a,
  '›': 0x9b,
  'œ': 0x9c,
  'ž': 0x9e,
  'Ÿ': 0x9f,
}

// The byte this character would have been before a single-byte decoder saw
// it, or null when no single byte could have produced it (i.e. the string
// contains real multi-byte Unicode and therefore isn't a pure mojibake
// artifact).
function byteOf(ch: string): number | null {
  const code = ch.codePointAt(0)
  if (code == null) return null
  if (code <= 0xff) return code
  return CP1252_TO_BYTE[ch] ?? null
}

// A UTF-8 lead byte reinterpreted as a single-byte character. 0xC2–0xF4 is
// the full set of legal lead bytes (0xC0/0xC1 only ever encode overlong
// forms; nothing above 0xF4 is valid UTF-8 at all).
const UTF8_LEAD_MIN = 0xc2
const UTF8_LEAD_MAX = 0xf4
const UTF8_CONT_MIN = 0x80
const UTF8_CONT_MAX = 0xbf

// The mojibake signature: a legal UTF-8 lead byte immediately followed by a
// legal continuation byte, both surviving as single-byte characters. Real
// accented text almost never produces this — "Bernabéu" is é (0xE9, a legal
// lead) followed by "u" (0x75, not a continuation), so it never trips.
// Checking BEFORE attempting recovery is what keeps correct Unicode safe:
// no signature, no repair, no risk.
function looksLikeMojibake(text: string): boolean {
  const chars = Array.from(text)
  for (let i = 0; i < chars.length - 1; i++) {
    const lead = byteOf(chars[i])
    if (lead == null || lead < UTF8_LEAD_MIN || lead > UTF8_LEAD_MAX) continue
    const next = byteOf(chars[i + 1])
    if (next != null && next >= UTF8_CONT_MIN && next <= UTF8_CONT_MAX) return true
  }
  return false
}

// Every character back to the single byte it came from. Bails out entirely
// (null) the moment a character can't have come from one byte — a string
// mixing mojibake with genuine multi-byte Unicode is left alone rather than
// half-repaired.
function toBytes(text: string): number[] | null {
  const bytes: number[] = []
  for (const ch of text) {
    const b = byteOf(ch)
    if (b == null) return null
    bytes.push(b)
  }
  return bytes
}

// Strict UTF-8 decode — null (never U+FFFD) on anything invalid, including
// overlong encodings, surrogate code points and truncated sequences. The
// strictness is the point: "these bytes decode cleanly as UTF-8" is the
// second, independent confirmation that the input really was mojibake.
function decodeUtf8(bytes: number[]): string | null {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b0 = bytes[i]
    if (b0 < 0x80) {
      out += String.fromCharCode(b0)
      i += 1
      continue
    }
    let needed: number
    let cp: number
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      needed = 1
      cp = b0 & 0x1f
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      needed = 2
      cp = b0 & 0x0f
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      needed = 3
      cp = b0 & 0x07
    } else {
      return null
    }
    if (i + needed > bytes.length - 1) return null
    for (let k = 1; k <= needed; k++) {
      const b = bytes[i + k]
      if (b < UTF8_CONT_MIN || b > UTF8_CONT_MAX) return null
      cp = (cp << 6) | (b & 0x3f)
    }
    if (needed === 1 && cp < 0x80) return null
    if (needed === 2 && (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff))) return null
    if (needed === 3 && (cp < 0x10000 || cp > 0x10ffff)) return null
    out += String.fromCodePoint(cp)
    i += needed + 1
  }
  return out
}

// Feeds that double-encode exist ("ÃƒÂ©" for "é"), so one pass isn't always
// enough — but each additional pass has to re-prove the signature and
// re-prove valid UTF-8, so this can't run away on well-formed text. Three
// is far past anything seen in practice.
const MAX_REPAIR_PASSES = 3

export function repairMojibake(text: string): string {
  let current = text
  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {
    if (!looksLikeMojibake(current)) return current
    const bytes = toBytes(current)
    if (bytes == null) return current
    const decoded = decodeUtf8(bytes)
    if (decoded == null || decoded.indexOf('�') !== -1) return current
    current = decoded
  }
  return current
}

// Repair + trim + Unicode NFC, so two spellings of the same accented name
// (precomposed "é" vs "e" + combining acute) compare and render identically.
// String.prototype.normalize is ES6 and present on every runtime this app
// targets; the guard is belt-and-braces for an unexpectedly old engine, not
// an expected code path.
export function normalizeHumanText(text: string): string {
  const repaired = repairMojibake(text).trim()
  return typeof repaired.normalize === 'function' ? repaired.normalize('NFC') : repaired
}

// The shape both event mappers need: a nullable upstream field in, an
// optional SportEvent field out.
export function normalizeVenueName(value: string | null | undefined): string | undefined {
  if (value == null) return undefined
  return normalizeHumanText(value)
}
