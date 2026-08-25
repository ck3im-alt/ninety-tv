import { useEffect, useState } from 'react'

// TEMPORARY — added specifically for the Multiview real-Tizen-device
// verification pass (no devtools/console exists on real Samsung TV
// hardware, same constraint that motivated this app's earlier temporary
// "boot diagnostic overlay" — see project memory). Reads each live pane's
// actual decoded video dimensions/engine straight off the DOM (not React
// state) since this needs to work regardless of which pane component
// mounted it. Rendered unconditionally while Multiview is active — NOT
// gated behind import.meta.env.DEV, because it has to appear in the real
// signed .wgt build used for on-device testing. REMOVE (or gate behind a
// real runtime toggle) once that verification pass is complete and its
// findings are recorded — do not ship this in the app long-term.
const POLL_MS = 500

interface PaneReading {
  index: number
  width: number
  height: number
  readyState: number
  paused: boolean
  currentSrc: string
}

function engineFor(currentSrc: string): string {
  if (currentSrc.startsWith('blob:')) return 'MSE (hls.js/mpegts.js)'
  if (currentSrc) return 'native/direct'
  return '—'
}

export function MultiviewDebugOverlay() {
  const [readings, setReadings] = useState<PaneReading[]>([])

  useEffect(() => {
    const id = setInterval(() => {
      const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video.multiview-video'))
      setReadings(
        videos.map((video, index) => ({
          index,
          width: video.videoWidth,
          height: video.videoHeight,
          readyState: video.readyState,
          paused: video.paused,
          currentSrc: video.currentSrc,
        })),
      )
    }, POLL_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        right: 8,
        top: 8,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.8)',
        color: '#7CFC9C',
        font: '12px/1.5 monospace',
        padding: '8px 10px',
        borderRadius: 6,
        pointerEvents: 'none',
        whiteSpace: 'pre',
      }}
    >
      {readings.length === 0
        ? 'multiview debug: no <video> elements found'
        : readings
            .map(
              (r) =>
                `pane ${r.index}: ${r.width || '?'}x${r.height || '?'}  ready=${r.readyState}  ${r.paused ? 'paused' : 'playing'}  ${engineFor(r.currentSrc)}`,
            )
            .join('\n')}
    </div>
  )
}
