# Testing Ninety on a physical Samsung Tizen TV

Quick reference for building, signing, installing, and launching this app on
a real Samsung TV — not an emulator, not the VS Code Tizen extension's own
flow. There are no devtools/console reachable on this hardware, so this is
also the only reliable way to see whether a build even boots.

> **This is the DEVELOPER/DEVICE-VALIDATION route, and it remains the right
> tool for our own testing.** It is how the hardware qualification sheet and
> the pre-submission smoke run actually get executed, and nothing here has
> been superseded.
>
> It is **not** how external testers get the app. That is the Samsung Seller
> Office Beta Test route — see
> [`BETA-RELEASE-CHECKLIST.md`](BETA-RELEASE-CHECKLIST.md) §F.2. The two use
> different packages and different signatures; §F.1 of that document
> explains why this route cannot scale past TVs we can reach on a LAN
> (Developer Mode, our IP on the TV, and a DUID-bound distributor
> signature).

## 1. One-time setup

### Install Tizen Studio (Web CLI)

Download the standalone **Web CLI** installer from
[developer.samsung.com](https://developer.samsung.com/smarttv/develop/tools/tizen-studio/download.html)
(`web-cli_Tizen_SDK_<version>_<os>.bin`), then run it unattended:

```sh
arch -x86_64 ~/Downloads/web-cli_Tizen_SDK_10.0_usa_macos-64.bin \
  --accept-license --no-java-check ~/tizen-studio
```

`arch -x86_64` matters on Apple Silicon — the installer's bundled `unzip`
has an arm64e slice the kernel refuses to run natively; the x86_64 slice
under Rosetta works fine. This gives you `tizen`/`sdb` under
`~/tizen-studio/tools/`.

### Put the TV in Developer Mode

On the TV: **Apps → (long-press/Enter on any app icon repeatedly, or via
the Apps screen menu) → Developer mode → On**, enter your dev machine's IP
address when prompted, then restart the TV's Smart Hub when asked. This
opens the debug port (default **26101**) and lets `sdb`/`tizen` talk to it
over your LAN.

Find the TV's own IP + Device Unique ID (DUID) while you're in there:
**Settings → Support → Contact Samsung / About This TV → (Device) Unique ID**.

### Get a signing certificate

The `.wgt` package must be signed before `tizen install` will accept it.
Easiest path is the VS Code Tizen extension's **Certificate Manager** →
**Create Certificate → "Create Samsung Certificate"** (not the plain
"Create Tizen Certificate" — that one is a generic, non-device-bound
distributor cert and installs fine but isn't the one you want by default).
You'll need a Samsung account and the TV's DUID from above. This produces
an author + distributor cert pair and registers a named security profile
(this repo uses the profile name `ninety-tv`) that the signing step below
references.

## 2. Every time: build → sign → install → run

```sh
# 1. Build the widget package (unsigned)
npm run build:tizen
# → dist-tizen/ninety-tv.wgt

# 2. Sign it (repack with the Samsung author + distributor certs)
#    THIS command, not `tizen package` — see the certificate gotcha below.
~/.tizen-extension-platform/server/sdktools/data/tools/tizen-core/tz \
  pack -b dist-tizen/ninety-tv.wgt -t wgt -s ninety-tv \
  -o dist-tizen/ninety-tv-signed.wgt

# 3. Connect to the TV (skip if `sdb devices` already lists it)
~/tizen-studio/tools/sdb connect <TV_IP>:26101

# 4. Install
~/tizen-studio/tools/ide/bin/tizen install \
  -n dist-tizen/ninety-tv-signed.wgt -s <TV_IP>:26101

# 5. Launch (app id is fixed — see config.xml)
~/tizen-studio/tools/ide/bin/tizen run \
  -p NinetyTvAp.NinetyTV -s <TV_IP>:26101
```

Once installed, the app also just sits in the TV's app list like any other
— step 5 is only needed to jump straight to it after a fresh install.

### Reconnecting

`sdb`'s LAN connection to the TV drops on its own sometimes (TV sleep,
Wi-Fi hiccups, `sdb` server restarts). If `tizen install` fails with
*"Can not transfer package"* or *"There is no connected target"*:

```sh
~/tizen-studio/tools/sdb devices          # empty list = disconnected
~/tizen-studio/tools/sdb connect <TV_IP>:26101
```

then retry the install. One retry after a fresh `sdb connect` is usually
enough.

## 3. Gotchas specific to this TV setup

- **Two `ninety-tv` profiles exist, and they hold different certificates.**
  `tz` reads `~/.tizen-extension-platform/server/sdktools/sdk-data/profile/`
  and signs with `~/SamsungCertificate/ninety-tv/` — a *Samsung VD Author*
  cert plus a *VD DEVELOPER Public CA* distributor cert, which is the
  DUID-bound pair a retail TV requires. `tizen package -s ninety-tv` reads
  `~/tizen-studio-data/profile/` and signs with the generic **Tizen Public
  Distributor Test** signer, which the TV rejects. Both commands succeed and
  produce a `.wgt`; only one of them installs. Read the certificate paths the
  command prints — that is the only reliable check. (`scripts/build-tizen.mjs`
  prints the `tz pack` line for this reason.)
- **Use the classic `tizen install`/`tizen run` — never `sdb install` or
  `tz install`/`tz run`.** Non-Partner-tier Samsung dev accounts have
  `sdb shell` hard-blocked (an intentional Samsung restriction, confirmed
  via their own FAQ) — it returns instantly with zero output, no error,
  which looks like a hang but isn't. Both `sdb install` and the newer `tz`
  toolchain's `install`/`run` route through that same blocked shell channel
  internally, so the file transfer silently succeeds but the app never
  actually gets registered/launched. The classic Eclipse-era `tizen` CLI
  uses a separate, non-shell install service and just works.
- **Don't run `tz install-chain`/`tz run` from inside the project directory
  without an explicit built package (`-w`).** With no `.project` file, it
  silently auto-generates `tizen_web_project.yaml` and naively zips the
  *entire* working directory — `.env`, `.git/`, `node_modules`, everything.
  If you see a stray `tizen_web_project.yaml` or `Debug/` folder appear at
  the repo root, delete it — don't let that build reach the TV.
- **No devtools on-device — use a diagnostic BUILD, never ad-hoc
  instrumentation.** If a build installs but shows a blank/blue screen with
  no other symptom, that's a boot-time JS error you cannot see any other
  way. The overlay that shows it is a permanent, supported build mode now
  (it stopped being a temporary hack in the pre-beta pass), so rebuild with
  the flag rather than editing `index.html`:

  ```sh
  VITE_PERF_DIAGNOSTICS=1 npm run build:tizen
  ```

  That switches on both the on-screen boot log (`index.html`'s
  `@diagnostics-only` block) and the perf instrumentation
  (`src/core/perf/devPerf.ts`) — one flag, because there is one way to ask
  for on-device diagnostics. A **normal** build has neither: `vite.config.ts`
  strips the overlay block out of `index.html` entirely rather than leaving
  it behind a false flag, and a boot failure shows a branded crash panel
  with a Restart button instead. Confirm which one you are holding with
  `grep -c "boot-diag" .tizen-staging/index.html` — `1` is a diagnostic
  build, `0` is a release build. **Never hand a tester a diagnostic build.**
- **`registerTizenRemoteKeys()`** (`src/core/platform/keys.ts`) needs the
  `http://tizen.org/privilege/tvinputdevice` privilege in `config.xml` —
  without it, Back/media remote keys silently don't register (arrow/Enter
  navigation is unaffected either way; that's plain DOM/norigin, not this
  API).
