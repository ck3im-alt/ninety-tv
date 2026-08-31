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

// Clears local state this app itself wrote. Only prefix-scoped keys, never
// localStorage.clear() — anything else sharing the origin's storage stays
// untouched.
//
// `preserveKeys` lets a caller keep a named subset (see data/resetAppData.ts,
// which uses it to reset the app WITHOUT disconnecting the playlist). It is
// deliberately an opt-OUT list rather than an opt-in one: a key added later
// by someone who never read this function is then cleared by default, which
// is the safe direction for a reset — the bug you can ship here is a reset
// that quietly leaves something behind, not one that clears too much.
export function clearAllAppStorage(preserveKeys: readonly string[] = []): void {
  try {
    const preserved = new Set(preserveKeys)
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(APP_STORAGE_PREFIX) && !preserved.has(k))
    for (const key of keys) localStorage.removeItem(key)
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
