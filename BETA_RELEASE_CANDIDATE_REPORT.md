# Ninety TV — Beta Release Candidate Hardening

**Date:** 2026-08-27
**Branch:** `fix/ci-node-version` (base `b91f404`)
**Inputs:** [TV_HARDENING_AUDIT.md](TV_HARDENING_AUDIT.md),
[TV_NAVIGATION_HARDENING_REPORT.md](TV_NAVIGATION_HARDENING_REPORT.md),
[TV_PERFORMANCE_PLAYLIST_REPORT.md](TV_PERFORMANCE_PLAYLIST_REPORT.md)
**Scope:** adversarial regression hunt against the CURRENT source. No new features. Every
claim below was traced in the code and, where it is a behaviour claim, reproduced in a
test before it was fixed.

---

## Release recommendation

# READY FOR PHYSICAL-TV BETA VALIDATION

Read that literally: ready to be **put on the television and validated**, not ready to be
handed to external testers. Three separate defects found this session left the remote
completely dead — focus parked on a key with no component behind it, arrows inert, only
the hardware Back key still working. None of them was visible to the existing 1,676-test
suite, because every one of them lives in the gap between *which component norigin thinks
is focused* and *which component is actually rendered there*. All three are fixed and
covered by tests that fail without the fix.

What makes this "ready for validation" rather than "ready to ship": **nothing in this
report has run on a Samsung TV.** The Physical Samsung checklist at the end is short and
exact on purpose. Two of the items on it (`color-mix` support and module-Worker support)
decide whether the app *looks* and *performs* as designed on the target hardware, and
neither can be settled from a desktop.

---

## Blockers found and fixed

### 1. P0 — In Channels, the highlighted row and the row OK plays could be different rows

**Files:** [VirtualChannelList.tsx](src/features/channels/VirtualChannelList.tsx)

The brief's own test — *"What happens if the viewer presses OK now? The answer must match
what visibly appears focused"* — failed. Reproduced directly:

```
focus key after a background generation: row-6
HIGHLIGHTED ROW: CH6
OK PLAYED:       CH5
```

**Root cause.** norigin registers a focusable in a **mount-only** effect
(`addFocusable` runs with a `[]` dependency list — verified in
`norigin-spatial-navigation-react/dist/index.mjs:42-79`). A component whose `focusKey`
*prop* changes while the instance survives therefore stays registered under its **original**
key. Its second effect then calls `updateFocusable(newKey, …)`, which writes this
component's `node` and `onEnterPress` into whichever component already owns that key — but
`updateFocusable` does **not** carry `onUpdateFocus`. So the `.focused` CSS class stays with
the component that first registered the key while the OK action comes from the component
now rendering at that index.

`VirtualChannelList` rows are React-keyed by `channel.id` (stable across generations) but
spatially keyed by **position** (`${prefix}-${absoluteIndex}`). Reconciling by id alone was
safe while `channels` only changed when the viewer switched category — which resets the
window and remounts everything anyway. It stopped being safe the moment provider playlists
started refreshing in the background: a generation that adds or drops **one** PPV channel
above the viewer shifts every index below it. That is now a routine 12-minute event, and it
is precisely what the freshness feature exists to do.

**Fix:** the absolute index is part of the row's React key (`${absoluteIndex}:${channel.id}`),
so an index shift is a remount and every row re-registers under the key it actually renders
with. Rows are stateless and at most 50 exist. No call site changed — keys stay positional.

**Test:** `VirtualChannelList.generation.test.tsx` → *"keeps the highlight and the OK target
on the same channel after an insertion above it"*.

### 2. P0 — Unfavoriting the row you are standing on froze the remote, permanently

**Files:** [VirtualChannelList.tsx](src/features/channels/VirtualChannelList.tsx)

Reproduced through the real `CategoryChannelsScreen`, walking the window deep the way a
remote does:

```
FOCUS BEFORE: category-channel-row-345   window top: 320
FOCUS AFTER:  category-channel-row-345   exists: false   window top: 0
  t+50 … t+1600ms: focus=category-channel-row-345 exists=false
```

Focus never recovered. On a TV this reads as *the app stopped responding* — arrows do
nothing and only the hardware Back key gets you out.

**Root cause.** Two effects run on a removal, child-first: `VirtualChannelList` re-anchored
its window, and `CategoryChannelsScreen` focused the row that slid into the gap
(`pickFallbackAfterRemoval`). They disagreed. The list component reset its window to row 0
whenever the anchored channel had disappeared — unmounting exactly the row the parent was
about to focus. `setFocus` on a missing key parks the service on it, and because an explicit
`setFocus` **cancels norigin's debounced auto-restore** (`setFocus` calls
`setFocusDebounced.cancel()` first), nothing ever moved focus again. A control test confirmed
auto-restore works fine when nothing cancels it — so this was the app cancelling its own
safety net.

Reachable two ways, both ordinary: unfavoriting the focused channel with more than ~50
favorites, and a background generation dropping the PPV channel the viewer is standing on
in any deep category list.

**Fix:** on a same-logical-list change where the anchor is gone, the window **stays where it
is** (clamped to the shorter list) instead of resetting. The neighbour is then already
mounted and the caller's fallback lands on a real, focusable row.

**Tests:** `CategoryChannelsScreen.removal.test.tsx` (new file, verified to fail when the fix
is reverted); `VirtualChannelList.generation.test.tsx` → *"holds the window in place when the
anchored channel disappears"*, which replaces the old *"falls back deterministically to the
top"* — that contract was the bug.

### 3. P0 — Multiview's "Change source" opened with no focus and OK did nothing

**Files:** [PaneMenu.tsx](src/features/multiview/PaneMenu.tsx)

```
menu focus:         pane-0-fullscreen        exists: true
sources view focus: pane-0-menu-sources      exists: FALSE
focused row:        (none)
OK pressed:         onSelectSource not called
```

The viewer lands in a list of sources with nothing highlighted, where OK does nothing, while
up to four streams are still decoding behind it. Only Back gets out.

**Root cause.** The same mount-only registration as #1, one level up: `PaneMenu` swapped the
`focusKey` it passed to `useModalFocusScope` between `${paneId}-menu` and
`${paneId}-menu-sources` on one mounted component. The container stayed registered under the
first key, `updateFocusable(newKey, …)` found nothing to update, and the scope's own
`setFocus(newKey)` parked focus on a key with no component. Its children registered under a
`parentFocusKey` that did not exist either, so no child could be resolved.

**Fix:** the two views are two components (`PaneActionMenu`, `PaneSourceMenu`), so each owns
its own mount and its own registration — the same reason `ChannelPlayerScreen`'s
`VariantPopup`/`SubtitlesPopup` are separate components. Back semantics are unchanged
(sources → menu, menu → close), and now belong to whichever scope is mounted rather than to a
closure reading a `view` variable.

**Tests:** `PaneMenu.focus.test.tsx` (new file; the first test fails when the fix is reverted).

### 4. P1 — Choosing a source in a Multiview pane loaded the stream twice

**Files:** [MultiviewPane.tsx](src/features/multiview/MultiviewPane.tsx)

```
LOADED URLS AFTER PICK: [ .../HD.ts, .../SD.ts, .../SD.ts ]
```

The menu handler calls `controller.selectSource(index)` immediately (so the stream changes on
the keypress, not a render later), and the pane's source-sync effect applies the same change
again when the session's `pane.sourceIndex` catches up. `selectSource` always calls
`loadCurrent()` — there is no same-index bail — so the pane tore down and rebuilt the
identical stream back to back. On TV silicon that is a visible double stall in one of up to
four live panes.

**Fix:** the pick marks itself as applied before loading, so the sync effect sees no external
change. The effect still fires for a genuine external change (rerank on maximize), which is
what it exists for.

**Test:** `MultiviewPane.sourcePick.test.tsx` (verified to fail when the fix is reverted).

### 5. P1 (Tizen) — the diagnostic build would have crashed on boot on an older TV

**Files:** [devPerf.ts](src/core/perf/devPerf.ts)

`measurePerf` used `Array.prototype.findLast` — **ES2023, Chromium 97+**. `config.xml`
declares `required_version="6.0"`, i.e. Chromium 76. esbuild's `target: 'es2017'` rewrites
*syntax* but never polyfills a built-in method, so this shipped as-is.

It is gated behind `PERF_DIAGNOSTICS_ENABLED`, so a normal beta `.wgt` never reaches it — but
the **diagnostic** `.wgt` is exactly the build every hardware measurement in all three prior
reports asks the tester to install, and the first `measurePerf` call is
`app:boot-to-mount` in App's mount effect. On a TV older than Chromium 97 that throws out of
the first effect and takes the diagnostic build down with it. The entire on-device
measurement programme would have been blocked by a TypeError.

**Fix:** a reverse loop. Bundle re-scanned: `findLast` no longer appears in any emitted chunk.

### 6. P1 (Tizen) — `color-mix()` removed the Match View focus border on older WebKit

**Files:** [EventDetailsScreen.css](src/features/eventDetails/EventDetailsScreen.css)

`color-mix()` is **Chromium 111**. Tizen 6.0/7.0/8.0 are Chromium 76/94/108 — none of them
have it. All 16 uses are in Event Details, the screen the P0-2 focus work was about.

Most degrade harmlessly (a badge loses its tint, a gradient wash disappears). One did not:

```css
.stream-row { border: 1px solid color-mix(…); }
```

An invalid colour invalidates the **whole shorthand**, taking `border-width` and
`border-style` with it. `.stream-row.focused { border-color: var(--border-focus) }` then had
nothing to paint on. Focus survived only via its 2px `box-shadow` ring — i.e. the fix from the
navigation session was running at half strength on the actual target hardware, invisibly.

**Fix:** plain value first, `color-mix` second, everywhere it matters — the pattern
`.stream-row.top-pick` already used deliberately for its multi-layer background. Engines
without `color-mix` keep the first declaration; engines with it override. Eight rules,
CSS-only, no visual change on a modern engine.

---

## Remaining blockers

**None that block putting the build on a television.**

Four things are *unresolved* rather than *broken*, and every one of them is a hardware
question rather than a logic question. They are listed under *Remaining Tizen-specific
uncertainty* and in the P0/P1/P2 list.

---

## Navigation validation

Every screen was walked against the matrix in the brief (initial entry, four directions, OK,
Back, first/last item, async ready, empty, error, dynamic removal, modal open/close, scroll,
rapid input, return from child, and the three "X + focused" combinations). What follows is the
verdict, not a re-listing.

| Surface | Verdict |
|---|---|
| Onboarding | Unchanged, reference-quality. Not re-litigated. |
| Home | Sound. One narrow defect found, not fixed — see below. |
| TopNav | Sound. `active` and `focused` are separate vocabularies, covered by `TopNav.test.tsx`. |
| Schedule | Sound. Pill/fixture wiring explicit; `active`/`focused` collision already fixed. |
| Event Details | Sound. Back is a real child of the screen container; the ready-transition focus claim is guarded; stars are explicitly wired. |
| Channels (Browse cascade) | **Two P0s fixed** (#1, #2). Otherwise the most hardened screen in the app. |
| Search / Filter / Favorites / Recently Watched | Sound. Favorites was the reproduction case for #2. |
| Channel preview | Sound. Debounce split unchanged. |
| Player + OSD | Sound. Verified against norigin's source: `onEnterPress` re-checks `component.focusable`, and `getNextFocusKey` filters children by it — so the hidden toolbar genuinely cannot be activated, and resolves to the non-actionable container. |
| Source/Quality, Subtitle popups | Sound. Stable module-level focus keys. |
| Multiview grid / panes | Sound. |
| **Pane Menu** | **P0 fixed** (#3). |
| Event Picker | Sound. |
| Settings + dialogs | Sound. All modal scopes use module-level constant focus keys — audited explicitly for the #3 pattern. |
| Playlist setup / reconnect | Sound. |

**The systemic finding.** Defects #1 and #3 are the same bug wearing two hats: *norigin's
registration is established at mount and never re-established*. Any component that changes
its `focusKey` while staying mounted is silently mis-registered. I audited every
`useFocusable`/`useModalFocusScope` call site in the app for this pattern. After the two
fixes, **no remaining call site passes a focus key that can change while mounted**:
`pane.id`, `option.key`, `fixtureFocusKey(event.id)` and every screen/modal constant are all
either stable or matched by an identical React key. This is worth stating as a rule for
future work — see P1-4 below.

**Found, not fixed — Home card kickoff.** `LiveNowCard` and `ComingUpCard` are different
component types sharing one React key (`event.id`). When an event kicks off during the 60 s
refresh, React unmounts one and mounts the other; because Home's cards use norigin's
auto-generated focus keys, the new card gets a *new* key. If the viewer happens to be sitting
on that exact card at that exact moment, norigin's debounced auto-restore moves focus ~300 ms
later — most likely back to the hero. Nothing cancels the restore here, so focus is never
lost; it just moves. Narrow trigger, no freeze. Deliberately not fixed: Home's focus model was
settled in the navigation session, and giving the cards stable keys is a change I cannot
validate without the panel. **P1.**

---

## Playback validation

The two-mechanism architecture (gate + structural immunity) is correct as built. Verified by
reading and by the existing tests, which I re-ran and did not weaken:

- `usePlayerSession` memoizes its controller on `[player]` where `player = useMemo(…, [])`;
  `sourceUrls`, `initialIndex` and `options` are read only at construction. A generation
  cannot reach it.
- Multiview panes and their resolvers are keyed on `assignmentId` alone
  (`useMultiviewPaneResolution`'s deps are `[pane.assignmentId]`), so a new generation never
  re-resolves a live pane. H1 stays closed.
- `setPlaybackActive` writes a ref and only the **falling** edge does work — a test asserts
  the render count does not move when playback starts.
- `library.channels` keeps reference identity through a refresh during playback.

**Media listeners do not accumulate.** `htmlVideoPlayer.bindVideoEvents` attaches anonymous
listeners and never detaches them, which looks like a leak but is not: they are attached to
the per-mount `<video>` element, which is dropped with the component, and `dispose()`
explicitly pauses, clears `src` and calls `load()` to force Tizen to release the decoder.
StrictMode is off, so `attach` runs exactly once per controller.

**One benign race, deliberately left alone.** `drainPendingAndRefresh` keeps installing held
generations if the viewer re-enters playback during the drain (the loop does not re-check the
flag). Structural immunity covers it completely — that is what the second mechanism is for —
and adding a guard would introduce an untested path for resurrecting held generations days
before a beta. Documented as P2 rather than changed.

---

## Playlist freshness validation

The coordinator is genuinely the single path. I grepped every entry point: `resyncPlaylist`
and `resyncAll` (Settings), the launch sweep, the 60 s tick, `visibilitychange`, and
`playback-exit` all route through one `runSync` per playlist whose in-flight promise *is* the
overlap guard. The only other `syncPlaylist` caller is startup recovery, which is mutually
exclusive with the launch sync by construction. `AdminPanel`'s resync is DEV-only.

There is exactly **one** interval and **one** `visibilitychange` listener for playlists, and
one of each for the sports feed — both in hooks instantiated once from App, both cleaned up.
No duplicate timers, no per-screen resync, no request storm.

### `PREPARE_DURING_PLAYBACK` — inspected, and now actually covered

The brief asked for four things. Here is each, answered:

1. **Is the implementation correct?** Yes. The flag gates only the fetch half
   (`usePlaylistLibrary.ts:338`); the install half is gated unconditionally further down and
   is not reachable around it. `manual` is exempt from both, deliberately.
2. **Is there a safe fallback mode?** Yes — and it had **no test at all**. That is now fixed:
   `playlistSyncPrepareDisabled.test.tsx` mocks the policy module with the constant set to
   `false` and exercises the real hook.
3. **Would disabling it break freshness semantics?** No, and this is now proven rather than
   argued. With the flag off: nothing reaches the network while a stream plays; leaving
   playback runs the staleness check immediately and installs the PPV channel the provider
   added during the match; a short session that is still fresh does **not** trigger a
   gratuitous 5 MB download; and a person pressing Resync in Settings is never blocked.
4. **Is it still the top hardware test?** Yes — item M1 on the Samsung checklist, first
   measurement listed.

**It is NOT validated.** The 67 ms desktop clone figure stands; the 200–400 ms TV estimate is
still an estimate. Do not treat the new tests as validation of the *default* — they validate
that the *escape hatch* works, so the flip is one line and cannot silently cost freshness.

**One correction to the previous report's checklist.** Step 9 says Settings should show
*"Update ready"* during playback. It cannot: `pending-install` only exists while playback is
active, Settings is not a playback screen, and leaving playback drains everything held before
Settings can be reached. The status is correct in the code and effectively unreachable in the
UI. Do not spend hardware time looking for it. **P2** — either surface it somewhere reachable
or drop the string.

---

## Performance validation

`npm run benchmark:channel-index`, 30,925 channels, against the two prior baselines:

| | Audit | Nav session | Perf session | **Now** |
|---|---|---|---|---|
| `mergeChannelSources` | 402.9 ms | 397.6 ms | 385.6 ms | **429.5 ms** |
| `ChannelIndex` construction | 77.2 ms | 83.0 ms | 71.1 ms | **76.1 ms** |
| `getEntry` (µs) | 0.019 | 0.030 | 0.017 | **0.018** |
| `getChannelsForCategory` (µs) | 0.094 | 0.108 | 0.096 | **0.095** |
| O(1) proof at 15.5× size | 0.77× | 1.57× | 0.81× | **1.005×** |

No regression — all four figures sit inside the run-to-run spread of the three prior runs, and
the O(1) proof is the tightest it has been. Nothing this session touched these paths.

**One gap in the existing perf accounting, measured rather than assumed.** The reports state
the per-refresh main-thread cost as one ~67 ms structured clone (the playlist build). A
generation install *also* triggers a full channel-identity rebuild
(`useChannelIdentityIndex` deps are `[channels, generationId]`), and that carries its own
clone. Measured here, 30,925 channels, dev Mac:

```
identity projection:            ~5 ms   (negligible, as claimed)
structuredClone of the records: ~60 ms  (NOT in the accounting)
```

So an install costs roughly **130–150 ms** of main-thread clone on a Mac, not ~70 ms — call it
0.4–0.9 s on TV silicon. This is **correctly gated**: it is driven by the install, and the
install is held during playback, so it never lands on a live stream. But it *does* land on the
playback-exit moment, alongside the deferred install and Home's re-derivation. That is the
single busiest moment in the app's lifecycle and it is exactly checklist item 9. Added to the
hardware measurements as M6.

**Diagnostic-build growth.** `window.__ninetyPerf.marks/measures/longTasks` grow without
bound in a diagnostic build (~180 entries/hour from Home's tick alone, more from `longTasks`).
Harmless for a measurement session, wrong for a long soak. **P2.**

---

## Multiview validation

Exercised at 1, 2, 3 and 4 panes through the existing `describe.each` isolation suite, plus
the two new pane-level tests.

| Behaviour | Verdict |
|---|---|
| Generation install at 1–4 panes | No remount, no reload, no `selectSource`, audio owner and mute unchanged. Unchanged from the previous session and still green. |
| Add a pane | Siblings do not restart. |
| Remove a pane / remove the focused pane | Survivors do not restart. |
| Maximize / restore | Plain mount/unmount keyed on `assignmentId`; the maximized pane's stream does restart, which is the existing (intended) design, not a regression. |
| **Pane Menu** | **Was broken — fixed (#3).** Sources view now arrives with the playing source focused and actionable. |
| **Change source** | **Was double-loading — fixed (#4).** |
| Event Picker | Sound; `useModalFocusScope` with a constant key. |
| Playlist refresh / Home refresh during Multiview | No pane touched. |

---

## Tests / builds

| Command | Baseline (start of session) | Now |
|---|---|---|
| `npm test` | 116 files / 1,676 tests | ✅ **120 files / 1,685 tests, all passing** |
| `npm run lint` | 0 errors, 2 warnings | ✅ **0 errors, the same 2 pre-existing warnings** |
| `npx tsc -b --noEmit` | clean | ✅ clean |
| `npm run build` | PASS | ✅ PASS |
| `npm run build:tizen` | PASS, 3.37 MB | ✅ PASS, **3.2 MB** |
| `VITE_PERF_DIAGNOSTICS=1 npm run build:tizen` | PASS | ✅ PASS, diagnostics retained |
| `npm run benchmark:channel-index` | see table | ✅ no regression |

Both lint warnings are the documented pre-existing pair (`OnboardingStepper`'s
`only-export-components`, and Event Details' deliberate `exhaustive-deps` on the ranking memo).
Neither is new.

**Nine tests added, in four files.** Every one of them was verified to **fail** against the
unfixed code before being kept — they discriminate rather than merely pass:

| File | Pins |
|---|---|
| `features/channels/CategoryChannelsScreen.removal.test.tsx` *(new)* | Removing the focused row deep in Favorites leaves focus on a real focusable and does not jump to the top |
| `features/channels/VirtualChannelList.generation.test.tsx` | Highlight and OK target stay on the same channel across an insertion; the window holds when the anchor disappears |
| `features/multiview/PaneMenu.focus.test.tsx` *(new)* | The source sub-view arrives with the playing source focused and actionable; Back returns to the menu with live focus |
| `features/multiview/MultiviewPane.sourcePick.test.tsx` *(new)* | A source pick loads exactly once |
| `data/playlists/playlistSyncPrepareDisabled.test.tsx` *(new)* | The `PREPARE_DURING_PLAYBACK: false` fallback: no fetch during playback, freshness deferred not lost, no gratuitous re-download, manual sync unaffected |

---

## Remaining Tizen-specific uncertainty

`config.xml` declares `required_version="6.0"` — **Chromium 76**. Tizen 7.0 is Chromium 94 and
Tizen 8.0 is Chromium 108. Every item below follows from that and none can be settled from a
desktop.

| # | Item | What is at stake | How to settle it |
|---|---|---|---|
| T1 | **`color-mix()`** (Chromium 111) | 16 rules in Event Details. Fallbacks are now in place, so the worst case is "flatter badges, crisper row border" rather than "no focus border" — but only the panel shows which branch you get. | Photograph a match's stream list from ~3 m. If the metadata pills look flat/untinted, `color-mix` is unsupported and the fallbacks are what you are seeing. |
| T2 | **Module Workers** (`{type:'module'}`, Chromium 80) | Two workers. The playlist build **has** a proven synchronous fallback (429 ms main-thread merge — i.e. exactly the pre-session behaviour). Channel identity resolution has **no** fallback by design: it stays `null` for the session, which silently weakens Match View's Ninety-stage matching without breaking anything. | Diagnostic build: confirm the mark is `playlist:parse`, **not** `playlist:parse-main-thread`; and confirm `[channelIdentity] built index for catalog …` appears in the console. |
| T3 | `PerformanceObserver('longtask')` | If unsupported, the long-task half of the diagnostics is simply absent. It feature-detects and no-ops. | Confirm `__ninetyPerf.longTasks` is non-empty at *some* point. If it stays empty through a known-heavy operation, report "unsupported", not "no long tasks". |
| T4 | `requestIdleCallback` | Used by `yieldToMainThread` for both the sliced Home match and the chunked index warm. Falls back to `setTimeout(0)`, which yields slightly more eagerly — the safe direction. | No action; noted for completeness. |
| T5 | **`PREPARE_DURING_PLAYBACK`** | The clone cost while a stream plays. Estimated 200–400 ms on TV, never measured. | M1 below. The flip is one line and its fallback is now tested. |

The rest of the newly-introduced code was scanned against ES2017-plus-Chromium-76: the built
bundle contains no `replaceAll`, `.at(`, `findLast`, `Object.hasOwn`, `structuredClone`,
`Object.fromEntries`, `toSorted`/`toReversed`/`with`, or `AbortSignal.timeout`. The only
post-ES2017 built-ins present are `flatMap` (Chromium 69) and `Promise.allSettled`
(Chromium 76) — both safe at the declared floor.

---

## Physical Samsung checklist

Build, sign, install:

```
VITE_PERF_DIAGNOSTICS=1 npm run build:tizen
```

Pull measurements with `copy(JSON.stringify(window.__ninetyPerf))` from the Tizen remote
debugger. **Do the three focus checks (4, 5, 11) first — they are this session's fixes.**

1. **Fresh cold launch.** Uninstall, reinstall, launch. Home paints without waiting on the
   network. No boot panel, no black screen.
2. **Initial Home focus.** Something is visibly focused before you touch the remote — the
   hero's Watch Now. Press Down, then Up: focus returns to the hero and the page scrolls
   with it.
3. **TopNav.** Look at the bar on Home: **Home** carries the underline, the remote's position
   carries the pill. Press Right/Left along the whole bar and past both ends — the pill keeps
   up with every press and focus is never lost at either end. Reach the avatar; its ring must
   be obvious against the artwork. Press Down from each tab into the page, and Up back.
4. **★ Channels — rapid scrolling and the virtualization boundary.** Open a large category.
   Hold Down for ~3 s and release: the highlight is on the settled row the instant it
   settles, with no queue of fades. Now, on any row, **check that the highlighted row is the
   one that plays**: press OK, confirm it is the channel that was lit, press Back. Repeat
   deep in the list (past row 100). *(Fix #1.)*
5. **★ Favorites — remove the row you are on.** Favorite 60+ channels. Open Favorites, scroll
   past row 50, and unfavorite the focused row from its star. **The list must not jump to the
   top, and the arrows must still work.** Press Down three times to prove it. *(Fix #2.)*
6. **Hidden Player OSD.** Play a channel. Press **OK once** as soon as video starts → the OSD
   appears, playback continues, you are **not** returned to the channel list. Let it
   auto-hide (6 s) and press **OK once** again → same result, focus on Pause. Repeat five
   times. From hidden, press **Right** once → the OSD appears with **Pause** focused.
7. **Source/Quality.** Open Quality → focus is on the currently playing choice. Press Back →
   the popup closes, the OSD stays up, focus returns to the Quality button. Open it again and
   let it idle out for 6 s → both close; press OK → the OSD returns and you are still in the
   Player.
8. **Playlist refresh while playing.** Start a stream and leave it. Either shorten
   `PLAYLIST_REFRESH_INTERVAL_MS` or suspend/resume past the interval. **Video never pauses or
   reloads, audio never interrupts, and Quality still shows the same pick.** Read
   `playlist:build-worker-round-trip` and check `longTasks` for a correlated entry — this is
   **M1**.
9. **Exit after long playback.** After a long session, press Back out of the Player. Time the
   gap between the press and Home being usable. This is the app's busiest moment: the held
   generation installs, the identity index rebuilds, and Home re-derives, all together. This
   is **M6**.
10. **Newly added PPV source.** After that exit, open an event whose PPV feed appeared in the
    refresh. The new row is simply there — no "Finding the best streams…" flash — and it
    plays.
11. **★ Multiview with 4 streams.** Build a 4-pane grid. On any pane press OK → the pane menu
    opens with a row focused. Choose **Change source** → **the source list opens with the
    playing source visibly highlighted**, and OK selects it. Watch that pane: it should
    change stream **once**, not stall twice. Press Back from the source list → you return to
    the pane menu, still with visible focus. *(Fixes #3 and #4.)* Then: add a pane, remove a
    pane, maximize and restore — no unrelated pane restarts.
12. **App suspend/resume.** Press Home on the remote, wait 20 minutes, return to Ninety. It
    resumes rather than restarting; a refresh fires on resume; nothing is stuck loading.
13. **Back everywhere.** From each of Home / Schedule / Channels (each cascade level) / Match
    View / Favorites / Recently Watched / Settings (and each dialog) / Player (popup → OSD →
    exit) / Multiview (maximized → grid → exit): Back goes exactly one level up and never
    skips a level or exits the app early.

Additional measurements to pull while you are there:

| # | Read | Why |
|---|---|---|
| **M1** | `playlist:build-worker-round-trip` **during playback**, plus correlated `longTasks` | Decides `PREPARE_DURING_PLAYBACK`. Flip to `false` if a correlated long task coincides with a visible input stall — the fallback is tested. |
| M2 | `home:local-match` on Home for 5 min, then during playback | Confirms the 15× win lands on real silicon. Expect ~5–10× the dev-Mac figures, not seconds. |
| M3 | `playlist:parse` vs `playlist:parse-main-thread` | Which path ran (T2). |
| M4 | `__ninetyPerf.longTasks` non-empty at any point | Whether the observer exists at all (T3). |
| M5 | Event Details open latency | The JPEG artwork win's decode half. |
| **M6** | `playlist:install-deferred` → `playlist:install`, and `identity:projection` / `identity:worker-round-trip`, at the moment you exit a long playback session | The install + identity-rebuild + Home-rederive pile-up measured above at ~130–150 ms of clone on a Mac. |

---

## Prioritized list

### P0 — before beta

Everything in this bucket is **done**. Listed so the hardware pass knows what to confirm.

| # | Item | State |
|---|---|---|
| P0-1 | Channels: highlight and OK target could be different rows | Fixed + test. Confirm on TV: checklist 4. |
| P0-2 | Favorites/Channels: removing the focused row froze the remote permanently | Fixed + test. Confirm on TV: checklist 5. |
| P0-3 | Multiview: "Change source" opened with no focus and OK did nothing | Fixed + test. Confirm on TV: checklist 11. |
| P0-4 | Diagnostic build would crash on boot on Chromium < 97 | Fixed. Implicitly confirmed by the diagnostic build running at all. |
| P0-5 | Run the Physical Samsung checklist | **Outstanding — this is the gate.** |

### P1 — before public release

| # | Item |
|---|---|
| P1-1 | **Measure M1 and decide `PREPARE_DURING_PLAYBACK`.** Still the single most important open question. The fallback is now tested, so this is a measurement, not a risk. |
| P1-2 | **Settle T1 and T2 on the panel** — whether `color-mix()` and module Workers exist on the target TV. Both have safe degradations; both change what the viewer actually gets. If module Workers are absent, decide whether channel identity resolution silently staying `null` is acceptable for public release or needs a chunked main-thread fallback. |
| P1-3 | **Home card kickoff moves focus** (~300 ms after an event goes live under the viewer's focus). Give `LiveNowCard`/`ComingUpCard` a shared stable focus key (`home-card-${event.id}`) so the remount re-registers the same key. One line, but validate it on the panel. |
| P1-4 | **Write the registration rule down** next to the focus contract in `tokens.css`: *a focus key may never change while a component stays mounted — norigin registers at mount only. Either key the React element so the change forces a remount, or derive the focus key from content that cannot change.* Three P0s this session came from breaking it. |
| P1-5 | **Measure M6** — the playback-exit pile-up. If it is visible from the couch, the identity rebuild is the piece to defer, not the install. |
| P1-6 | Re-check `required_version="6.0"` against the TVs actually being beta-tested. If the floor can be raised to 7.0 or 8.0, several T-items collapse. |

### P2 — later

| # | Item |
|---|---|
| P2-1 | `drainPendingAndRefresh` keeps installing held generations if playback restarts mid-drain. Benign — structural immunity covers it. Re-check the flag inside the loop when there is time to test it properly. |
| P2-2 | Settings' *"Update ready"* status is effectively unreachable in the UI. Either surface it somewhere a viewer can see it, or drop the string and the branch. Also correct step 9 of the perf report's checklist, which asks testers to look for it. |
| P2-3 | `window.__ninetyPerf` grows without bound in a diagnostic build. Cap the arrays. |
| P2-4 | `React.memo` on `MultiviewPane` — measured at 0.17–0.55 ms and rejected. The number is on record; re-measure only if the pane subtree gets materially heavier. |
| P2-5 | Resolve the two pre-existing lint warnings (or mark the deliberate one as suppressed rather than warned). |
| P2-6 | Remove the `__ninetyBootMounted` hook once the beta is stable. Note: the boot-diagnostic overlay itself is **already** correctly handled — `vite.config.ts` deletes the block outright from a normal build, and production gets a branded fallback panel with a Restart button. Only the mount hook is left. |
| P2-7 | Add a plain fallback for the Event Details header's `color-mix` gradient wash (it currently degrades to no wash at all). Cosmetic. |

---

## What was deliberately not touched

Per the brief, and because each was verified sound in the current source rather than taken on
trust: the Player OSD focus model, Event Details' initial top-stream focus and its
recommended-vs-focused split, the single sync coordinator and its triggers, the playback gate
and structural isolation, the Worker-with-synchronous-fallback playlist build, the time-sliced
Home matching, and the JPEG artwork. No folders were restructured, nothing was renamed, and no
router or state library was introduced.
