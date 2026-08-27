# NINETY — First Closed Beta Release Checklist

**Purpose:** the exact sequence for cutting the first externally-testable NINETY build, and the minimum verification that must happen on the real signed artifact before it is shared.

**This is not the full device-qualification sheet.** [`TIZEN-HARDWARE-QUALIFICATION.md`](TIZEN-HARDWARE-QUALIFICATION.md) stays what it is: the broad compatibility matrix, run per TV model/firmware. What follows is the *minimum smoke subset* for one build on one TV.

**Nothing here may be ticked from a test you did not execute.** A jsdom test is not hardware verification; a migration you did not watch run is not a verified migration.

---

## A. What the beta pair is

One question this document must always answer:

> Which `ninety-api` revision and database schema is the first beta TV build expected to run against?

| | Value |
|---|---|
| TV commit | _fill in at tag time_ |
| TV version | `0.1.0` (`package.json` + `config.xml`) |
| Git tag | `v0.1.0-beta.1` |
| API commit | _fill in at tag time_ |
| Required schema | through `1755001500000_broadcast-availability` (16 migrations) |
| API URL | value of the `VITE_NINETY_API_URL` repo variable / build env |

### Compatibility rule

The TV tolerates an **older** API: every field added by the 2026-08-26 personalization and broadcast-availability work is declared optional, and **absent means UNKNOWN, never "no"**. That tolerance is a development convenience, not the beta contract — ship a known pair.

The TV does **not** tolerate a *missing* `VITE_NINETY_API_URL`. There is no default and no fallback.

---

## B. Release sequence

Order matters. The API must be able to serve the payload the TV build expects before that TV build reaches anyone.

1. **Merge the CI fix to `main`.** `main`'s CI pins Node 20 and cannot run the jsdom suite. Until the Node 24 pin is on `main`, `main` is red and every build behind it is unvalidated.
2. **Green CI on `main`** — `npm ci`, `npm test`, `npm run lint`, `npm run build`, `npm run build:tizen`, all passing.
3. **Deploy `ninety-api`.** Railway's start command is `npm run migrate up && npm start`, so **pending migrations are applied automatically, before the server starts**. There is no separate manual migration step.
   - Both currently-pending migrations are purely additive (`ADD COLUMN` with defaults, `CREATE TABLE`, `CREATE INDEX`, `CREATE VIEW`) — no `DROP`, no `RENAME`, no type change. The previous API revision runs against the new schema unchanged, so the rollover is safe in both directions.
4. **Seed broadcast policies** if not already present — `npm run seed:broadcast-policies`. This is a manual step; it is not part of the deploy.
5. **Verify the deployed API** (section C).
6. **Tag the TV commit** `v0.1.0-beta.1`.
7. **Build and sign the `.wgt` from exactly that tag** (section D).
8. **Smoke the signed artifact on real hardware** (section E).
9. **Distribute** with installation instructions (section F).

---

## C. Backend verification (against the deployed API, not localhost)

- [ ] `GET /health` → `200 {"ok":true}`
- [ ] `GET /v1/competitions` → the competition catalogue, non-empty
- [ ] `GET /v1/events` → events with a `pagination` object
- [ ] `GET /v1/teams?q=ars` → **filtered** results. Sending `search=` instead returns 200 and *every* team; the parameter is `q`.
- [ ] `POST /api/pairing` → `201` with `pollSecret` / `activationUrl` / `expiresAt`
- [ ] `GET /internal/live-scores` → `401` with no auth, `200` with `Authorization: Bearer $INTERNAL_API_KEY`
- [ ] `INTERNAL_API_KEY` is set in the deployed environment (unset ⇒ every `/internal/*` route fails closed with 503)
- [ ] `CORS_ORIGINS` is set — with `NODE_ENV=production` and no value, all cross-origin browser requests are rejected
- [ ] `INTERNAL_API_KEY` is **not** present in any TV build output (it is a server secret and must never reach the client)
- [ ] No migration left pending: the deploy log shows `Migrations complete!`

---

## D. Build the artifact

- [ ] Working tree clean, checked out at the tag
- [ ] `npm ci` (not `npm install` — the lockfile is the input)
- [ ] `VITE_NINETY_API_URL=<production URL> npm run build:tizen`
- [ ] **Not** a diagnostic build: confirm `VITE_PERF_DIAGNOSTICS` is unset. Then confirm in the output:
  - [ ] `grep -c "var DIAGNOSTICS = false" .tizen-staging/index.html` → `1`
  - [ ] `grep -c "boot-diag" .tizen-staging/index.html` → `0`
- [ ] No dotfiles in the package: `unzip -l dist-tizen/ninety-tv.wgt | grep '/\.'` → nothing
- [ ] No secret leaked into the bundle: `grep -rl "INTERNAL_API_KEY\|DATABASE_URL" .tizen-staging/` → nothing
- [ ] `config.xml` version matches `package.json` version
- [ ] Sign with the author + distributor certificates:
      `tizen package -t wgt -s <profile> -- .tizen-staging`
- [ ] Record the signed artifact's SHA256 — **everything below must be tested on this exact file**

---

## E. Minimum on-hardware smoke subset

Run on a physical Samsung TV, against the signed `.wgt` from section D. This is the gate for sharing the build; it is not a substitute for the full qualification sheet.

| # | Check | Maps to |
|---|---|---|
| E1 | Signed `.wgt` installs without certificate/profile errors | HQ 1.1 |
| E2 | Fresh install: boots to onboarding, no blank screen, no debug overlay | HQ 1.2 |
| E3 | Complete onboarding with a real provider (country → sports → teams → playlist) | — |
| E4 | Home shows real fixtures and real data | — |
| E5 | Event Details opens; stream selection lists channels | — |
| E6 | Playback works — **MPEG-TS** | HQ 3.x |
| E7 | Playback works — **HLS**, where the provider offers it | HQ 3.x |
| E8 | Automatic and manual source switching both work | HQ 2.6 |
| E9 | Remote: arrows, OK, and Back all behave; Back never traps the app | HQ 2.1–2.4 |
| E10 | Cold relaunch with cached playlist goes straight to Home, no re-onboarding | HQ 1.3 |
| E11 | Existing-install upgrade: install over a previous version, playlists/preferences/favourites all survive | HQ 1.3 |
| E12 | Network failure produces a usable UI — pull the network, open Home: an honest message and a reachable Back, never an indefinite spinner | — |
| E13 | Unreachable API produces a usable UI — point at a dead API URL, confirm the screen resolves within ~12s rather than hanging | — |
| E14 | **No development artifact anywhere**: no boot overlay, no stack trace, no `[perf]` output visible | — |
| E15 | QR pairing: scan, submit an M3U URL, TV connects exactly once (no duplicate import) | — |

**Not covered by automated tests and only verifiable here:** E1, E6, E7, E8, E11, E14, E15, and all of E12/E13's real-network behaviour. Everything above is hardware-verified only when a human has run it on the signed artifact.

---

## F. Distribution

- [ ] Tester installation instructions exist and have been followed by someone other than their author
- [ ] Testers know how to report: TV model, firmware, what they did, what happened
- [ ] Testers know which provider/playlist types are supported (Xtream panel, M3U URL, M3U file, QR pairing)
- [ ] Known limitations for this beta are written down and shared

---

## G. Sign-off

| Field | Value |
|---|---|
| TV commit / tag | |
| API commit | |
| Signed `.wgt` SHA256 | |
| TV model + firmware | |
| Smoke run by | |
| Date | |
| Result | |
