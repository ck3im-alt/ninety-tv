# NINETY — Samsung Tizen Hardware Qualification Checklist

**Purpose:** Verify the current HTML5 `<video>` + MSE player (`src/core/player/htmlVideoPlayer.ts`, hls.js + mpegts.js) is fit for real Samsung Tizen hardware before any AVPlay work is considered. This is a manual test-execution checklist, run against a signed `.wgt` on a physical Samsung TV (or Remote Test Lab) — not a code change.

**Prerequisite:** a signed artifact produced by [`TIZEN-DEVICE-TESTING.md`](TIZEN-DEVICE-TESTING.md) §2 and checked by [`BETA-RELEASE-CHECKLIST.md`](BETA-RELEASE-CHECKLIST.md) §D. Those two documents own build/sign/install; this sheet only exercises the result.

**How to use:** Work through each section top to bottom on the target TV(s). Fill in PASS/FAIL and notes inline. Re-run the full sheet per TV model/firmware year tested (note the model at the top of each run). Keep completed sheets in this repo (copy this file to `docs/hardware-runs/<date>-<model>.md` per run, or append results below) so qualification evidence is durable.

---

## 0. Supported model floor — and the evidence behind it

**Ninety Beta 1 declares `required_version="6.5"` and supports Samsung TVs
from the 2022 model year onward. 2021 is explicitly NOT supported.**

Samsung's model-year mapping, which is what this document uses throughout:

| Model year | Tizen | Chromium |
|---|---|---|
| 2021 | 6.0 | **M76** |
| 2022 | 6.5 | **M85** |

**Correcting a mistake that was in this repository.** Several source
comments and `MULTI-AUDIO-NOTES.md` stated "Tizen 6.5 / Chromium 76",
pairing a 6.5 platform version with the M76 runtime that belongs to 6.0.
Those have been corrected. If a real TV is ever measured reporting Chromium
76 *while* reporting Tizen 6.5, that is a finding worth recording here —
but it is not the published mapping, and no comment should assert it
without a `navigator.userAgent` capture to back it up (smoke check **S22**
in the release checklist exists to capture exactly that).

### Why 2021 was dropped for Beta 1

The floor was raised from 6.0 during the Seller Office readiness pass. Two
independent problems were found; only one of them was fixable at
proportionate cost.

| Problem | Chromium needed | Status |
|---|---|---|
| **Module Workers** — both Worker factories passed `{ type: 'module' }`, which **throws at construction** below Chromium 80. The playlist builder has a synchronous fallback and survives; channel identity resolution deliberately has none, so it would simply never build an index and Match View's Ninety-stage matching would silently weaken. | 80 | **FIXED.** Vite already emits worker chunks as self-contained classic IIFE scripts (`worker.format: 'iife'`), so the production constructors now omit the option entirely and build classic Workers. Guarded by `src/core/platform/workerCompatibility.test.ts`. This is no longer a reason to exclude 2021. |
| **Flexbox `gap`** — **143 CSS rules** in this app set `gap` on a `display: flex` container. Flex gap is Chromium 84. On M76 every one of those spacings collapses to **zero**: the top navigation, Home rails, the Schedule guide, the Channels cascade and Match View all lose their layout. There is no PostCSS/autoprefixer step in this project to fall back on. | 84 | **NOT FIXED.** Converting 143 flex containers to margin-based spacing would be a rewrite of exactly the product work this release is built on, with a high regression risk against a model year we have never once tested on. |

So the honest position is: **the Worker problem is solved; the layout
problem is not**, and declaring 6.0 would ship an app that installs on a
2021 set and then looks broken. Beta 1 declares 6.5.

**To lower the floor back to 6.0 later**, the only remaining work is the
flex-`gap` layout pass (plus a real 2021 device or Remote Test Lab session
to verify it). The Worker side is already done. Note that Samsung's beta
testing is available from 2021 sets onward, so 2021 is a *product* decision
here, not a platform restriction.

### Known cosmetic degradation on 2022 (M85)

`color-mix()` is Chromium **111** and is used in `EventDetailsScreen.css`
and `PlaylistSetupScreen.css`. It therefore does **not** resolve on M85
either. This is deliberate and already handled: every legibility-critical
use is written plain-value-first so the blended value is a progressive
enhancement, and the worst case is flatter badge tints and a slightly
crisper row border — never an invisible focus ring. Record in the notes
below whether the tinted or flat variant is what the TV actually renders.

---

**Run metadata**

| Field | Value |
|---|---|
| TV model | |
| Firmware / Tizen version | |
| `navigator.userAgent` Chromium version (see S22) | |
| Tester | |
| Date | |
| Build (`.wgt` version / commit SHA) | |
| IPTV provider/account used | |

---

## 1. Install / Launch

| # | Test | Procedure | Expected result | PASS/FAIL | Notes |
|---|---|---|---|---|---|
| 1.1 | Signed widget installation | Sign and install by the one tested procedure in [`TIZEN-DEVICE-TESTING.md`](TIZEN-DEVICE-TESTING.md) §2 — `tz pack` with the Samsung author+distributor certs, then classic `tizen install` over the LAN. **Not** `sdb install` and not `tz install`: both route through the `sdb shell` channel Samsung blocks below Partner tier, and silently do nothing | Installs without certificate or profile errors; app icon appears in TV app list | | |
| 1.2 | First launch | Launch app fresh (no prior cache/playlist) | App boots to onboarding/connect screen within a few seconds; no crash, no blank screen | | |
| 1.3 | Relaunch with cached playlist | Complete onboarding with a real playlist, fully exit app, relaunch | App boots directly to Home using cached channel list; no re-onboarding prompt | | |
| 1.4 | Relaunch after cache recovery | Corrupt/clear only the channel cache (not onboarding prefs) via storage inspection or Admin "Resync playlist", relaunch | App detects missing/stale cache and recovers channel list from the stored source (playlist URL/Xtream creds) without requiring full re-onboarding | | |
| 1.5 | Cold boot TV then launch | Power-cycle the TV fully (unplug or hardware power off), wait for full boot, launch app as first action | App launches normally with no timing-related failure (race with network stack, storage not ready, etc.) | | |

## 2. Remote Control

| # | Test | Procedure | Expected result | PASS/FAIL | Notes |
|---|---|---|---|---|---|
| 2.1 | Arrows | Navigate Home, Channels, and Player toolbar using Up/Down/Left/Right | Focus moves predictably between all focusable elements; no dead zones or focus loss | | |
| 2.2 | Enter | Press Enter/OK on channel cards, toolbar buttons, popup rows | Activates the focused element every time | | |
| 2.3 | Back | Press Back on: a sub-screen, an open popup (source/subtitle), the player overlay, the root/Home screen | Back closes the innermost thing first (popup → overlay → screen). On the ROOT screen it raises the **"Exit Ninety?" confirmation** — it must NOT quit directly (Samsung requirement; see BETA-RELEASE-CHECKLIST §E-S rows S1–S5). App never gets stuck unable to exit | | |
| 2.9 | Long-press Back/Return | Press and hold Return | Samsung's own platform behaviour happens, unmodified — Ninety deliberately registers nothing for the long press and must not alter it | | |
| 2.4 | Focus restoration | Open then close the player overlay/popups repeatedly; navigate away from Player and back | Focus lands on a sensible, visible element every time (never nothing focused, never off-screen) | | |
| 2.5 | Player OSD | Press any remote key while OSD is hidden during playback | OSD (toolbar + channel info) reappears; first press is not "eaten" | | |
| 2.6 | Source popup | Open Source popup on a multi-source channel, navigate rows with arrows, select a different source | Popup opens/focuses correctly; selecting a source switches playback to it | | |
| 2.7 | Subtitle popup | Open Text/CC popup on a channel with and without subtitle tracks | Shows available tracks + Off when present; shows "no subtitles" message when absent; selection applies without playback restart | | |
| 2.8 | Mute | Press Mute toolbar button, then Unmute | Audio toggles correctly; icon reflects actual state | | |

## 3. Playback Formats

Run each against a real channel of that format from the test provider. Record exact codec (from stream info if available) in Notes.

| # | Format | Expected result | PASS/FAIL | Notes |
|---|---|---|---|---|
| 3.1 | Xtream MPEG-TS (raw `.ts`) | Loads via mpegts.js, plays smoothly, audio in sync | | |
| 3.2 | HLS `.m3u8` | Loads via hls.js (or native HLS if TV supports it), plays smoothly | | |
| 3.3 | H.264 1080p | Full 1080p decode, no dropped-frame stutter | | |
| 3.4 | HEVC / 4K (if test TV supports it) | Decodes if TV hardware supports HEVC; if not, confirm graceful error rather than hang/crash | | |
| 3.5 | AAC audio | Correct audio, no sync drift | | |
| 3.6 | AC3 audio | Correct audio decode (browser/Tizen must support AC3 passthrough or decode) | | |
| 3.7 | E-AC3 audio (if available on provider) | Correct audio decode | | |

## 4. Player Durability

| # | Test | Procedure | Expected result | PASS/FAIL | Notes |
|---|---|---|---|---|---|
| 4.1 | 30+ minute playback | Leave a single channel playing 30+ min uninterrupted | No memory-growth-related crash, no audio/video desync, no freeze | | |
| 4.2 | Repeated play/pause | Toggle play/pause 20+ times in a row | Always responds correctly; no stuck "loading" state | | |
| 4.3 | Mute/unmute | Toggle mute 20+ times in a row | Always responds correctly; volumechange stays in sync (per `htmlVideoPlayer.ts` state) | | |
| 4.4 | Source switch | Switch between all sources on a multi-source channel repeatedly | Each switch tears down the previous engine (hls/mpegts) cleanly — no overlapping audio, no leaked player instances | | |
| 4.5 | 20+ channel changes | Change channel 20+ times in quick succession | Every change loads correctly; no crash or degraded performance by the 20th change | | |
| 4.6 | Dead-source automatic failover | Use a channel with a known-dead source first in its list | Player auto-advances to the next source per `ChannelPlayerScreen.tsx`'s failover effect, without user action | | |
| 4.7 | All-sources-failed state | Use a channel where every source is dead/unreachable | UI shows the "All N sources failed" error state; does not loop retries forever or crash | | |
| 4.8 | Leave/re-enter player | Exit to Channel List and re-enter the player repeatedly | `player.dispose()` runs cleanly each exit; no growing memory/handle leak after 10+ cycles | | |

## 5. Provider Limits

These tests require an Xtream/provider account that enforces a single concurrent stream (`max_connections=1` or similar).

| # | Test | Procedure | Expected result | PASS/FAIL | Notes |
|---|---|---|---|---|---|
| 5.1 | Single allowed stream | Play a channel normally on a 1-connection account | Plays without a "max connections reached" error | | |
| 5.2 | Event Details causes zero playback connections | Open a sport Event Details screen (not the player) while the single-connection account is otherwise idle | Opening Event Details does not open any stream connection — verify via provider panel's active-connections view or network inspection, not just app behavior | | |
| 5.3 | Quality ranking does not probe streams | Trigger source/quality list population for a channel with multiple sources | No connection is opened to any source during ranking/listing — only on explicit selection | | |
| 5.4 | Only the selected channel plays | With the single-connection account, select a channel, then navigate elsewhere and back | At no point are two connections open simultaneously (e.g. previous channel not torn down before next one starts) | | |

## 6. Network

| # | Test | Procedure | Expected result | PASS/FAIL | Notes |
|---|---|---|---|---|---|
| 6.1 | Provider briefly unavailable | Block/drop connectivity to the IPTV provider only for ~30s during playback, then restore | Player surfaces an error state, recovers or fails over once provider is reachable again; no permanent stuck state | | |
| 6.2 | Ninety API unavailable | Block connectivity to the `ninety-api` backend while app is running | Sport/EPG-dependent features degrade gracefully (no crash); core channel playback (which doesn't depend on ninety-api) is unaffected | | |
| 6.3 | Slow provider | Throttle bandwidth to the provider (router QoS or similar) during playback | Player shows loading/buffering state rather than erroring immediately; recovers when bandwidth improves | | |
| 6.4 | Reconnect after Wi-Fi/network interruption | Disable TV Wi-Fi entirely for 15-30s during playback, then re-enable | App detects loss, does not crash; playback resumes or a clear error/retry path is available after reconnect | | |

## 7. App Lifecycle

Note: `config.xml` currently sets `background-support="disable"`, so Samsung's platform is expected to suspend/terminate rather than truly background this app — confirm actual on-device behavior below rather than assuming.

| # | Test | Procedure | Expected result | PASS/FAIL | Notes |
|---|---|---|---|---|---|
| 7.1 | Suspend/background (if Samsung supports it for this config) | Press TV Home while app is playing, wait, without pressing Home again check if OS terminated it | Document actual behavior — either the app is suspended and resumes, or it is terminated (given `background-support="disable"`, termination is expected — confirm this isn't broken) | | |
| 7.2 | Resume | Return to app after 7.1 | If suspended: video resumes or is cleanly reloaded, no black screen stuck forever. If terminated: relaunch behaves like 1.3 (cached playlist) | | |
| 7.3 | TV Home then return | Press TV Home, immediately return to app (short backgrounding) | App is either still alive and playing, or relaunches cleanly — no crash or corrupted state either way | | |
| 7.4 | App restart | Force-close app via TV's running-apps manager, relaunch | Behaves like 1.3/1.4 depending on whether cache survived; no leftover broken state from the killed session | | |

## 8. Memory / Large Playlist

| # | Test | Procedure | Expected result | PASS/FAIL | Notes |
|---|---|---|---|---|---|
| 8.1 | Thousands of channels | Load a playlist/Xtream account with several thousand channels | App loads and renders the list without crashing or running out of memory | | |
| 8.2 | Browse responsiveness | Scroll/navigate rapidly through the full large channel list | Remains responsive (no multi-second input lag) during scroll | | |
| 8.3 | Reconnect/cache recovery at scale | With the large playlist cached, force a reconnect/resync (Admin "Resync playlist" or kill+relaunch) | Full large playlist re-syncs and is browsable without timeout or crash | | |

---

## Final Decision: HTML5/MSE Player Qualification

Complete after all sections above are run on at least one representative TV (ideally: one older/lower-RAM model from the 2018-2020 range mentioned in `TIZEN-PLAN.md`, plus one current model).

- [ ] **PASS** — All sections above pass with no unresolved FAILs. Keep the current HTML5 `<video>` + hls.js/mpegts.js player (`src/core/player/htmlVideoPlayer.ts`). No AVPlay work needed at this time.

- [ ] **CONDITIONAL** — Passes overall but with specific, listed gaps. List exact codec/runtime gaps found (e.g. "HEVC 4K fails to decode on model X, firmware Y" or "AC3 passthrough silent on model X"). These gaps define the minimum scope for a future AVPlay evaluation — do not treat as blanket justification.

  Gaps found:
  1.
  2.

- [ ] **FAIL** — AVPlay implementation justified. Must be backed by specific reproducible evidence from this checklist (test #, TV model/firmware, exact failure), not general suspicion. List the failing tests and root cause below:

  Evidence:
  1.
  2.
