// Thin typed wrapper over localStorage. This is per-device preference
// data (a handful of booleans/strings) — no backend/database involved and
// none needed: nothing here has to sync across devices or survive a
// reinstall. Tizen's Web Runtime supports localStorage same as any
// Chromium browser, so this works unchanged in the packaged widget.
// Wrapped in try/catch since some environments (private browsing, quota
// exceeded) can throw on access — preferences are a nice-to-have, not
// something that should crash the app if storage is unavailable.

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeStored<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable/full — preferences just won't persist this run.
  }
}

const APP_STORAGE_PREFIX = 'ninety.'

// Used by the admin/debug panel to reset local state for testing. Only
// clears keys this app itself wrote (prefix-scoped) rather than
// localStorage.clear() — leaves anything else sharing the origin's
// storage untouched.
export function clearAllAppStorage(): void {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(APP_STORAGE_PREFIX))
    for (const key of keys) localStorage.removeItem(key)
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
