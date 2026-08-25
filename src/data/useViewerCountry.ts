import { useEffect, useMemo, useState } from 'react'
import { readBrowserLocaleTags, readDeviceLocale } from '../core/platform'
import { dominantPlaylistCountry, resolveViewerCountry, type ViewerCountry } from './viewerCountry'
import type { Channel } from './channel'

// Wires viewerCountry.ts's pure resolution to the actual device.
//
// The Tizen probe is async (its API is callback-only — see
// core/platform/deviceRegion.ts), so the first render resolves from the
// locale/playlist tiers alone and upgrades to the 'tizen-region' tier once
// the probe answers. On a real TV that lands in well under a frame, and
// this hook is mounted by OnboardingFlow from step 1 onward — long before
// the recommendations it feeds are rendered on step 2 — so the upgrade is
// never visible as a list reshuffling under the user. On a browser (dev)
// the probe resolves null immediately and the locale tier answers.
//
// Recomputes when the playlist changes because step 1 may connect one
// mid-flow; that only matters when neither of the higher-confidence tiers
// produced anything.
export function useViewerCountry(channels: readonly Channel[]): ViewerCountry {
  const [tizenLocale, setTizenLocale] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void readDeviceLocale().then((locale) => {
      if (!cancelled) setTizenLocale(locale)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const playlistCountryCode = useMemo(() => dominantPlaylistCountry(channels)?.code ?? null, [channels])

  return useMemo(
    () => resolveViewerCountry({ tizenLocale, localeTags: readBrowserLocaleTags(), playlistCountryCode }),
    [tizenLocale, playlistCountryCode],
  )
}
