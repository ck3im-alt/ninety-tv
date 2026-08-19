// Lightweight performance instrumentation — gated so it can run inside a
// physical, PRODUCTION-mode Tizen .wgt (not just `vite dev`), since that's
// the only environment available for on-device validation (no attached dev
// server / React DevTools on a real TV). `VITE_PERF_DIAGNOSTICS=1 npm run
// build:tizen` produces a real production build with this instrumentation
// compiled in — VITE_*-prefixed env vars are statically inlined by Vite at
// build time, same mechanism as every other import.meta.env.* check in this
// codebase.
//
// Every mark/measure/long-task also accumulates into `window.__ninetyPerf`
// so it can be pulled off a real device via Tizen's remote-debugging
// console (`copy(JSON.stringify(window.__ninetyPerf))`) — same convention as
// the existing `window.__ninetyExportChannels` DEV tool in App.tsx.
// import.meta.env is a Vite-injected property — undefined when this module
// is loaded outside Vite (e.g. scripts/benchmarkChannelIndex.ts and other
// tsx/Node-run scripts that import modules which transitively pull this
// file in). Guarded so those contexts just get diagnostics-disabled instead
// of a crash on `undefined.DEV`.
const viteEnv = (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env
export const PERF_DIAGNOSTICS_ENABLED = Boolean(viteEnv && (viteEnv.DEV || viteEnv.VITE_PERF_DIAGNOSTICS === '1'))

interface NinetyPerfLog {
  marks: { name: string; time: number }[]
  // `start`/`end` are the mark names measurePerf() derived the duration
  // from — omitted for a duration recorded directly via recordPerf() below,
  // since there's no corresponding mark pair for it.
  measures: { name: string; duration: number; start?: string; end?: string }[]
  longTasks: { duration: number; startTime: number }[]
}

function perfLog(): NinetyPerfLog | null {
  if (!PERF_DIAGNOSTICS_ENABLED || typeof window === 'undefined') return null
  const w = window as unknown as { __ninetyPerf?: NinetyPerfLog }
  if (!w.__ninetyPerf) w.__ninetyPerf = { marks: [], measures: [], longTasks: [] }
  return w.__ninetyPerf
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function markPerf(name: string): void {
  if (!PERF_DIAGNOSTICS_ENABLED) return
  try {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
      performance.mark(name)
    }
  } catch {
    // Older/restricted WebKit — skip gracefully, still record in the log below.
  }
  const log = perfLog()
  if (log) log.marks.push({ name, time: now() })
}

// `end` defaults to "now" (via a synthetic mark) when omitted — lets callers
// measure "from this mark to right now" in one call.
export function measurePerf(name: string, start: string, end?: string): void {
  if (!PERF_DIAGNOSTICS_ENABLED) return
  const log = perfLog()
  const startEntry = log?.marks.findLast((m) => m.name === start)
  const endEntry = end ? log?.marks.findLast((m) => m.name === end) : undefined
  const endTime = endEntry?.time ?? now()
  const duration = startEntry ? endTime - startEntry.time : NaN
  try {
    if (typeof performance !== 'undefined' && typeof performance.measure === 'function') {
      if (end) performance.measure(name, start, end)
      else performance.measure(name, start)
    }
  } catch {
    // Missing start/end mark on this engine, or measure() unsupported — the
    // manual duration computed above still gets logged/reported below.
  }
  if (!Number.isNaN(duration)) {
    console.info(`[perf] ${name}: ${duration.toFixed(1)}ms`)
  }
  if (log) log.measures.push({ name, duration, start, end })
}

// Records a duration that's already been computed elsewhere (e.g.
// channelIdentityLifecycle.ts's projectionMs / workerRoundTripMs, timed via
// their own performance.now() deltas for reasons unrelated to this log —
// the Worker round-trip figure in particular is computed inside
// channelIdentityWorkerClient.ts from postMessage-adjacent timestamps, not
// from a markPerf()/measurePerf() mark pair) — appends straight into the
// same window.__ninetyPerf.measures array measurePerf() writes to, without
// re-timing anything or introducing a second measurement pass over the same
// work.
export function recordPerf(name: string, durationMs: number): void {
  if (!PERF_DIAGNOSTICS_ENABLED) return
  console.info(`[perf] ${name}: ${durationMs.toFixed(1)}ms`)
  const log = perfLog()
  if (log) log.measures.push({ name, duration: durationMs })
}

// PerformanceObserver('longtask') support varies a lot across engines
// (older Tizen WebKit versions may not implement it at all) — every step
// here is feature-detected and wrapped so an unsupported engine just skips
// long-task observation instead of throwing during app boot.
export function startLongTaskObserver(): () => void {
  if (!PERF_DIAGNOSTICS_ENABLED) return () => {}
  if (typeof PerformanceObserver === 'undefined') return () => {}
  const supported = (PerformanceObserver as unknown as { supportedEntryTypes?: string[] }).supportedEntryTypes
  if (supported && !supported.includes('longtask')) return () => {}

  try {
    const observer = new PerformanceObserver((list) => {
      const log = perfLog()
      for (const entry of list.getEntries()) {
        console.warn(`[perf] long task: ${entry.duration.toFixed(1)}ms at ${entry.startTime.toFixed(1)}ms`)
        if (log) log.longTasks.push({ duration: entry.duration, startTime: entry.startTime })
      }
    })
    observer.observe({ entryTypes: ['longtask'] })
    return () => observer.disconnect()
  } catch {
    return () => {}
  }
}
