// The pure decision behind VirtualChannelList's shiftWindow: given where the
// user is trying to move focus to and the mounted window's current bounds,
// decides whether the window actually needs to move — or whether
// `centerIndex` is already inside it, in which case there's nothing to
// shift and the caller should just focus it directly instead of setting
// state that won't change.
//
// This split out from shiftWindow (not just left inline) specifically so it
// stays a plain, testable function — VirtualChannelList.tsx itself only
// exports the component, so Vite's fast-refresh doesn't warn on it, and this
// exact math gets a unit test (see virtualWindow.test.ts) instead of only
// being exercised indirectly through norigin/React on a physical device.
//
// Whenever `shifted` comes back false, `centerIndex` is guaranteed to
// already be inside the current mounted range: `start` is `centerIndex -
// half` clamped to `[0, maxStart]`. If it comes out unclamped, centerIndex =
// windowStart + half, which is within [windowStart, windowStart +
// mountedCount) since 0 <= half < mountedCount. If it clamped to 0 (and
// windowStart was already 0), centerIndex <= half < mountedCount, so still
// in range. If it clamped to maxStart (and windowStart was already
// maxStart), centerIndex is at most channels.length - 1 (it's always some
// existing row's index ± 1, never past the end), which is < maxStart +
// mountedCount = channels.length. So focusing it directly — with no window
// shift — is always valid in that case.
export function planWindowShift(
  centerIndex: number,
  windowStart: number,
  mountedCount: number,
  maxStart: number,
): { start: number; shifted: boolean } {
  const half = Math.floor(mountedCount / 2)
  const start = Math.max(0, Math.min(centerIndex - half, maxStart))
  return { start, shifted: start !== windowStart }
}
