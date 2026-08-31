import { Readable } from 'node:stream'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
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
          // Flagged as OUR failure, not the upstream's. A 502 alone is
          // ambiguous — a provider can send one itself — so a host that
          // does not resolve was reaching the app as "provider server
          // returned an error". The header lets fetchWithDevCorsFallback
          // keep the original direct failure's classification instead.
          res.statusCode = 502
          res.setHeader('X-Dev-Proxy-Upstream-Error', err instanceof Error ? err.message : 'Proxy fetch failed')
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

// Keeps OS/editor droppings out of the shipped package.
//
// Vite copies public/ into dist/ wholesale, with no filter option, so a
// .DS_Store that Finder writes into public/backgrounds/ (gitignored, and
// therefore invisible in `git status`) was being copied into dist/ and from
// there straight into the .wgt. It is real bytes in a real release artifact
// that no reviewer would ever see in a diff.
//
// Runs on the browser build as well as the Tizen one, because build:tizen
// stages from dist/ — fixing it here fixes both targets in one place.
function stripDotfilesFromOutputPlugin(): Plugin {
  return {
    name: 'ninety-strip-dotfiles-from-output',
    // `writeBundle` runs after Vite has copied publicDir, which `closeBundle`
    // is not guaranteed to.
    closeBundle: {
      order: 'post',
      handler() {
        const outDir = resolve(import.meta.dirname, 'dist')
        if (!existsSync(outDir)) return
        for (const entry of readdirSync(outDir, { recursive: true, withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.startsWith('.')) continue
          rmSync(resolve(entry.parentPath, entry.name), { force: true })
        }
      },
    },
  }
}

// Decides, at BUILD time, whether index.html's boot script is allowed to
// show the raw developer diagnostic overlay.
//
// Same gate as core/perf/devPerf.ts's PERF_DIAGNOSTICS_ENABLED (`DEV ||
// VITE_PERF_DIAGNOSTICS === '1'`), deliberately, so there is one way to ask
// for on-device diagnostics rather than two:
//
//   VITE_PERF_DIAGNOSTICS=1 npm run build:tizen
//
// index.html is plain HTML, not a module, so it cannot read import.meta.env
// itself — this plugin substitutes the decision into it. The placeholder
// resolves to `false` for an ordinary production build, which is what makes
// the branded crash screen (not the stack dump) the beta failure UX.
function bootDiagnosticsFlagPlugin(isDiagnostic: boolean): Plugin {
  return {
    name: 'ninety-boot-diagnostics-flag',
    // `order: 'pre'` is load-bearing. Vite minifies index.html's inline
    // script as part of its own HTML processing, and minification strips
    // comments -- including the /* @diagnostics-only */ markers this relies
    // on. Running after that leaves nothing to match and silently ships the
    // block. (Found exactly that way: the first version of this plugin ran
    // at default order and the release artifact still contained the
    // overlay.)
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const withFlag = html.replace('__NINETY_DIAGNOSTICS__', String(isDiagnostic))
        if (isDiagnostic) return withFlag
        // Strip the diagnostic-only block entirely rather than leaving it
        // unreachable behind the flag. Dead code in a release artifact
        // still reads as a shipped debug surface to anyone auditing the
        // package, and "the string is absent" is a check a release process
        // can run; "the flag happens to be false" is not.
        return withFlag.replace(
          /\/\* @diagnostics-only:start \*\/[\s\S]*?\/\* @diagnostics-only:end \*\//g,
          '',
        )
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const diagnostics = command === 'serve' || mode === 'development' || process.env.VITE_PERF_DIAGNOSTICS === '1'
  return {
  // Relative, not root-absolute: a packaged Tizen .wgt is loaded via
  // file://.../index.html (config.xml's <content src="index.html"/> is
  // resolved relative to the widget's own extracted directory, not a web
  // server root), so a base of '/' makes every asset URL resolve to the
  // filesystem root instead of the widget's assets — the bundle 404s
  // before React ever mounts (blank screen, nothing in console). Relative
  // paths also resolve correctly under GitHub Pages' /ninety-tv/ subpath,
  // so one setting covers both targets — no per-target branching needed.
    base: './',
    build: { target: 'es2017' },
    // WORKER OUTPUT FORMAT — pinned, not left to the default.
    //
    // 'iife' emits each Worker entry as a self-contained CLASSIC script
    // (no import/export), which is what lets the Worker constructors in
    // data/playlists/playlistBuildWorkerClient.ts and
    // data/sports/channelIdentityWorkerClient.ts drop `{ type: 'module' }`
    // in production builds. Module Workers need Chromium 80; Samsung maps
    // 2021 sets to Tizen 6.0 / Chromium M76, so a module Worker throws at
    // construction there and channel identity resolution — which has no
    // synchronous fallback by design — silently never runs.
    //
    // This IS Vite's current default, and it was already producing IIFE
    // worker chunks before this was written. It is stated explicitly
    // anyway because the app's platform floor depends on it: a default is
    // free to change in a major version, and 'es' here would break TVs
    // rather than fail the build. Changing it must be a deliberate,
    // reviewed act — see workerCompatibility.test.ts, which asserts it.
    worker: { format: 'iife' },
    plugins: [react(), iptvDevProxyPlugin(), bootDiagnosticsFlagPlugin(diagnostics), stripDotfilesFromOutputPlugin()],
  }
})
