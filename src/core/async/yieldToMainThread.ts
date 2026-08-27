// One shared "let the main thread breathe" primitive.
//
// Extracted from data/channelIndex.ts's warmChannelIndexAsync, which has
// used exactly this since the channel-index work: a long, unavoidably
// per-item pass is chunked, and between chunks control goes back to the
// event loop so a queued keydown, a paint, or a video callback can run
// instead of waiting behind the whole pass.
//
// requestIdleCallback is preferred because it lets the browser place the
// next chunk in genuinely idle time, and the `timeout` guarantees the pass
// still finishes on a busy main thread rather than starving forever. Tizen
// WebKit builds that do not implement it fall back to setTimeout(0), which
// yields a task boundary just the same — slightly more eagerly, which is
// the safe direction to be wrong in.
export function yieldToMainThread(timeoutMs = 50): Promise<void> {
  return new Promise((resolve) => {
    const w = globalThis as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(() => resolve(), { timeout: timeoutMs })
    else setTimeout(resolve, 0)
  })
}
