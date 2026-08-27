# Ninety TV — Runtime Performance & Aggressive Playlist Freshness

**Date:** 2026-08-27
**Branch:** `fix/ci-node-version` (base `b91f404`)
**Inputs:** [TV_HARDENING_AUDIT.md](TV_HARDENING_AUDIT.md) (§P1-1 … P1-5, hazards H1–H4),
[TV_NAVIGATION_HARDENING_REPORT.md](TV_NAVIGATION_HARDENING_REPORT.md)
**Scope:** the two things the session was asked for — remove *confirmed* runtime
bottlenecks, and make provider playlists aggressively fresh without ever disturbing
an active stream. No navigation styling was touched.

The core principle, restated because every decision below follows from it:

> **Refresh playlist data aggressively. Insulate active playback completely.**
> A fresh generation changes what Ninety can discover NEXT and play NEXT. It must
> never change the stream the viewer is already watching.

---

## Confirmed bottlenecks

Everything here was re-measured against the current source before it was changed.
Nothing was optimized speculatively; two things were measured and deliberately
**not** changed (see *Home/render changes*).

| # | Bottleneck | Measured, dev Mac | When it ran |
|---|---|---|---|
| B1 | `mergeChannelSources` + `parseM3u`, one unbroken main-thread task | **429 ms** for 30,925 channels / 5.35 MB | every connect, resync, recovery |
| B2 | ↳ of which `normalizeChannelName` alone | **339 ms** (79 % of B1) | per channel, no memoization possible (names are ~all distinct) |
| B3 | Home's local channel-matching pass, one unbroken task | **1,876 ms** — 30 events × 7,750-channel PPV bucket | **every 60 s, on every screen, playback included** |
| B4 | ↳ dominated by un-memoized `significantWords(teamName)` | 2 calls × bucket × events = **465,000 calls/refresh**, ~7 allocations each | same |
| B5 | ↳ plus `foldForMatching(channel.name)` per (event, channel) | 232,500 folds/refresh, 3 allocations each | same |
| B6 | ↳ plus a defensive copy of the whole PPV bucket per event | 30 fresh 7,750-pointer arrays per refresh | same |
| B7 | No playlist refresh after launch, at all | — | PPV channels added by the provider were invisible for the whole session |
| B8 | `.wgt` is 93 % PNG artwork | 19 MB package; ~6.29 MB RGBA decode per hero | per Event Details open, plus package size |

B7 is not a performance bottleneck — it is the product defect this session's
architecture exists to fix, and it is what made B1 and B3 matter far more than they
previously did: a 429 ms merge you pay once at launch is tolerable; one you pay every
twelve minutes is not.

**Measured and deliberately left alone:** an unrelated parent re-render of a live
Multiview grid costs **0.17–0.55 ms at 1–4 panes** (measured in jsdom, dominated by
`act()` overhead rather than by the panes). `React.memo` there would be ritual
memoization — see *Multiview findings*.

---

## Changes implemented

| Area | Change |
|---|---|
| Off-main-thread build | New `playlistBuildWorker` — `parseM3u` + `mergeChannelSources` in a dedicated Worker, with a synchronous fallback that is byte-identical |
| Sync coordinator | New `playlistSyncPolicy.ts` (pure) + a coordinator inside `usePlaylistLibrary` — one timer, one visibility listener, one path for every trigger |
| Atomic generations | `fetchPlaylistGeneration` / `installPreparedChannels` split, so preparing a generation touches neither storage nor the live tree |
| Playback gate | `library.setPlaybackActive(active)`, called from App on entering/leaving Player and Multiview |
| Validation | Empty-response rejection (existing) plus a shrink guard a **manual** sync can override |
| Backoff | Capped exponential (1×/2×/4×) with jitter, counted from the last *attempt* while failing |
| Home matching | `significantWords` memoized; `ChannelIndexEntry.matchName` precomputed; allocation-free bucket views; time-sliced instead of one task |
| Event Details | Re-match keys on `playlistGenerationId`, stale-while-revalidate, focus recovery only when the focused row actually disappears |
| Channels | `VirtualChannelList` gains `listKey`; a same-list generation re-anchors on the viewer's channel instead of resetting to row 0 |
| Artwork | 10 hero banners + `test_image` converted PNG → JPEG q82 |
| Latent bug fixed | `stateRef` now advances synchronously with `install()` — the launch sync would otherwise have silently dropped its own write (see below) |

### The latent bug worth calling out

Writing the coordinator surfaced a real defect that was **not** in the audit.
`installPrepared` re-reads `stateRef.current` after its `await`, as every operation in
this hook does. But `stateRef` was only advanced during *render*, and a `setState`
issued from a promise chain does not commit before that chain's next microtask runs.
Startup's sequential `hydrate → recover → launch-sync` pass is exactly that shape, so
the launch sync would have read the pre-hydration snapshot, found no matching
playlist, and **silently discarded the generation it had just downloaded**. Fixed by
advancing `stateRef` synchronously inside `install()` and `updateDefinitions()`.
It is asserted by two coordinator tests that fail without it.

---

## Playlist scheduler architecture

```
                      ┌──────────────────────────────────────────┐
  launch ─────────────┤                                          │
  interval tick ──────┤   shouldSync(trigger, record, now)       │  playlistSyncPolicy.ts
  visibilitychange ───┤   backoffMultiplier / nextDueAt          │  (pure, no React,
  playback-exit ──────┤   validateGeneration                     │   no clock, no I/O)
  Settings "Sync" ────┤                                          │
                      └────────────────────┬─────────────────────┘
                                           │
                                    runSync(playlist, trigger)      ← the ONLY path
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    │ in-flight for this playlist?                │
                    │   yes → JOIN it (manual also upgrades it)   │
                    │   no  → is it due? (manual/launch: always)  │
                    └──────────────────────┬──────────────────────┘
                                           ▼
                              download → parse → merge          ← in the Worker
                                           ▼
                                      validate
                                           ▼
                        ┌──── playback active? ────┐
                        │ yes                      │ no
                        ▼                          ▼
                  HOLD (pending)             INSTALL (atomic)
                        │                          │
              playback ends ─────────────────────► │
```

**Cadence: 12 minutes**, the middle of the requested 10–15 minute band, plus ±90 s of
jitter per playlist. Justified rather than picked: one refresh downloads ~5 MB and
costs ~70 ms of main-thread structured clone. At this cadence that is ~7 kB/s average
bandwidth — nothing beside a live video stream — and well under 0.1 % of one core.
A tighter cadence buys very little: a provider publishing a PPV slot for a 20:00
kickoff does so minutes to hours ahead, not seconds.

**Tick: 60 s.** The tick itself is a handful of integer comparisons per playlist; the
staleness decision lives in `shouldSync`. A coarse tick would make a resume-triggered
or backoff-expiring sync wait up to a full interval past its due time.

**Every trigger, and what makes it different:**

| Trigger | Due check | Installs during playback |
|---|---|---|
| `launch` | skipped — a cached playlist's age is unknown | n/a (playback is never active at launch) |
| `interval` | yes | no — held |
| `resume` | yes | no — held |
| `playback-exit` | yes | yes, by definition |
| `manual` | skipped — a person pressing Sync must see something happen | **yes**, and it also overrides the shrink guard |

**No overlap, no duplicates.** Every trigger routes through one `runSync` per playlist
whose in-flight promise *is* the guard: a resume landing mid-download joins the sync
in progress rather than starting a second download of the same 5 MB. A **manual**
request arriving on top of a running automatic one adopts it and upgrades its install
to ungated — "handle it intelligently rather than starting another identical
operation".

**Multiple playlists are strictly sequential**, exactly as startup recovery already
was. Two large playlists downloading and merging at once on a low-powered TV compete
for the same network and the same main thread; the second gains nothing by starting
early.

**Visibility signals used, stated explicitly** (the requirement asks): the Page
Visibility API and only it — `document.visibilityState` gates the tick, and the
`visibilitychange` event is the resume trigger. Tizen fires both on suspend/resume,
and this codebase has no other lifecycle binding available (`core/platform` has none;
`useHomeFeed` established the same precedent). A tick while genuinely hidden does
nothing at all, so a suspended app burns neither the provider's bandwidth nor the
TV's radio.

**Backoff.** 1× / 2× / 4× the base interval, then capped. Capped rather than unbounded
because the likeliest cause of repeated failure — a provider outage, or the TV off the
network — resolves without any state change Ninety can observe, so it has to keep
trying eventually. At the cap that is one attempt per ~48 minutes. A pure-function
test asserts that **no reachable sequence of failures retries tighter than the base
interval**, which is the "no retry storm" requirement expressed as a property rather
than a hope.

---

## Atomic generation architecture

The lifecycle the requirement describes, mapped onto the code:

```
Generation N stays active and on screen  ───────────────────────────────┐
        │                                                              │
   fetchPlaylistGeneration()                                           │  nothing
        ├─ download           (network)                                │  below this
        ├─ parse + merge      (Worker)                                 │  line has
        ├─ normalize/stamp    (preparePlaylistChannels — pure)         │  touched
        └─ validate           (validateGeneration)                     │  storage or
        │                                                              │  the live tree
   ── any failure here → THROW; generation N is still exactly N ───────┘
        │
   installPrepared()
        ├─ writePlaylistChannels()      persist the channel record
        ├─ persistLibrary()             persist the definitions
        ├─ warmChannelIndexAsync()      build the ~30 k index OFF this render, chunked
        └─ setState({...})              ONE swap: playlists + loaded + channels + generationId
```

- **A provider outage cannot wipe working channels.** Nothing is cleared up front, so
  a network failure, a rejected credential or an empty response throws before a byte
  of the working cache is touched. Asserted directly.
- **A malformed-but-parseable response cannot either.** `validateGeneration` rejects
  an empty result from every trigger, and rejects a collapse to under 25 % of the
  previous channel count from every *automatic* trigger. A **manual** sync bypasses
  the shrink guard on purpose: if a provider really has cut its catalogue, the viewer
  pressing Sync is entitled to the truth — the guard exists to stop an unattended
  refresh from destroying a working playlist, not to overrule a person. The Settings
  error message says exactly that.
- **Ids, favourites and history survive.** Channel ids are content-derived (the merge
  key *is* `Channel.id`), so favourites, recently-watched, list anchors and Event
  Details' row focus keys all stay valid across a generation.
- **Persistence happens at install, not at fetch.** A held generation leaves the
  on-disk cache — and therefore the next cold launch — pointing at the generation the
  app is actually showing. A held generation that is never installed is simply
  dropped.
- **Exactly one generation is held per playlist.** A newer prepare replaces an older
  pending one rather than queueing, so a two-hour match cannot accumulate twelve
  30,000-channel arrays.
- **An in-flight generation is discarded if its connection changed underneath it.**
  A sync started against provider A can still be downloading when the viewer edits the
  connection to provider B; installing A's result would silently put them back on the
  provider they just left. Found in review, fixed, and covered by a test that fails
  without the guard.

---

## Playback isolation architecture

Two independent mechanisms, because the requirement is non-negotiable and one
mechanism is not enough for a non-negotiable requirement.

### 1. The gate — prevention

`App` owns the only knowledge of whether a screen with live video is up, so it tells
the library:

```tsx
useEffect(() => {
  setPlaybackActive(screen === 'player' || screen === 'multiview')
}, [screen, setPlaybackActive])
```

`setPlaybackActive` writes a **ref**, never state — telling the library that playback
started must not re-render the library's consumers, including the player that just
started. Entering playback does no work at all: no cancellation, no flush, no state
change, so starting a stream can never be delayed by the coordinator. A test asserts
the render count does not move.

Only the **falling** edge does work: install everything held, then immediately check
staleness. That is what makes the §8 scenario work end to end — see below.

### 2. Structural immunity — defence in depth

The gate means a generation cannot reach a live Player in production. These tests
assert that it would not matter if it did:

| Guarantee | Where it is proven |
|---|---|
| Player: no remount, no new engine, same `<video>` element | `ChannelPlayerScreen.playerIdentity.test.tsx` |
| Player: **no second `load()`** — source URL and therefore quality unchanged | same, new test, across 4 generation swaps |
| Player: playback state stays `playing` | same |
| Multiview at **1, 2, 3 and 4 panes**: no remount, same `<video>` elements | `multiviewGenerationIsolation.test.tsx` (`describe.each`) |
| Multiview: **`controller.selectSource()` never called** — H1 closed | same (asserted via `load()` call log) |
| Multiview: audio owner and muted state unchanged | same |
| Multiview: adding a pane does not restart siblings | same |
| Multiview: removing a pane does not restart survivors | same |
| Library: `library.channels` keeps **reference identity** through a refresh during playback | `playlistSyncCoordinator.test.tsx` |

That last one is the strongest single statement available: not "the contents are the
same" but "it is the same array object", which is what every downstream memo,
`getChannelIndex`'s WeakMap and `useChannelIdentityIndex` key off. If the reference
does not move, nothing downstream can react.

### What the gate deliberately does NOT block

The **fetch** half — download, parse, merge — keeps running during playback, because
that is what makes new channels available the instant the viewer leaves. Its entire
main-thread cost is one structured clone of the resulting `Channel[]` coming back out
of the Worker: **67 ms measured** at 30,925 channels, so an estimated 200–400 ms on TV
silicon, **once per 12 minutes**.

That is a real number and it is stated rather than hidden. For scale: before this
session, Home's local matching ran **1.9 seconds** of unbroken main-thread work every
**60 seconds** on every screen, playback included. Net main-thread load during
playback is now far lower than it was, not higher.

This is the single most important thing to confirm on hardware. It is expressed as one
exported constant, `PREPARE_DURING_PLAYBACK`, with the flip procedure and the exact
perf mark to read (`playlist:build-worker-round-trip`) documented beside it. Setting
it to `false` falls back to precisely the behaviour the requirement offers as the
alternative: nothing fetched during playback, immediate staleness check on exit.

### The §8 scenario, traced

1. Launch → cached generation on screen before any network call.
2. `launch` sync refreshes every resyncable playlist, sequentially.
3. Viewer starts a match → `setPlaybackActive(true)`. Nothing happens.
4. Two hours pass. `interval` syncs fire every ~12 min: each downloads, merges in the
   Worker, validates, and is **held**. Settings shows *Update ready*.
5. Provider adds PPV streams; the most recent held generation contains them.
6. Viewer exits → `setPlaybackActive(false)` → held generation installs immediately,
   then a `playback-exit` staleness check runs.
7. New channels are visible in Channels, and discoverable from Event Details, with no
   app restart. **Covered by two coordinator tests**, including the harsh variant
   where the app was suspended throughout so no periodic sync ever ran and the exit
   itself has to trigger the download.

---

## Worker/chunking decision and rationale

**Decision: a Worker, with a synchronous fallback.**

Safe to commit to because the app already ships one that works on the target
hardware — `channelIdentityWorker` has been in the Tizen build since the resolver
work, and its chunk is present in `dist-tizen`. The new worker uses the identical
`new URL(..., import.meta.url)` + injectable-`WorkerFactory` pattern, and Vite emits
it as its own 7 KB self-contained chunk (verified in both the normal and Tizen
builds).

**The clone cost was measured before committing, not after:**

| Payload crossing the boundary | structuredClone, 30,925 channels |
|---|---|
| M3U playlist text (5.35 MB) | **2.3 ms** |
| `RawChannel[]` (30,925 parsed objects) | 23.6 ms |
| `Channel[]` (the result, either way) | **67.1 ms** |

So the request carries the **raw playlist text**, not a pre-parsed array — one string
is ten times cheaper to clone and it moves `parseM3u` off the main thread for free.
The Xtream path sends `RawChannel[]` instead, because that is where its JSON API
naturally lands, and `liveStreamsToChannels` deliberately stays on the main thread so
the Worker message carries no separate credential object of its own.

**Net effect:** 429 ms of unbroken main-thread work becomes ~70 ms of clone, with the
~430 ms of actual computation off-thread. **~6× reduction** in main-thread blocking
per sync.

**Correctness never depends on the Worker existing.** Tizen WebKit varies by TV model
year and module-Worker support is not guaranteed on every one. A Worker that cannot be
constructed, errors, or never answers (30 s timeout) degrades to running the *same
pure function* synchronously — i.e. to exactly the behaviour this codebase had before.
Tests assert byte-identical output between the two paths (including that channel
**ids** match exactly, since the merge key is the id), and exercise all three failure
modes.

One refinement from review: a Worker-reported **data** error (`ok: false` — the Worker
ran fine, the payload is unusable) is now distinct from an **infrastructure** failure,
and does *not* trigger the fallback. Re-running an identical pure computation on the
main thread would spend hundreds of milliseconds and a second ~30,000-object
allocation to reach the same throw.

**Chunking was not used as a substitute** — `warmChannelIndexAsync`'s existing chunked
build and `nextPaint` are untouched and still do their jobs.

---

## Home/render changes

### The matching cost — four independent wins

1. **`significantWords(teamName)` memoized.** This was the real hot spot, and it was
   *not* in the audit. `textMatchesTeam` calls it once per (channel, team) pair, so
   Home's pass ran it **465,000 times per refresh** for 30 events against a
   7,750-channel bucket — each call allocating a folded string, a replaced string, a
   split array, two filtered arrays and a sort. The input vocabulary is two team names
   per event. Hit rate ≈ 100 %.
2. **`ChannelIndexEntry.matchName` precomputed.** `ingestOne` already computed
   `foldForMatching(channel.name)` to decide `isPpvOrUnmapped`/`isLikelySport` and
   threw it away. Keeping it removes a full three-allocation fold from the
   per-(event, channel) inner loop.
3. **No more defensive bucket copies in the matching path.** New `readonly` entry
   views (`getPpvOrUnmappedEntries`, `getEntriesForCountry`) for the loops that only
   read. The public `Channel[]` getters still hand out copies — the existing
   mutation-isolation test is untouched and still passes.
4. **Time-sliced, not one task.** With `allowNetworkFallback` unset every stage
   returns before its first `await`, so `Promise.all(nearTerm.map(...))` produced one
   unbroken task. Now the pass yields whenever it has held the main thread for 8 ms.

On (4), the first implementation used fixed 2-event chunks; **review caught that this
adds latency to Home's first paint** (up to ~14 gratuitous idle-callback waits before
any card renders, since the feed's `setState` is after the loop). Replaced with a time
budget, extracted as `core/async/sliceWork.ts`: a long pass yields as often as it
actually needs to *on this device against this data*, and a short pass — the common
case, and the one on the first-paint path — yields **zero** times and costs nothing.
The slicing rule has its own unit tests with the clock and the event loop injected.

### What was measured and deliberately left alone

- **`React.memo` on `MultiviewPane`.** An unrelated parent re-render costs
  0.17–0.55 ms at 1–4 panes. Every handler is an inline closure, so memoizing would
  additionally require stabilising eight callbacks per pane. That is ritual
  memoization for sub-millisecond savings once a minute.
- **Skipping Home's derivation entirely during playback.** Tempting, and the audit
  suggested it — but Multiview's `EventPicker` consumes `homeFeed` while Multiview is
  active, so skipping would break a live surface. With the pass now 15× cheaper and
  interruptible, the remaining benefit does not justify a behaviour change.
- **Sports freshness is untouched.** The two kinds of freshness are already properly
  separated: Effect 1 (network) keys on `fetchKey` only; Effect 2 (local derivation)
  keys on `channels`/`identityIndex`. A playlist generation re-runs local
  broadcaster/channel availability **without** issuing a fixture request — asserted by
  a new test that counts API calls.

---

## Multiview findings

Profiled at 1, 2, 3 and 4 active panes, with a generation install driven through each
configuration five times in a row (an hour of refreshes at the real cadence,
compressed).

- **No pane restarts, at any pane count.** Same `Player` instances, same `<video>`
  elements, no second `load()`.
- **H1 is closed.** `MultiviewPaneVideo`'s source-sync effect calls
  `controller.selectSource()` — a real reload — on an external `pane.sourceIndex`
  change. The rule is now enforced by test rather than by nothing re-resolving:
  a generation install must not touch `MultiviewSession`, and the pane resolver's deps
  remain `[pane.assignmentId]` alone.
- **Audio owner and mute state are unchanged**, and exactly one pane stays unmuted.
- **Adding a pane does not restart siblings; removing one does not restart survivors.**
- **Maximize/restore is unaffected** — it is a plain mount/unmount keyed on
  `assignmentId`, which a generation never changes.
- **Render cost** (see above): 0.17–0.55 ms per unrelated re-render, not pane-count
  dependent within noise.

---

## Image/paint changes

Followed the audit's finding and its codec recommendation. The ten Match hero banners
and `test_image` are photographic, **alpha-free** (`hasAlpha: no`, 24-bit RGB) and were
shipped as PNG — the wrong codec: PNG must inflate and un-filter the whole surface,
markedly more expensive than JPEG decode on a weak SoC, at ~8× the bytes.

**Converted to JPEG q82. Not WebP, not AVIF** — Tizen WebKit support varies by TV
model year and this is a beta on real hardware; JPEG is universally safe and captures
nearly all of the win. Dimensions unchanged (2172×724, ~1.13× the 1920 display width).

The audit warned about banding in the dark centre band where crests and team names
sit, so that was measured rather than eyeballed — a per-pixel diff against the
original:

| Quality | File | Whole image mean \|Δ\| | Dark centre band mean \|Δ\| | Centre band max \|Δ\| |
|---|---|---|---|---|
| q78 | 264 KB | 1.59 | 0.71 | **5 / 255** |
| **q82** | **275 KB** | **1.56** | **0.71** | **5 / 255** |
| q88 | 348 KB | 1.48 | 0.69 | 5 / 255 |

The centre band is essentially untouched at any of these; q88 buys nothing for 27 %
more bytes. (The whole-image max of ~85 sits in the high-contrast stadium-light
region, which is where JPEG ringing lives and where it is imperceptible.)

| | Before | After |
|---|---|---|
| `public/backgrounds` | 19 MB | **2.8 MB** |
| `dist-tizen/ninety-tv.wgt` | 20.2 MB | **3.37 MB** |

`publicAssets.test.ts` (which asserts every `backgrounds/…` literal resolves to a real
file, and that nothing unreferenced ships) stays green, and
`competitionArtwork.test.ts` / `EventHeader.test.tsx` were updated together with the
path literals.

Nothing else in §14 needed action: heroes are already applied one at a time as a CSS
`background-image` on the Event Details header only, so no asset is decoded for a
screen that does not need it; and the animated-focus paint costs the audit flagged
were already removed by the navigation session.

---

## Before/after measurements

All figures are dev Mac (Darwin 25.2.0, Node 24.15.0), against a synthetic
30,925-channel playlist. **Assume 3–6× slower on the target TV.** No physical-hardware
number appears anywhere in this report.

### Playlist build (per sync)

| | Before | After |
|---|---|---|
| Main-thread blocking | **429 ms**, one task | **~70 ms** (structured clone), Worker path |
| Off-thread | — | ~430 ms |
| Longest single main-thread task | 429 ms | ~67 ms |
| Fallback when no Worker | n/a | 429 ms, one task — i.e. exactly today's behaviour |

### Home local matching (per 60 s refresh, same harness both sides)

| PPV/unmapped bucket | Events | Before | After | Factor |
|---|---|---|---|---|
| 3,100 | 30 | 684 ms | **53 ms** | 12.9× |
| 7,750 | 30 | **1,876 ms** | **128 ms** | 14.7× |
| 15,475 | 30 | 3,122 ms | **278 ms** | 11.2× |
| 7,750 | 1 | 55 ms | 11 ms | 5.0× |

And the total is now *sliced*: no single uninterrupted stretch exceeds ~8 ms plus one
event, instead of the whole figure landing in one task.

### Multiview re-render (unrelated parent update)

| Panes | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| ms/render | 0.55 | 0.44 | 0.29 | 0.17 |

### `benchmark:channel-index`, 30,925 channels

| | Audit baseline | Nav session | Now |
|---|---|---|---|
| `mergeChannelSources` | 402.972 ms | 397.6 ms | **385.6 ms** |
| `ChannelIndex` construction | 77.177 ms | 83.0 ms | **71.1 ms** |
| `getEntry` (µs) | 0.019 | 0.030 | **0.017** |
| `getChannelsForCategory` (µs) | 0.094 | 0.108 | **0.096** |
| O(1) proof at 15.5× size | 0.769× / 1.490× | 1.57× / 1.63× | **0.808× / 1.578×** |

No regression. `mergeChannelSources`' own cost is unchanged by design — the win is
that it no longer runs on the main thread, not that it got faster.

### Bundle

| Chunk | Before | After |
|---|---|---|
| `index` | 256.28 kB | 261.23 kB |
| `playlistBuildWorker` (new) | — | 7.0 kB, own chunk |
| `hls` / `mpegts` | unchanged (dynamic) | unchanged |

---

## Regression tests

**1,676 tests, 116 files, all passing** (from 1,598 at the start of this session —
**78 added**).

New files:

| File | What it pins |
|---|---|
| `data/playlists/playlistSyncPolicy.test.ts` | cadence inside the 10–15 min band; never-synced is due; recently-synced is not; launch/manual always run; backoff 1×/2×/4×/cap; **no reachable failure sequence retries tighter than the base interval**; jitter centred on zero; validation incl. the manual override |
| `data/playlists/playlistSyncCoordinator.test.tsx` | 20 end-to-end tests through the real hook — see below |
| `data/playlists/playlistBuildWorker.test.ts` | Worker/synchronous byte-equality (channels *and* ids) on a 2,000-channel playlist with quality variants; all three degradation modes; a data error does not trigger a redundant main-thread parse |
| `core/async/sliceWork.test.ts` | the yield rule, with clock and event loop injected |
| `features/multiview/multiviewGenerationIsolation.test.tsx` | isolation at 1/2/3/4 panes; add/remove pane |
| `features/channels/VirtualChannelList.generation.test.tsx` | window/focus preservation; deterministic fallback; category switch still resets |
| `features/eventDetails/EventDetailsScreen.generation.test.tsx` | PPV discovery, no loading flash, focus preserved, array-identity does not re-match, failure keeps results, loading resolves on a failed re-run |

Requirement §17, item by item:

| Required | Where |
|---|---|
| cached playlist renders before startup refresh finishes | `coordinator › startup` |
| startup schedules/starts refresh | `coordinator › startup` |
| successful refresh atomically installs new generation | `coordinator › atomic install` |
| failed refresh retains old generation | `coordinator › atomic install` |
| concurrent triggers deduplicate | `coordinator › no duplicate, no overlapping sync` |
| recent successful sync skips unnecessary duplicate refresh | same |
| stale resume triggers refresh / fresh resume does not | `coordinator › resume` |
| periodic stale sync works | `coordinator › no duplicate…` |
| long Player session exit triggers stale check | `coordinator › the playback gate` |
| active Player does not remount across generation replacement | `ChannelPlayerScreen.playerIdentity` |
| active source URL unchanged | same (`load()` call log) |
| active quality unchanged | same (started on `initialSourceLabel`, never re-loaded) |
| Multiview panes remain unchanged | `multiviewGenerationIsolation` (1–4 panes) |
| new PPV channel becomes discoverable | `coordinator`, `EventDetailsScreen.generation` |
| Event Details can respond appropriately | `EventDetailsScreen.generation` |
| Home local availability uses new generation | `useHomeFeed › reaction to a playlist generation install` |
| Channels preserves focus if item survives | `VirtualChannelList.generation` |
| removed focused item gets deterministic fallback | same |
| channel-index and virtualization tests protected | `channelIndex.test.ts` (+2), `virtualWindow.test.ts` untouched |

Three of the new tests were verified to **fail** when the fix they cover is reverted
(the `listKey` re-anchoring, the connection-edit guard, and the `stateRef` commit
race), so they discriminate rather than merely pass.

---

## Build results

| Command | Baseline (audit) | Nav session | Now |
|---|---|---|---|
| `npm test` | 106 files / 1,565 | 109 / 1,598 | ✅ **116 files / 1,676** (10.3 s) |
| `npm run lint` | 0 errors, 2 warnings | 0 errors, same 2 | ✅ **0 errors, the same 2 pre-existing warnings** |
| `npm run build` | 402 ms | 378 ms | ✅ 308 ms |
| `npm run build:tizen` | ✅ 19 MB | ✅ | ✅ **3.37 MB** |
| `VITE_PERF_DIAGNOSTICS=1 npm run build:tizen` | ✅ | ✅ | ✅ 3.37 MB, diagnostics retained |
| `npm run benchmark:channel-index` | see above | see above | ✅ no regression |

Both lint warnings are pre-existing and deliberate; the `exhaustive-deps` one on
`EventDetailsScreen` is documented in the source (re-deriving the ranking on every
favourite toggle would reshuffle the list mid-navigation) and has its own test.

New perf marks available in a diagnostic build (`window.__ninetyPerf`):
`playlist:sync-request`, `playlist:download`, `playlist:parse` /
`playlist:parse-main-thread` (the name says which path ran),
`playlist:build-worker-round-trip`, `playlist:build-worker-compute`,
`playlist:install`, `playlist:install-deferred`.

---

## Samsung TV validation checklist

**Nothing below has been run on hardware.** Build with
`VITE_PERF_DIAGNOSTICS=1 npm run build:tizen`, sign, install, then pull
`copy(JSON.stringify(window.__ninetyPerf))` via the Tizen remote debugger.

### The required end-to-end scenario

1. Start Ninety with a cached provider playlist connected.
2. **Home appears without waiting for the network sync.** Read `playlist:hydrate`.
3. Automatic provider sync starts. Read `playlist:sync-request` →
   `playlist:download` → `playlist:parse` → `playlist:install`.
   **Confirm the mark is `playlist:parse`, not `playlist:parse-main-thread`** — the
   latter means the Worker did not construct on this TV and everything below is being
   measured on the fallback path.
4. Start a stream.
5. Force another sync while video plays (shorten `PLAYLIST_REFRESH_INTERVAL_MS`, or
   suspend/resume the app past the interval).
6. **Video never pauses or reloads.**
7. **Audio never interrupts.**
8. **Source and quality are unchanged** (open the OSD's Quality/Source menu — the
   current pick must be the same one).
9. Exit the Player. New channels should already be installed — Settings should have
   shown *Update ready* during playback, and the badge should clear on exit.
10. **Newly added provider channels are visible in Channels without a restart.**
11. Open an event whose PPV source appeared in that refresh.
12. **The new stream resolves and plays.**
13. Repeat 4–12 with 2, 3 and 4 Multiview streams.

### The measurements this session could not take

| # | What | Why it matters |
|---|---|---|
| **M1** | `playlist:build-worker-round-trip` **while a stream is playing**, plus any correlated `longTasks` entry | This is the one number that decides `PREPARE_DURING_PLAYBACK`. Desktop is 67 ms; if the TV shows a correlated long task that coincides with a visible input stall, flip the constant to `false` (one line, documented in place). |
| M2 | `home:local-match` on Home for 5 minutes, then again during playback | Confirms the 15× improvement lands on real silicon. Expect ~5–10× the dev-Mac figures, not the old seconds-long blocks. |
| M3 | Real PPV/unmapped bucket size: `window.__ninetyExportChannels.filter(c => !c.hasEpgChannelId).length` (dev build) | Selects which row of the before/after table actually applies to this provider. |
| M4 | Confirm `__ninetyPerf.longTasks` is non-empty at *some* point | If it stays empty through a known-heavy operation, the observer is unsupported on this WebKit and manual marks are the only signal — say so rather than reading silence as success. |
| M5 | Event Details open latency, before/after the JPEG conversion | The artwork win is package size **and** decode cost; only the TV can confirm the second half. |

### Survival checks

- **Channels deep-scroll.** Scroll to ~row 4,000 in a large category, trigger a
  refresh, confirm position **and** focus are preserved — including when focus is on a
  row's favourite **star** rather than the row itself.
- **Event Details.** Sit on a match's stream list at row 5, trigger a refresh: no
  "Finding the best streams…" flash, no focus jump, and any newly added PPV row simply
  appears.
- **Settings.** During playback the playlist should read *Update ready*; leaving the
  Player should turn it into a normal *Last synced* line.
- **Provider failure.** Disconnect the TV's network for ~40 minutes with the app open:
  channels stay available throughout, Settings shows *Sync failed*, and reconnecting
  recovers on the next attempt without a restart.
- **Full regression sweep** — everything in the navigation report's §E is unchanged by
  this session and should still behave exactly as it did.

---

## Remaining risks

1. **`PREPARE_DURING_PLAYBACK` is a judgement call made without hardware.** The fetch
   half's ~67 ms clone (desktop) is an estimated 200–400 ms on TV, once per 12
   minutes, while a stream plays. The reasoning for keeping it is in the report and in
   the source, the flip is one line, and M1 is the measurement that settles it. This is
   the single most likely thing in this session to need changing after a TV run.
2. **jsdom has no layout.** Every `getBoundingClientRect` returns 0×0, so no geometric
   navigation claim is proven. The Channels and Event Details focus tests deliberately
   assert only explicit, non-geometric relationships (which keys exist, which key is
   current) for that reason.
3. **The Worker is only proven on desktop.** The chunk is emitted correctly in the
   Tizen build and the existing `channelIdentityWorker` is known to run on the target,
   which is strong evidence — but not proof. The fallback is what makes this a
   performance risk rather than a correctness one, and step 3 of the checklist reads
   the mark that tells you which path ran.
4. **The shrink guard's 25 % threshold is a judgement call.** Too tight and a genuine
   catalogue reorganisation is rejected until the viewer syncs manually; too loose and
   a partial download installs. Manual sync is the deliberate escape hatch, and the
   error message points at it.
5. **Held generations are not persisted.** A generation prepared during a two-hour
   match and never installed (because the app was killed from the Player) is lost, and
   the next launch re-downloads. Deliberate — persisting it would put the on-disk cache
   ahead of what the app is showing, which is how a cold launch ends up with new
   channels under a stale generation id and a wrong identity-resolution cache hit.
6. **`useHomeFeed` still derives while the Player is up.** Now ~128 ms rather than
   ~1.9 s, and sliced into ≤8 ms stretches, but not zero. Skipping it would break
   Multiview's `EventPicker`; revisit only if M2 shows it is still visible.
7. **Multiview `React.memo` was measured and rejected.** If a future change makes the
   pane subtree materially heavier, that decision should be re-measured rather than
   assumed to still hold — the number is in this report so the comparison is possible.
