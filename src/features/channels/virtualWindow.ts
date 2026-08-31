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
  const start = windowStartContaining(centerIndex, mountedCount, maxStart)
  return { start, shifted: start !== windowStart }
}

// WHERE THE MOUNTED WINDOW HAS TO START for `targetIndex` to be one of the
// rows actually in the DOM, centred as far as the ends of the list allow.
// Split out of planWindowShift because restoring a row (below) needs the
// same answer without any notion of a "current" window to compare against.
export function windowStartContaining(targetIndex: number, mountedCount: number, maxStart: number): number {
  if (targetIndex <= 0) return 0
  return Math.max(0, Math.min(targetIndex - Math.floor(mountedCount / 2), maxStart))
}

// RETURNING TO THE CHANNEL YOU WERE JUST WATCHING.
//
// Pressing Back out of the player used to drop the viewer at the top of the
// channel list, because the list's mounted window is local to it and starts
// at row 0 on every remount — so the row they came from was not merely
// unfocused, it was not in the DOM at all, and nothing could focus it.
//
// This is the whole decision, made BEFORE anything is focused: which row to
// land on, and which window must be mounted for that row to exist.
//
// IDENTITY, NOT POSITION. The target is looked up by channel id every time.
// A playlist refresh, a filter change or an unfavorite can insert or drop
// rows above the viewer, so the index the channel had when playback started
// is not the index it has now — trusting it would silently restore the wrong
// channel, which is worse than not restoring at all.
//
// When the channel is genuinely gone (removed by a refresh, unfavorited from
// the Favorites list, filtered out) there is no "nearest" row to fall back
// to: the old index cannot be trusted for the same reason it cannot be
// trusted when the channel IS present. So this falls back to the first row —
// exactly the behaviour that existed before restoration, for the one case
// where nothing better is knowable. `found` reports which of the two
// happened, so a caller can tell a real restore from a fallback.
export interface ChannelRestorePlan {
  // The row to focus, or -1 for an empty list (nothing to focus at all).
  index: number
  // The window start that mounts that row.
  windowStart: number
  // Whether the requested channel was actually located.
  found: boolean
}

export function planChannelRestore(
  channels: readonly { id: string }[],
  restoreChannelId: string | null | undefined,
  mountedCount: number,
  maxStart: number,
): ChannelRestorePlan {
  if (channels.length === 0) return { index: -1, windowStart: 0, found: false }
  const index = restoreChannelId ? channels.findIndex((channel) => channel.id === restoreChannelId) : -1
  if (index === -1) return { index: 0, windowStart: 0, found: false }
  return { index, windowStart: windowStartContaining(index, mountedCount, maxStart), found: true }
}
