// A fetch that cannot hang forever.
//
// WHY THIS EXISTS. A television has no tab to close and no reload button a
// viewer would think to reach for: a request that never settles is not a
// slow screen, it is a dead appliance. Every network call the app makes
// while the viewer is waiting on it therefore needs an upper bound.
//
// This is deliberately the SAME mechanism xtreamClient.ts already uses
// (AbortController + a setTimeout that aborts, cleared in a finally) rather
// than a second, different one. That client keeps its own copy because it
// folds the abort into its own XtreamError vocabulary; this module is for
// everything else that was still calling bare fetch(). AbortController and
// fetch's `signal` option are both ES2017-era platform APIs present on the
// Tizen 6.0 WebKit this app targets — no newer API (AbortSignal.timeout(),
// AbortSignal.any()) is used, precisely because those are NOT safely
// available there.

// Distinguishes "we gave up waiting" from "the server said no", which the
// caller needs because the two deserve different handling: an HTTP failure
// is usually permanent for this request, a timeout is usually worth a
// retry and must never be allowed to destroy already-good cached data.
export class RequestTimeoutError extends Error {
  readonly timeoutMs: number
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`)
    this.name = 'RequestTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export function isRequestTimeout(err: unknown): boolean {
  return err instanceof RequestTimeoutError
}

// Matches xtreamClient.ts's REQUEST_TIMEOUT_MS. Generous enough for a slow
// provider or a cold backend, well short of the point where a viewer
// decides the app is frozen. Not tuned per call site without a reason —
// one number is easier to reason about than five.
export const DEFAULT_REQUEST_TIMEOUT_MS = 12_000

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number
}

// Distinguishing OUR abort from the CALLER's is the subtle part. Both
// surface as the same AbortError, so a caller that passed its own signal
// (an unmounting screen, a superseded search) would otherwise see its
// deliberate cancellation reported as a timeout — and retry it.
export async function fetchWithTimeout(
  input: string,
  { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, signal: callerSignal, ...init }: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  // Forwarding the caller's abort by listening rather than by
  // AbortSignal.any(), which Tizen 6.0's WebKit does not have.
  const forwardAbort = () => controller.abort()
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort()
    else callerSignal.addEventListener('abort', forwardAbort)
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (err) {
    // Only OUR timer's abort becomes a timeout. A caller-initiated abort is
    // re-thrown untouched so `err.name === 'AbortError'` checks upstream
    // keep working exactly as before.
    if (timedOut && err instanceof Error && err.name === 'AbortError') {
      throw new RequestTimeoutError(timeoutMs)
    }
    throw err
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', forwardAbort)
  }
}
