// Thin typed wrapper over localStorage. Originally written for per-device
// preference data (a handful of booleans/strings), now also used for the
// cached channel list, which can be large enough to hit a quota on some
// Tizen Web Runtime versions. Wrapped in try/catch since some environments
// (private browsing, quota exceeded) can throw on access — but unlike the
// original version of this module, a write failure is reported back to the
// caller instead of swallowed, so callers that care (large, load-bearing
// writes like the channel cache) can react instead of silently believing
// data persisted when it didn't.

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// Returns whether the write actually succeeded. Small preference writes
// can reasonably ignore the return value (losing a filter toggle isn't
// worth handling specially); large writes should check it.
export function writeStored<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (err) {
    console.error(`[storage] Failed to write "${key}" — data will not persist across reload.`, err)
    return false
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
