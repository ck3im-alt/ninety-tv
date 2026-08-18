import { Readable } from 'node:stream'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-only passthrough proxies so the app works against IPTV/Xtream hosts
// that don't send CORS headers — which is most of them. Node has no CORS
// restriction, so the dev server can fetch on the browser's behalf. None of
// this exists in the built app (Tizen .wgt or any static deploy) — only
// `vite dev` registers these middlewares. In production, Tizen's WARP
// <access> policy (see config.xml) grants the packaged widget cross-origin
// network access directly, so no proxy is needed there at all.
function iptvDevProxyPlugin(): Plugin {
  return {
    name: 'ninety-iptv-dev-proxy',
    configureServer(server) {
      // Plain passthrough — used for the M3U/Xtream JSON API text fetches.
      server.middlewares.use('/dev-proxy/m3u', async (req, res) => {
        const target = new URL(req.url ?? '', 'http://localhost').searchParams.get('url')
        if (!target) {
          res.statusCode = 400
          res.end('Missing url query param')
          return
        }
        try {
          const upstream = await fetch(target)
          res.statusCode = upstream.status
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'text/plain')
          res.end(Buffer.from(await upstream.arrayBuffer()))
        } catch (err) {
          res.statusCode = 502
          res.end(err instanceof Error ? err.message : 'Proxy fetch failed')
        }
      })

      // HLS-aware proxy — hls.js fetches the manifest AND every segment it
      // references via JS (unlike a plain <video src>, which isn't
      // CORS-restricted for playback). A plain passthrough only fixes the
      // manifest request; segment URLs inside it still point straight at
      // the CORS-blocked origin. So for .m3u8 responses we rewrite every
      // URI line to route back through this same proxy, recursively.
      server.middlewares.use('/dev-proxy/hls', async (req, res) => {
        const target = new URL(req.url ?? '', 'http://localhost').searchParams.get('url')
        if (!target) {
          res.statusCode = 400
          res.end('Missing url query param')
          return
        }
        try {
          const upstream = await fetch(target)
          const contentType = upstream.headers.get('content-type') ?? ''
          const isManifest = target.includes('.m3u8') || contentType.includes('mpegurl')

          res.statusCode = upstream.status
          res.setHeader('Access-Control-Allow-Origin', '*')

          if (!isManifest) {
            // Live .ts sources (the Xtream default, unlike short finite HLS
            // segments) are a continuous, effectively unbounded response —
            // buffering the whole thing via arrayBuffer() before replying
            // would never resolve. Stream it through as it arrives instead.
            res.setHeader('Content-Type', contentType || 'video/mp2t')
            if (!upstream.body) {
              res.end()
              return
            }
            Readable.fromWeb(upstream.body as import('stream/web').ReadableStream).pipe(res)
            return
          }

          const text = await upstream.text()
          const rewritten = text
            .split('\n')
            .map((line) => {
              const trimmed = line.trim()
              if (!trimmed || trimmed.startsWith('#')) return line
              const resolved = new URL(trimmed, target).toString()
              return `/dev-proxy/hls?url=${encodeURIComponent(resolved)}`
            })
            .join('\n')

          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
          res.end(rewritten)
        } catch (err) {
          res.statusCode = 502
          res.end(err instanceof Error ? err.message : 'Proxy fetch failed')
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/ninety-tv/' : '/',
  plugins: [react(), iptvDevProxyPlugin()],
})
