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
8. **Distribute** (section F) — choosing the right route:
   - our own hardware validation and the section E/E-S smoke run → **F.1**, Developer Mode sideload;
   - external testers → **F.2**, Samsung Seller Office Beta Test. Start F.2.a (Partner Seller approval for Norway) *early*: it is an administrative dependency with a lead time we do not control, and everything else in F.2 waits on it.

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

### The three packages, which are not interchangeable

`scripts/build-tizen.mjs` produces the **first** of these. The other two are
made from it by signing, and each is for a different audience.

| Package | Contains | Made by | Used for |
|---|---|---|---|
| **Unsigned intermediate** — `dist-tizen/ninety-tv.wgt` | `config.xml` only | `npm run build:tizen` | Nothing on its own. It is the input to signing. Will be **rejected** by both a TV and Seller Office. |
| **Developer-testing package** — `ninety-tv-signed.wgt` | `config.xml`, `author-signature.xml`, `signature1.xml` | `tz pack` with the Samsung VD Author + **VD DEVELOPER** distributor certs | F.1 sideload. The distributor cert is **DUID-bound**: it installs only on TVs whose DUID is in the profile. |
| **Seller Office upload package** | `config.xml`, `author-signature.xml`, `signature1.xml` | `tz pack` with the Samsung VD Author cert + a distributor signature | F.2 upload. Samsung **replaces** the pseudo-distributor signature with the store's own distributor signature during store processing — so the distributor half is provisional, and the **author** half is the identity that must never change or be lost. |

The author certificate is the long-term identity for this App ID: Samsung
requires the author information to match the existing version on every
update. Back it up off this machine. Never commit certificates or passwords.

### Steps

- [ ] Working tree clean, checked out at the tag
- [ ] `npm ci` (not `npm install` — the lockfile is the input)
- [ ] `VITE_NINETY_API_URL=<production URL> npm run build:tizen`
- [ ] **Not** a diagnostic build: confirm `VITE_PERF_DIAGNOSTICS` is unset. Then confirm in the output:
  - [ ] `grep -c "var DIAGNOSTICS = false" .tizen-staging/index.html` → `1`
  - [ ] `grep -c "boot-diag" .tizen-staging/index.html` → `0`
- [ ] No dotfiles in the package: `unzip -l dist-tizen/ninety-tv.wgt | grep '/\.'` → nothing
- [ ] No secret leaked into the bundle: `grep -rl "INTERNAL_API_KEY\|DATABASE_URL" .tizen-staging/` → nothing
- [ ] `config.xml` version matches `package.json` version, and `config.xml` is at the ROOT of the `.wgt`: `unzip -l dist-tizen/ninety-tv.wgt | grep -E ' config\.xml$'` → one entry, no directory prefix
- [ ] **Samsung network privilege present** — required for `webapis.network`, and its absence makes those calls throw rather than fail softly:

      unzip -p dist-tizen/ninety-tv.wgt config.xml | grep -c 'developer.samsung.com/privilege/network.public'

  → `1`
- [ ] **Platform floor is what we mean to ship**: `unzip -p dist-tizen/ninety-tv.wgt config.xml | grep required_version` → `6.5`
- [ ] **No module Workers reached the artifact** — a `{type:"module"}` Worker throws at construction on Chromium < 80 and silently disables channel-identity resolution:

      grep -o 'new Worker([^)]*)' dist/assets/*.js

  → every match is a bare `new Worker(new URL(...))`, none has a `type` option. `src/core/platform/workerCompatibility.test.ts` guards the source and toolchain; this checks the artifact.
- [ ] **Worker chunks are classic scripts**: `head -c 30 dist/assets/*Worker-*.js` → each starts `(function(){`, and `grep -cE '(^|[};,)[:space:]])(import|export)[ ({*]' dist/assets/*Worker-*.js` → `0`
- [ ] **No AVPlay implementation** (deliberately out of scope — see `MULTI-AUDIO-NOTES.md`): `grep -rl "AVPlay\|avplay" dist/assets/` → nothing
- [ ] **The removed FilterPopup has not returned**: `find src -name 'FilterPopup*'` → nothing, and `grep -rn '<FilterPopup' src/` → nothing. (The *name* still appears in three comments explaining why it was removed, and `categoryFavoriteKey` in `features/channels/favorites.ts` is the composite key for **hidden categories** in Settings — not the removed category-favourites feature. Grep for the component, not the word.)
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

### E-S. Samsung quality-requirement compliance — ALL REQUIRE HARDWARE VERIFICATION

Every row below is **mandatory for Seller Office** and **none of it can be
signed off from an automated test**. jsdom has no remote, no Samsung Product
API, no screensaver and no real network interface: the unit tests prove the
logic, the TV proves the requirement. All of these are currently
**UNVERIFIED ON HARDWARE**.

| # | Check | Samsung requirement | Automated coverage that is *not* a substitute |
|---|---|---|---|
| S1 | On Home (the app root), press Return → the "Exit Ninety?" popup appears, focused on **Cancel** | Root Return shows an app-owned exit popup | `ExitConfirmDialog.test.tsx` |
| S2 | Cancel → popup closes, app stays open, highlight returns to where it was | Only "Yes" may exit | `ExitConfirmDialog.test.tsx` |
| S3 | Return **while the popup is open** → popup closes, app stays open | Return cancels the confirmation | `ExitConfirmDialog.test.tsx` |
| S4 | Exit → app quits, once, cleanly | Only the affirmative option calls `exit()` | `ExitConfirmDialog.test.tsx` |
| S5 | On a detail page (Match View, Settings, a Channels sub-level), Return goes **back one page** and never raises the exit popup | Detail Return → previous page | `backHandler.test.ts` |
| S6 | **Long-press** Return behaves as Samsung's platform defines it — the app must not intercept or alter it | Do not interfere with forced long-press Return/Exit | none — the app deliberately registers nothing for it |
| S7 | Disconnect the network while on Home → the offline notice appears within a few seconds; arrows/OK/Return still work; no indefinite spinner | Visible disconnect notice; app must not freeze | `networkStatus.test.ts` |
| S8 | Disconnect the network **during playback** → the app stays responsive and Return still leaves the player | App must not freeze when disconnected | — |
| S9 | Reconnect → the notice disappears on its own and the current screen becomes usable **without relaunching** | Reconnection recovers into a usable app | `networkStatus.test.ts` |
| S10 | Disconnect **while the app is hidden**, then return to it → the notice is showing (the state was re-read on resume, not missed) | Network can change while hidden | `useAppLifecycle.test.tsx` |
| S11 | During playback, press Home to background the app → playback stops; returning to the app lands on the originating screen, not a black player | Hidden during playback = same behaviour as Return | `useAppLifecycle.test.tsx` |
| S12 | Same as S11 from **Multiview** — all panes stop, the preceding screen is restored | Same, for every player session | `usePlayerSession.screenSaver.test.tsx` |
| S13 | Background and resume from **Home** → no reload, playlists/preferences/navigation intact, a focusable element is highlighted | Resume must not reload or lose state | `useAppLifecycle.test.tsx` |
| S14 | Play a stream and **leave the remote untouched past the TV's screensaver timeout** (set it to its shortest value first) → the screensaver must NOT activate | Screensaver disabled while playing | `screenSaver.test.ts` |
| S15 | Stop/pause playback and wait again → the screensaver **does** activate | Screensaver re-enabled when playback stops | `screenSaver.test.ts` |
| S16 | Multiview: close one pane while others still play, wait past the timeout → the screensaver must still NOT activate | One release must not undo the others | `screenSaver.test.ts` |
| S17 | Exit the app entirely, wait past the timeout on the TV's own menu → the screensaver activates (the app restored the system setting) | Teardown returns SCREEN_SAVER_ON | `useAppLifecycle.test.tsx` |
| S18 | Cold launch from a fully powered-down TV: reaches a usable screen, no blank screen, no error | — | — |
| S19 | Record the **launch time** from OK-on-icon to first interactive paint | — | — |
| S20 | Confirm `webapis.network` is actually available — if it is not, the app silently uses the `navigator.onLine` fallback and S7–S10 are testing the weaker path. Check the privilege was accepted at install time. | Product Network API + `network.public` privilege | `networkStatus.test.ts` covers both paths |
| S21 | Multi-audio (HLS): a stream with Norwegian/Swedish/Danish commentary offers the Audio control and switching actually changes the language, with no reload and no seek | — | `ChannelPlayerScreen.audioTracks.test.tsx` |
| S22 | Confirm the TV's real Chromium version (`navigator.userAgent`) and record it against its Tizen version — see the model-year note in [`TIZEN-HARDWARE-QUALIFICATION.md`](TIZEN-HARDWARE-QUALIFICATION.md) | — | — |

**Not covered by automated tests and only verifiable here:** E1, E6, E7, E8, E11, E14, E15, E16, all of E12/E13's real-network behaviour, and **every S row**. (E17 and E18 have jsdom coverage — `SettingsScreen.test.tsx`'s focus-continuity suite waits past norigin's 300 ms auto-restore, and `useHomeFeed.test.ts` pins the no-refetch mode change — but neither has been seen on a remote.) Everything above is hardware-verified only when a human has run it on the signed artifact.

---

## F. Distribution

There are **two entirely separate things** called "testing this build", and
conflating them is what the previous version of this document did. They use
different packages, different signatures, different audiences, and one of
them is the official route to an external beta.

| | Developer/device validation | Official external closed beta |
|---|---|---|
| Purpose | Our own hardware testing, qualification, pre-submission smoke | Real external testers on their own TVs |
| Route | Developer Mode + LAN sideload | **Samsung Seller Office → Beta Test** |
| Package | DUID-bound developer-signed `.wgt` | Seller Office upload package |
| Who installs | Us, on a TV we can reach | The tester, from Samsung's beta channel |
| Reach | TVs on our LAN, per-DUID | Any tester with an activation code, in a service country |
| Instructions | [`TIZEN-DEVICE-TESTING.md`](TIZEN-DEVICE-TESTING.md) | F.2 below |

### F.1 Developer/device validation — KEEP USING THIS

The Developer Mode / DUID-bound sideload workflow is **not obsolete and is
not replaced**. It is how sections C–E of this document actually get run,
and it is the only way to put a build on a TV in minutes rather than days.
It stays the tool for:

- our own physical-TV testing during development,
- the full device-qualification sheet
  ([`TIZEN-HARDWARE-QUALIFICATION.md`](TIZEN-HARDWARE-QUALIFICATION.md)),
- the section E + E-S smoke run **before** anything is uploaded to Seller
  Office.

The complete, already-proven procedure stays in
[`TIZEN-DEVICE-TESTING.md`](TIZEN-DEVICE-TESTING.md). Nothing in it was
removed.

Its limits, stated plainly so they are not rediscovered:

1. The tester's TV must be in Developer Mode with **our** machine's IP on
   it, on the same LAN.
2. The `.wgt` must be signed with a distributor certificate **bound to that
   TV's DUID**. Adding a tester means: collect their DUID, add it to the
   certificate profile, **re-sign**, re-run section D on the new artifact.
3. "Just send the tester the `.wgt`" does not work. There is no sideload
   path on a retail Samsung TV without all of the above.

So F.1 does not scale past people whose TVs we can physically reach. That
is exactly why F.2 exists.

### F.2 Official external closed beta — Samsung Seller Office Beta Test

**This is the canonical external-beta path for Ninety.** An earlier revision
of this document said "there is no Samsung-hosted distribution channel for
this build". That is wrong for the beta we intend to run, and it has been
removed.

#### F.2.a Account and seller type — DO THIS FIRST, IT HAS THE LONGEST LEAD TIME

- [ ] A **TV Seller Office** account exists (`seller.samsungapps.com/tv`)
- [ ] **Norway requires Partner Seller status.** A *Public Seller* can use
      most of Seller Office but can launch TV application services **only in
      the United States**. Launching anywhere else — including Norway,
      Sweden and Denmark, i.e. Ninety's entire actual market — requires
      **Partner Seller** membership, granted through an approval process
      with a **Samsung Content Manager** via a partnership request in Seller
      Office.
- [ ] Partner Seller approval **granted** (not merely requested) — this
      gates everything downstream and is an administrative dependency we do
      not control the timing of
- [ ] Service countries configured (Applications → Service Country/Region)
      to include NO/SE/DK. **Beta testing is only available in the
      application's service country**: on a TV in a country that is not
      selected, the app does not appear and the tester cannot install it,
      activation code or not.

#### F.2.b The package

- [ ] Built and signed per section D, from a tagged commit
- [ ] The `.wgt` contains **`config.xml`, `author-signature.xml` and
      `signature1.xml`** — verify, do not assume:

      unzip -l dist-tizen/ninety-tv-signed.wgt | grep -E 'config\.xml|author-signature\.xml|signature1\.xml'

      Three entries, all at the package root. An unsigned intermediate
      `.wgt` has only `config.xml` and will be rejected.
- [ ] **The author certificate is backed up, off this machine, and its
      password is recorded somewhere that is not this repository.**
      When updating a published application Samsung requires that *the
      author information must be the same as the existing version*. Losing
      the author certificate means never being able to ship an update to
      this App ID again — a new certificate is a new identity, and the only
      remedy is a new App ID and a new listing. This is the single
      unrecoverable failure in the whole process.
- [ ] Certificates and passwords are **not** in Git (they are not, and must
      not become so)
- [ ] Version numbering planned — see F.2.e

#### F.2.c Submitting the beta

- [ ] Application registered in Seller Office (title, description, icons,
      screenshots, category, age rating)
- [ ] Upload the signed `.wgt`
- [ ] **Pre-test** runs automatically against the application information
      and the selected model group — clear it before requesting anything
- [ ] Select **model groups**. Ninety declares `required_version="6.5"`, so
      the target is **2022 and newer**; 2021 is deliberately out of scope
      for Beta 1 (see [`TIZEN-HARDWARE-QUALIFICATION.md`](TIZEN-HARDWARE-QUALIFICATION.md)).
      Note that model groups **can be added** during a running beta but an
      active one **cannot be deleted** — so start narrow.
- [ ] Create the **Beta Test**: model groups, tester count, test duration
- [ ] **Samsung Content Manager approval** obtained

#### F.2.d Activation codes and what the tester does

- [ ] Activation codes issued **after approval**, downloaded as CSV
- [ ] Each code is **single-use**; up to 100,000 additional codes can be
      requested if needed
- [ ] Tester instructions written and sent:
      1. On the TV, open **Settings** and enter the hidden key **`134678`**
         on the remote. An activation-code input window appears.
      2. Enter the one-time activation code we sent.
      3. Review the precautions, then **Install** Ninety from Samsung's beta
         channel.
- [ ] Testers told to **update their TV firmware first** — if the firmware
      is too old the beta-enable screen may not work at all
- [ ] Testers told, explicitly, that **this Samsung activation code has
      nothing to do with Ninety's own QR playlist-pairing flow.** They are
      two unrelated one-time codes at two different moments: the Samsung
      code installs the app; Ninety's QR pairing then connects their
      playlist inside the app. Confusing the two is the most predictable
      support question this beta will generate.

#### F.2.e Version rules — verified against Samsung's documentation, not assumed

- Version format is `[0-255].[0-255].[0-65535]` (a fourth digit up to
  `[0-99999]` for multi-architecture packages).
- **Before** beta approval, the version can be changed freely.
- **After** approval, only an **upgrade to a higher version** is accepted.
  Downgrades are rejected. Plan the numbering before submitting.
- **A version submitted for a beta or alpha test cannot later be submitted
  as the release version.** Samsung's documentation states this outright
  ("We plan on supporting so that it can be possible later"), so budget at
  least one version number to be permanently burned by the beta and keep the
  release version above it.
- If the major version ever reaches **255**, no higher version can be
  registered at all and a **new App ID** is required. Not a near-term risk
  at `0.1.0`, but it is why the major must not be used as a build counter.
- Model-group-specific beta packages/versions are possible — different
  binaries can be targeted at different model groups within one beta.

#### F.2.f What Samsung does NOT do for a beta

**Samsung does not run its normal release verification suite on a beta
build.** Content Manager approval is an administrative gate, not a QA pass.

Nothing about the beta route therefore reduces our own obligation: section
E, section E-S and the full qualification sheet remain **mandatory and ours
to run**, on real hardware, before any code reaches a tester. A beta that
Samsung approved is not a beta Samsung tested.

### F.3 Checklist common to both routes

- [ ] Testers know how to report: TV model, firmware, what they did, what happened
- [ ] Testers know which provider/playlist types are supported (Xtream panel, M3U URL, M3U file, QR pairing)
- [ ] Known limitations for this beta are written down and shared — including the supported-model floor (**2022 and newer**)
- [ ] For F.1 only: every tester TV's DUID is registered, and each artifact was signed AFTER that DUID was added, with section D re-run per artifact
- [ ] Someone other than the author has followed [`TIZEN-DEVICE-TESTING.md`](TIZEN-DEVICE-TESTING.md) end to end on a TV that was not already set up

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
