// Reads the TV's own system region, if the platform exposes one at all.
// Returns the RAW locale string — parsing/canonicalization lives in
// data/viewerCountry.ts so this file stays a thin, fully-guarded platform
// read (same separation as keys.ts vs the features that consume NavIntent).
//
// WHAT TIZEN 6+ ACTUALLY EXPOSES (investigated for the onboarding
// personalization work, 2026-08-25 — not assumed from mobile Tizen docs):
//
//   - tizen.systeminfo.getPropertyValue('LOCALE', ...) -> SystemInfoLocale
//     { language, country }, both in a '(LANGUAGE)_(REGION)' shape such as
//     'eng_US'. This is the non-sensitive device/system value we prefer.
//     It is CALLBACK-based (no sync/Promise form), which is the only reason
//     this function is async.
//
//   - webapis.productinfo.getSystemConfig(
//       webapis.productinfo.ProductInfoConfigKey.CONFIG_KEY_SERVICE_COUNTRY)
//     is Samsung's own, more authoritative "which country was this set sold
//     into" value. Deliberately NOT used: it requires the partner-level
//     privilege http://developer.samsung.com/privilege/productinfo, which
//     config.xml does not declare (and which would put the app into a
//     stricter Samsung review tier). Country-level personalization does not
//     justify that — the locale fallback in viewerCountry.ts covers the same
//     ground well enough, and a wrong guess only affects which league card
//     is suggested first.
//
// Everything below is feature-detected and try/caught. Whether
// tizen.systeminfo needs http://tizen.org/privilege/system on a given
// firmware is not something to bet the boot sequence on: any throw
// (including a SecurityError from a missing privilege) is treated as "no
// signal" and the caller falls through to the locale/playlist tiers.

// Some firmware has been observed never invoking either callback. A hung
// vendor callback must not leave onboarding waiting on a signal that will
// never arrive, so the probe resolves null after this long regardless.
const PROBE_TIMEOUT_MS = 1500

interface TizenLocaleLike {
  language?: string
  country?: string
}

function readTizenSystemLocale(): Promise<string | null> {
  return new Promise((resolve) => {
    const systeminfo = typeof window !== 'undefined' ? window.tizen?.systeminfo : undefined
    if (typeof systeminfo?.getPropertyValue !== 'function') {
      resolve(null)
      return
    }

    let settled = false
    const settle = (value: string | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timer = setTimeout(() => settle(null), PROBE_TIMEOUT_MS)
    const finish = (value: string | null) => {
      clearTimeout(timer)
      settle(value)
    }

    try {
      systeminfo.getPropertyValue(
        'LOCALE',
        (locale: TizenLocaleLike) => {
          // `country` is the region-bearing field; `language` carries the
          // same '(LANGUAGE)_(REGION)' shape on every firmware seen, so it
          // is a reasonable second read rather than a separate concept.
          finish(locale?.country ?? locale?.language ?? null)
        },
        () => finish(null),
      )
    } catch (err) {
      // Missing privilege, unsupported property, or an API that simply
      // isn't there on this firmware — all equally "no signal".
      console.warn('[deviceRegion] Tizen LOCALE lookup unavailable — falling back to the browser locale.', err)
      finish(null)
    }
  })
}

// Cached for the session: the TV's region cannot change without a settings
// change + app restart, and onboarding may ask for it from more than one
// place.
let probe: Promise<string | null> | null = null

export function readDeviceLocale(): Promise<string | null> {
  probe ??= readTizenSystemLocale()
  return probe
}

// The browser/TV UI locale tags, most-preferred first. Guarded because
// `navigator.languages` is absent on some older TV runtimes even though
// `navigator.language` is present.
export function readBrowserLocaleTags(): string[] {
  if (typeof navigator === 'undefined') return []
  const tags = Array.isArray(navigator.languages) ? navigator.languages : []
  const all = [...tags, navigator.language]
  return all.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)
}

// Test-only escape hatch — production code never needs to re-probe.
export function __resetDeviceRegionProbeForTests(): void {
  probe = null
}
