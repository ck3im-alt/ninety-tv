# ninety-tv

TV-focused frontend for NINETY — a smart TV app for browsing an IPTV playlist (Xtream or M3U) and following football fixtures, with channel-level "watch this match here" resolution. Built with React + TypeScript + Vite, using spatial navigation (`@noriginmedia/norigin-spatial-navigation`) for remote-control input, and targeting both regular browsers and Samsung Tizen TVs.

## Architecture

- **This repo (`ninety-tv`)** is the UI only. It has no server-side logic and holds no sports/broadcast data of its own.
- **[`ninety-api`](../ninety-api)** is a separate backend repo/service that resolves football fixtures, team/league metadata, and real linear TV broadcast channels via its own EPG resolver. `ninety-tv` depends on it for all football data — there is no bundled or fallback data source.
- The user's own IPTV playlist (Xtream or plain M3U) is connected client-side and stored locally (`src/data/session.ts`, `src/data/xtream/`); it is never uploaded anywhere.
- `src/data/sports/channelMatch.ts` matches a football fixture to the channels in the user's own playlist, using ninety-api's broadcast data first and an EPG-programme-title fallback second.
- Third-party sports metadata (team badges, etc.) still comes from TheSportsDB (`src/data/sports/theSportsDbClient.ts`) alongside ninety-api. Sportmonks was used previously but was dropped entirely (2026-08-17) in favor of ninety-api's own resolver.
- There is no router yet — `App.tsx` uses an in-memory `Screen` union as a temporary screen switcher.

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
4. On first launch you'll be prompted to connect an IPTV playlist (Xtream credentials or an M3U URL) to browse channels.

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

## Deploy

GitHub Pages deploy (`.github/workflows/deploy.yml`) reads `VITE_NINETY_API_URL` from the repository variable of the same name (Settings → Secrets and variables → Actions → Variables) at build time — it is not hard-coded anywhere in source or in the workflow file.
