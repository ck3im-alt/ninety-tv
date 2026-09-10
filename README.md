# ninety-tv

TV-focused frontend for NINETY — a smart TV app for browsing an IPTV playlist (Xtream or M3U) and following football fixtures, with channel-level "watch this match here" resolution. Built with React + TypeScript + Vite, using spatial navigation (`@noriginmedia/norigin-spatial-navigation`) for remote-control input, and targeting both regular browsers and Samsung Tizen TVs.

## Architecture

- **This repo (`ninety-tv`)** is the UI only. It has no server-side logic and holds no sports/broadcast data of its own.
- **[`ninety-api`](../ninety-api)** is a separate backend repo/service that resolves football fixtures, team/league metadata, and real linear TV broadcast channels via its own EPG resolver. `ninety-tv` depends on it for all football data — there is no bundled or fallback data source.
- The user's own IPTV playlist (Xtream or plain M3U) is consumed and stored locally (`src/data/session.ts`, `src/data/xtream/`). When the user chooses phone setup, the API holds a credential-bearing playlist URL only as a short-lived pairing handoff and clears it after TV acknowledgement; Ninety never stores it as account data.
- `src/data/sports/channelMatch.ts` matches a football fixture to the channels in the user's own playlist, using ninety-api's broadcast data first and an EPG-programme-title fallback second.
- Third-party sports metadata (team badges, etc.) still comes from TheSportsDB (`src/data/sports/theSportsDbClient.ts`) alongside ninety-api. Sportmonks was used previously but was dropped entirely (2026-08-17) in favor of ninety-api's own resolver.
- There is no router yet — `App.tsx` uses an in-memory `Screen` union as a temporary screen switcher.

## Requirements

- **Node.js `^22.22.2 || ^24.15.0 || >=26`** (see `engines` in `package.json`, and `.nvmrc`). This is not advisory: `jsdom@30` — which every `@vitest-environment jsdom` test file depends on — refuses to import on anything older, and its `undici@8` dependency calls `worker_threads.markAsUncloneable`, absent before Node 22.10. On Node 20 the jsdom test files die at worker startup rather than failing individually, which reads as a test failure rather than an environment one. `src/core/boot/toolchain.test.ts` keeps CI, `.nvmrc` and `engines` in agreement.

## Local setup

1. Clone and run `ninety-api` locally (see that repo's README) — it typically serves on `http://localhost:3000`.
2. In this repo, copy `.env.example` to `.env` and set:
   ```
   VITE_NINETY_API_URL=http://localhost:3000
   ```
   There is no default or hard-coded fallback — without this set, football fixture requests fail immediately with a visible error rather than silently showing no data.
3. Install dependencies and start the dev server:
   ```
   npm install
   npm run dev
   ```
4. A fresh TV shows an account-activation QR code. After the user signs in and connects the TV on Ninety Web, playlist setup can continue on the phone or use the existing manual Xtream/M3U alternatives on the TV.

## Browser dev vs Tizen build

This app runs two ways:

- **Browser dev** (`npm run dev`) — a regular Vite dev server, keyboard-navigable (arrow keys stand in for the remote). This is the fastest loop for day-to-day work.
- **Tizen build** (`npm run build:tizen`) — produces a build targeting Samsung Tizen TVs, where the app actually ships. Tizen-specific constraints and progress are tracked in [TIZEN-PLAN.md](TIZEN-PLAN.md).

Always verify real feature work with `npm run build:tizen` (or at minimum `npm run build`) in addition to the dev server — `npx tsc --noEmit` is a no-op in this project (root `tsconfig.json` uses project references with `files: []`), so only `tsc -b` / an actual build performs real type-checking.

## Build commands

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server (browser) |
| `npm run build` | Type-checked production build (browser target) |
| `npm run build:tizen` | Production build targeting Samsung Tizen |
| `npm run lint` | Oxlint |
| `npm test` | Test suite |
| `npm run preview` | Preview a built `dist/` locally |

`npm test` is hermetic: it must pass with **no `.env` file present**, exactly as CI runs it. If a test only passes when your local `.env` exists, that test is wrong — read `import.meta.env` lazily inside the function rather than into a module-level const (see `src/data/sports/ninetyApiClient.ts`).

### Diagnostic builds

```
VITE_PERF_DIAGNOSTICS=1 npm run build:tizen
```

Produces a real production build with performance instrumentation (`src/core/perf/devPerf.ts`) **and** the on-screen boot diagnostic overlay (`index.html`) compiled in. This exists because a Partner-tier Samsung TV offers no console, no `sdb shell` and no `dlog` — an on-screen log is the only instrument available on the device.

A **normal** build has neither. A boot failure there shows a branded, dependency-free crash panel with a Restart button and no stack trace; a fatal render crash after startup shows the same panel via `src/core/boot/BootErrorBoundary.tsx`. Never hand a tester a diagnostic build.

## CI

`.github/workflows/ci.yml` runs, in order: `npm ci`, `npm test`, `npm run lint`, `npm run build`, `npm run build:tizen`. A failure at any step skips the rest, so a broken test hides the state of the builds behind it.

The workflow requires a repository variable `VITE_NINETY_API_URL` (Settings → Secrets and variables → Actions → **Variables**) and fails with an explicit message if it is unset. It is read at build time and is not hard-coded in source or in the workflow.

On a push to `main`, the same workflow deploys `dist/` to GitHub Pages. That deploy is the **browser** target and is not the Tizen release; the `.wgt` a tester installs is built and signed separately (see below).

## Releasing

- **Version** — `package.json` and `config.xml` must carry the same numeric `x.y.z` version; `src/core/boot/toolchain.test.ts` enforces it. Tizen rejects a semver pre-release suffix in `config.xml`, so a beta iteration lives in the git tag (`v0.1.0-beta.1`) rather than in the widget version.
- **Backend** — the TV needs a deployed `ninety-api`. Its Railway configuration runs `npm run migrate up` as a pre-deploy command, then starts the API and checks `/health`, so **pending migrations must succeed before the new deployment starts**.
- **Beta configuration** — the only TV build value is `VITE_NINETY_API_URL`, pointing at the deployed HTTPS API origin. Production builds fail when it is missing, HTTP, or contains a path/query/fragment. Cross-service and dashboard requirements are in [BETA_READINESS.md](BETA_READINESS.md).
- **Signing** — `npm run build:tizen` produces an *unsigned* `.wgt`. Signing it for a real TV is `tz pack` with the **Samsung** author + distributor certificates, never `tizen package` (which resolves the same profile name to a generic test distributor cert the TV rejects). The one tested procedure is [docs/TIZEN-DEVICE-TESTING.md](docs/TIZEN-DEVICE-TESTING.md) §2; the release gate around it is [docs/BETA-RELEASE-CHECKLIST.md](docs/BETA-RELEASE-CHECKLIST.md) §D. (TIZEN-PLAN.md's Fase E is the historical journal of how that was set up, not the current instructions.)
- **Distribution** — there is no store channel for this beta. Installing on a tester's TV requires developer mode, our machine's IP registered on that TV, and a package signed against that TV's own DUID; a `.wgt` cannot simply be forwarded to someone. See [docs/BETA-RELEASE-CHECKLIST.md](docs/BETA-RELEASE-CHECKLIST.md) §F.
