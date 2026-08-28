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
| API commit | `2bddc878` — `chore: prepare v0.1.0 beta release` (`ninety-api` `main`, deployed) |
| Required schema | through `1755001500000_broadcast-availability` (16 migrations) |
| API URL | value of the `VITE_NINETY_API_URL` repo variable / build env |

The 2026-08-28 integration pass added **no API surface of its own**: Home
content modes, the density-aware forward expansion, the competition Home
hero artwork, the onboarting-flow changes and the playlist-connect fallback
are all client-side, and the forward expansion reuses `GET /v1/events`'s
existing `competition_id` / `from` / `to` / `country` parameters. No
migration and no `ninety-api` change is required beyond the commit above.

### Compatibility rule

The TV tolerates an **older** API: every field added by the 2026-08-26 personalization and broadcast-availability work is declared optional, and **absent means UNKNOWN, never "no"**. That tolerance is a development convenience, not the beta contract — ship a known pair.

The TV does **not** tolerate a *missing* `VITE_NINETY_API_URL`. There is no default and no fallback.

---

## B. Release sequence

Order matters. The API must be able to serve the payload the TV build expects before that TV build reaches anyone.

1. **Green CI on `main`** — `npm ci`, `npm test`, `npm run lint`, `npm run build`, `npm run build:tizen`, all passing. The Node 24 pin this used to wait on landed in `cc6c17f` and has been on `main` since the beta-prep merge; `src/core/boot/toolchain.test.ts` keeps `.github/workflows/ci.yml`, `.nvmrc` and `engines` in agreement, so a drift back to an unusable Node is a test failure rather than a red CI mystery. The workflow still needs the repository **variable** `VITE_NINETY_API_URL` set (Settings → Secrets and variables → Actions → Variables) — an unset variable, not the Node version, was the real cause of the last red run.
2. **Deploy `ninety-api`.** Railway's start command is `npm run migrate up && npm start`, so **pending migrations are applied automatically, before the server starts**. There is no separate manual migration step.
   - Both currently-pending migrations are purely additive (`ADD COLUMN` with defaults, `CREATE TABLE`, `CREATE INDEX`, `CREATE VIEW`) — no `DROP`, no `RENAME`, no type change. The previous API revision runs against the new schema unchanged, so the rollover is safe in both directions.
3. **Seed broadcast policies** if not already present — `npm run seed:broadcast-policies`. This is a manual step; it is not part of the deploy.
4. **Verify the deployed API** (section C).
5. **Tag the TV commit** `v0.1.0-beta.1`.
6. **Build and sign the `.wgt` from exactly that tag** (section D).
7. **Smoke the signed artifact on real hardware** (section E).
8. **Distribute** with installation instructions (section F).

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
- [ ] `config.xml` version matches `package.json` version, and `config.xml` is at the ROOT of the `.wgt`: `unzip -l dist-tizen/ninety-tv.wgt | grep -E ' config\.xml$'` → one entry, no directory prefix
- [ ] Sign with the **Samsung** author + distributor certificates — one command, and it is `tz pack`:

      ~/.tizen-extension-platform/server/sdktools/data/tools/tizen-core/tz \
        pack -b dist-tizen/ninety-tv.wgt -t wgt -s ninety-tv \
        -o dist-tizen/ninety-tv-signed.wgt

  **Not `tizen package`.** Both CLIs accept a profile called `ninety-tv`, but they read different profile stores and pick different certificates. `tz` uses `~/SamsungCertificate/ninety-tv/` — a *Samsung VD Author* cert plus a *VD DEVELOPER Public CA* distributor cert, which is the device-bound pair a retail Samsung TV in developer mode requires. `tizen package` uses `~/tizen-studio-data/` and signs with the generic **Tizen Public Distributor Test** signer, which a real TV rejects. Verify from the command's own output: it must name `SamsungCertificate/ninety-tv/author.p12` and `.../distributor.p12`.
- [ ] Record the signed artifact's SHA256 — **everything below must be tested on this exact file**

---

## E. Minimum on-hardware smoke subset

Run on a physical Samsung TV, against the signed `.wgt` from section D. This is the gate for sharing the build; it is not a substitute for the full qualification sheet.

| # | Check | Maps to |
|---|---|---|
| E1 | Signed `.wgt` installs without certificate/profile errors | HQ 1.1 |
| E2 | Fresh install: boots to onboarding, no blank screen, no debug overlay | HQ 1.2 |
| E3 | Complete all **five** onboarding steps with a real provider, in order: playlist → sports & leagues → teams → Home personalisation → countries. Nothing is persisted until Finish, so also step Back and forward once and confirm the choices survive | — |
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
| E16 | A `get.php` URL whose panel has no usable `player_api.php` still connects, as a plain M3U, and RESYNCS from Settings afterwards without repeating the fallback | — |
| E17 | Settings: add/remove a country, remove a followed-league chip, remove a playlist — after each, the highlight is on a visible control **in the same section**, never back on Playlists | — |
| E18 | Home personalisation: switch the mode in Settings, return to Home — the feed re-shapes immediately, with no spinner and no reload | — |

**Not covered by automated tests and only verifiable here:** E1, E6, E7, E8, E11, E14, E15, E16, and all of E12/E13's real-network behaviour. (E17 and E18 have jsdom coverage — `SettingsScreen.test.tsx`'s focus-continuity suite waits past norigin's 300 ms auto-restore, and `useHomeFeed.test.ts` pins the no-refetch mode change — but neither has been seen on a remote.) Everything above is hardware-verified only when a human has run it on the signed artifact.

---

## F. Distribution

### How this beta is actually distributed — read before promising anyone anything

There is **no Samsung-hosted distribution channel for this build.** NINETY is
not on the Samsung TV App Store, and this beta is not going through Samsung
Seller Office. That is not an oversight to be worked around; it is what the
build is.

What that leaves is **developer-mode sideloading, performed by us, per TV**:

1. The tester's TV must be put into Developer Mode with **our** machine's IP
   entered on it, and must be on the same LAN as that machine.
2. The `.wgt` must be signed with a Samsung distributor certificate that is
   **bound to that TV's DUID**. A package signed for one TV will not install
   on another. Adding a tester therefore means: collect their DUID, add it to
   the Samsung certificate profile, **re-sign**, and re-run section D's
   checks on the new artifact.
3. Installation is `tizen install` over the LAN
   ([`TIZEN-DEVICE-TESTING.md`](TIZEN-DEVICE-TESTING.md) section 2).

**"Just send the tester the .wgt" does not work.** They have no way to
install it: there is no sideload path on a retail Samsung TV without
developer mode, our IP registered on their TV, and a DUID-matched signature.

So the practical shape of this closed beta is **local, hands-on, and small** —
testers whose TVs we can reach on a LAN. Anything wider needs Samsung Seller
Office, which is a different piece of work and not part of this release.

### Checklist

- [ ] Every tester TV's DUID is registered in the Samsung certificate profile, and the artifact each tester receives was signed AFTER their DUID was added
- [ ] Section D's checks were re-run on each per-tester signed artifact, not only on the first one
- [ ] Someone other than the author has followed [`TIZEN-DEVICE-TESTING.md`](TIZEN-DEVICE-TESTING.md) end to end on a TV that was not already set up
- [ ] Testers know how to report: TV model, firmware, what they did, what happened
- [ ] Testers know which provider/playlist types are supported (Xtream panel, M3U URL, M3U file, QR pairing)
- [ ] Known limitations for this beta are written down and shared, including **this distribution limitation** — the build cannot be passed on to a third party by the tester

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
