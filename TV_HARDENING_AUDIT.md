# Ninety TV — Hardening Audit

**Date:** 2026-08-27
**Branch:** `fix/ci-node-version` (HEAD `b91f404`, working tree clean at audit start)
**Scope:** audit only. No behavioural change was committed. Two throwaway benchmark
scripts and one throwaway vitest probe were written, run, and deleted.

This document is written for the *next* engineering sessions. Everything below was
traced in the current source or measured; where something is inferred rather than
proven, it says so explicitly.

---

## Executive summary

Ninety's navigation architecture is in much better shape than a codebase this size
usually is. `useModalFocusScope`, `backHandler`'s LIFO stack, `focusRecovery`,
`VirtualChannelList`, `ChannelIndex` and the `usePlayerSession` mount-once controller
are all genuinely well-built, and several of them already defend against exactly the
failure modes this audit was asked to look for. **Most of what follows is narrow and
fixable; none of it is architectural rework.**

The five things that actually matter:

1. **P0 — The Player can be exited by the first OK press, with no visible UI.**
   While the OSD is hidden it is `opacity: 0` but still fully laid out, in the DOM, and
   registered with spatial navigation. Focus is deliberately parked on the toolbar
   (at mount, and again after every 6-second idle auto-hide). Norigin's keydown
   listener runs *before* the screen's own "any key reveals the OSD" listener, so a
   single OK both reveals the OSD **and** fires the focused button — which is
   `Channel List` → `onBack()`. Confirmed at runtime (§ Confirmed issues 1).

2. **P0 — Match View's top stream is logically focused but visually ambiguous.**
   Logical focus is *correct*. The problem is purely CSS: `.stream-row.top-pick` uses
   `border-color: var(--accent)` at rest, and `--accent` and `--border-focus` are the
   **same colour** (`#76f04b`). So a top pick at rest already wears the app's focus
   border. Focusing it adds only `box-shadow: 0 0 0 1px var(--accent)` — a 1px ring
   outside an already-accent 1px border, under an existing 24px accent glow. Row 2 by
   contrast goes from a near-invisible blended border to full accent, which is why
   pressing Down "works normally". This is a self-inflicted collision, and the repo
   already contains the correct pattern to fix it (§ Focus/navigation architecture).

3. **P1 — Home's background refresh does hundreds of milliseconds of unbroken
   main-thread work every 60 seconds, on every screen including the Player.**
   Measured: **417 ms in one task** for 30 near-term events against a realistic
   30,925-channel playlist — on a dev Mac. `matchViaPpvChannelName` re-folds the entire
   PPV/unmapped channel bucket per event, and the three free match stages are all
   synchronous, so `Promise.all` never yields. Linear in both events and bucket size
   (§ Performance findings).

4. **P1 — Playlists are never refreshed after launch.** There is no periodic refresh,
   and no launch-time refresh for a playlist that already has a usable cache — only
   manual Settings → Sync, and automatic recovery for playlists with *no* cache. A
   session started at 14:00 is still serving the 14:00 playlist at 22:00. This directly
   fails the PPV/event-channel freshness requirement.

5. **Good news on the hardest requirement:** active playback is **already** isolated
   from playlist replacement. `usePlayerSession` builds its controller once per mount
   and never reads props again; Multiview keys panes and resolvers on `assignmentId`
   only. Verified by reading, and already covered by
   `ChannelPlayerScreen.playerIdentity.test.tsx`. The scheduler work in Session 3 must
   *preserve* this, and there are two specific places where a naive implementation
   would break it (§ Playlist lifecycle).

Separately: **the shipped `.wgt` is 19 MB, of which 19 MB is background artwork and
1.4 MB is all the JS and CSS combined.** Ten Match hero PNGs at 2172×724 with no alpha
channel, 1.5–2.1 MB each. These should be JPEGs.

---

## Confirmed issues

### 1. Hidden Player OSD owns focus; first OK exits playback — **P0**

**Files:** [ChannelPlayerScreen.tsx](src/features/player/ChannelPlayerScreen.tsx),
[ChannelPlayerScreen.css](src/features/player/ChannelPlayerScreen.css)

The OSD's hidden state is visual only:

```css
/* ChannelPlayerScreen.css:20-40 */
.player-overlay {
  position: absolute; inset: 0; display: flex;   /* fully laid out */
  opacity: 0;
  pointer-events: none;                          /* mouse only — not D-pad */
  transition: opacity 200ms …, transform 200ms …;
}
```

`pointer-events: none` does nothing for spatial navigation. All six toolbar buttons
keep real geometry, stay mounted, and stay registered focusables.

Focus is *deliberately* placed there while hidden, in two places:

- [ChannelPlayerScreen.tsx:363-365](src/features/player/ChannelPlayerScreen.tsx#L363-L365) — mount effect, `setFocus(TOOLBAR_FOCUS_KEY)`
- [ChannelPlayerScreen.tsx:325-330](src/features/player/ChannelPlayerScreen.tsx#L325-L330) — `hideMenu()`, which the 6 s idle timer calls

`TOOLBAR_FOCUS_KEY` is a `trackChildren` container with no `preferredChildFocusKey`,
so norigin resolves it to the child closest to the origin — the **first** toolbar
button, `Channel List`, whose `onSelect` is `onBack`.

**Ordering, traced through the library:**
`node_modules/@noriginmedia/norigin-spatial-navigation-core/dist/index.mjs:205-234`
binds `window.addEventListener('keydown', …)` inside `init()`, which
[main.tsx](src/main.tsx) calls *before* `createRoot().render()`. The screen's own
reveal listener ([ChannelPlayerScreen.tsx:394-402](src/features/player/ChannelPlayerScreen.tsx#L394-L402))
registers later, in a `useEffect`. Same node, same phase → **norigin fires first.**
Norigin does call `event.stopPropagation()`, but that does not stop other listeners on
the *same* node (that would need `stopImmediatePropagation`), so the reveal listener
still runs afterwards.

**Runtime proof.** A throwaway probe rendered the real component and reported:

```
OSD classes at mount:                        player-overlay hidden
toolbar buttons in DOM while OSD hidden:     6
first toolbar button label:                  ☰Channel List
OK pressed with OSD hidden -> onBack called: 1 times
```

and, in a second case, that the same single press left the overlay as
`player-overlay visible` — i.e. **one press both revealed the OSD and fired the
invisible action.**

*Honest caveat:* jsdom has no layout (every rect is 0×0), so the mount effect's
`setFocus(TOOLBAR_FOCUS_KEY)` did **not** resolve to a child in that environment; the
probe had to drive focus into the toolbar explicitly. The *hazard* (an invisible
focused button fires on OK) is proven; the *precondition* (that the toolbar wins focus
on a real device with real geometry) follows from norigin's origin-closest child
resolution but should be confirmed on hardware — see § Physical Samsung validation.

The dominant real-world path is not mount, it is **idle auto-hide**: watch a match →
OSD hides after 6 s → `hideMenu()` re-parks focus on the toolbar → the next OK press
exits the Player. This is likely to read to a beta tester as "the app randomly quits
playback".

**Related, same root cause, lower severity:** `ArrowRight` while hidden also both
reveals the OSD *and* moves focus, so the OSD appears with the second button focused
rather than the first — an invisible focus move.

### 2. Match View top pick is logically focused but visually ambiguous — **P0**

**Files:** [EventDetailsScreen.css:516-575](src/features/eventDetails/EventDetailsScreen.css#L516-L575),
[EventDetailsScreen.tsx:135-171](src/features/eventDetails/EventDetailsScreen.tsx#L135-L171),
[StreamRow.tsx:187](src/features/eventDetails/StreamRow.tsx#L187),
[tokens.css](src/core/designsystem/tokens.css)

**Logical focus is correct — the reported behaviour is not a focus bug.**
`topPickFocusKey` is derived from the ranked partition, used as both
`preferredChildFocusKey` and an explicit `setFocus` on the `loading → ready`
transition, keyed on `state.status` alone so it fires exactly once. Pressing OK
correctly opens the first stream. That half of the source investigation holds up.

The failure is entirely in CSS. From `tokens.css`:

```
--accent:       #76f04b;
--border-focus: #76f04b;   /* identical value */
```

and from `EventDetailsScreen.css`:

| state | border | box-shadow |
|---|---|---|
| ordinary row, at rest | `color-mix(--border 55%, --surface-primary)` — near-invisible | none |
| ordinary row, **focused** | `var(--accent)` | `0 0 0 1px var(--accent)` |
| **top pick, at rest** | `var(--accent)` ← *already the focus border* | `0 0 24px -10px accent@55%` |
| top pick, **focused** | `var(--accent)` (unchanged) | `0 0 0 1px accent, 0 0 24px -10px accent@55%` |

So focusing the top pick changes **one thing**: a 1px accent ring, drawn immediately
outside a border that is already the same accent colour, on top of a 24px accent glow
present in both states. At 1920×1080 across a living room that is not a perceivable
state change. Focusing row 2 changes the border from near-invisible to bright green —
a large change, which is exactly why "press Down and it looks normal."

Compounding it: the delta that *does* exist is animated in over `160ms`
(`transition: border-color 160ms, box-shadow 160ms`), so even that 1px ring fades
rather than snapping.

**The repo already states the correct principle**, in
[onboardingShared.css:300-311](src/features/onboarding/onboardingShared.css#L300-L311):

> *"Selected reads as a quiet, tinted state; only the checkbox is actually green.
> Filling every selected card with accent … would stop focus from being the loudest
> thing on screen."*
> `.pick-card.selected { border-color: #33513a; }` ← a **dimmed** green
> `.pick-card.focused { background: var(--surface-focus); border-color: var(--border-focus); }`

`.stream-row.top-pick` is the one place in the app that violates that rule.

**Secondary (minor, real):** the `loading → ready` `setFocus` can race a user keypress
landing in the same frame — during loading the only focusable is Back, so a user
pressing Down as matches resolve may have their press resolved against either tree.
Sub-frame window; fix opportunistically, not urgently.

> **[Corrected 2026-08-27, Session 2 — see TV_NAVIGATION_HARDENING_REPORT.md]**
> "During loading the only focusable is Back" was **wrong**, and so was the source
> comment it was read from. `useFocusable({ focusKey: BACK_FOCUS_KEY })` was a bare call
> in `EventDetailsScreen`'s body; hooks run before JSX, so the ambient `FocusContext`
> there is App's, not `focusKey` — Back registered as a **sibling** of
> `event-details-screen`, never a child of it. `getNextFocusKey` therefore found *no
> focusable children at all* during loading, ignored the container's
> `preferredChildFocusKey: 'event-details-back'` fallback, and resolved to the container
> itself: an element with no `onEnterPress`. Focus was effectively nowhere, and reaching
> the on-screen Back button depended on a geometric search across the whole screen root.
> (The hardware Back key was unaffected — it goes through `backHandler`, not focus.)
> Fixed by extracting `BackButton` into a component rendered inside the provider; the
> race guard was implemented as well.

### 3. Home's 60 s refresh blocks the main thread on every screen — **P1**

**File:** [useHomeFeed.ts:429-596](src/data/sports/useHomeFeed.ts#L429-L596),
[channelMatch.ts:225-259](src/data/sports/channelMatch.ts#L225-L259)

Effect 2 runs `matchChannelsForEvent` over every near-term event on **every** refresh
(60 s interval + visibility regain + Player exit), gated only on
`document.visibilityState === 'visible'` — which is true during full-screen playback
and during 4-pane Multiview.

`matchChannelsForEvent`'s three free stages are all **synchronous**, and with
`allowNetworkFallback: false` (Home's setting) the function returns before its first
`await`. So `Promise.all(nearTerm.map(...))` executes every event's matching
back-to-back **in a single main-thread task** with no yield.

The expensive stage is `matchViaPpvChannelName`, which iterates
`index.getPpvOrUnmappedChannels()` — itself a fresh array copy — and calls
`foldForMatching(channel.name)` per channel. `foldForMatching` is
`[...text].map(...).join('').toUpperCase()`: three allocations plus O(len) work, per
channel, **per event**.

**Measured** (dev Mac, 30,925-channel playlist, `Channel[]` built directly so the
unmapped fraction is controlled rather than a synthetic-generator artifact):

| unmapped share | PPV/unmapped bucket | 1 event | 10 events | 30 events |
|---|---|---|---|---|
| 10 % | 3,100 | 7.4 ms | 56 ms | **177 ms** |
| 25 % | 7,750 | 15.4 ms | 132 ms | **417 ms** |
| 50 % | 15,475 | 33.0 ms | 285 ms | **861 ms** |

Perfectly linear in both dimensions, as predicted. On TV-class silicon assume 3–6×
slower: **roughly 1.2–5 s of unbroken main-thread block every 60 seconds**, while a
stream is decoding.

The `home:local-match` perf mark already brackets exactly this work, so it can be
confirmed on-device with no new instrumentation.

### 4. Playlists are never refreshed after launch — **P1**

**File:** [usePlaylistLibrary.ts:152-203](src/data/playlists/usePlaylistLibrary.ts#L152-L203)

The hydration effect only calls `recoverOne` for `result.needsRecovery` — playlists
with a refetchable source but **no usable cache**. A playlist that hydrated
successfully from cache is never resynced automatically. There is no interval, no
visibility-change hook, no resume hook. `resyncPlaylist` / `resyncAll` exist but are
only reachable from Settings.

Consequence: PPV/event channels added by the provider after launch are invisible for
the rest of the session. Returning from a two-hour match leaves the viewer on a
two-hour-old playlist — the exact scenario the requirement names.

### 5. `.wgt` is 93 % background artwork — **P1**

`dist-tizen/ninety-tv.wgt` = **19 MB**. Staging breakdown:

```
19M  .tizen-staging/backgrounds     ← all of it
1.4M .tizen-staging/assets          ← every JS + CSS chunk
176K .tizen-staging/flags
```

The ten Match hero images (`public/backgrounds/Match_hero/*.png`), via `sips`:

- **2172×724**, `hasAlpha: no`, `samplesPerPixel: 3` (24-bit RGB, no transparency)
- 1.5–2.1 MB each on disk
- decoded to RGBA32 in memory: 2172 × 724 × 4 = **~6.29 MB per image**

They are photographic banners with no alpha, delivered as PNG. That is the wrong
codec: PNG must zlib-inflate and un-filter the whole surface, which is markedly more
expensive than JPEG decode on a weak SoC, and costs ~8–10× the bytes. `test_image.png`
(1.6 MB, `GENERAL_BACKGROUND` in [mapEvent.ts:17](src/data/sports/mapEvent.ts#L17)) and
`f1.jpg` (360 KB, `staticBackground` in [leagues.ts:76](src/data/sports/leagues.ts#L76))
are both genuinely referenced — neither is orphaned.

Loading is lazy in the sense that the hero is applied as a CSS `background-image` on
the Event Details header only, one at a time
([EventHeader.tsx:54-57](src/features/eventDetails/EventHeader.tsx#L54-L57)) — so this
is a per-open decode cost and a package-size cost, not a startup cost.

### 6. `ROOT_FOCUS_KEY` is shadowed in four screens — **P2 (readability trap)**

[SettingsScreen.tsx:38](src/features/settings/SettingsScreen.tsx#L38),
[ScheduleScreen.tsx:18](src/features/schedule/ScheduleScreen.tsx#L18),
[PlaylistSetupScreen.tsx:19](src/features/setup/PlaylistSetupScreen.tsx#L19) each
declare a **local** `const ROOT_FOCUS_KEY = '<screen>-screen'` that shadows norigin's
exported constant of the same name. The values are correct and match App's
`SCREEN_FOCUS_KEYS`, so **there is no bug here** — but reading
`useFocusable({ focusKey: ROOT_FOCUS_KEY })` in these files strongly implies the
library constant and means the opposite. Rename to `SCREEN_FOCUS_KEY`.

---

## Device-dependent or suspected issues

These need a physical Samsung TV to confirm or refute. Do not fix them blind.

| # | Item | Why it needs hardware |
|---|---|---|
| D1 | Whether the Player's mount-time `setFocus(TOOLBAR_FOCUS_KEY)` actually resolves to `Channel List` | jsdom returns 0×0 rects, so norigin's origin-closest child pick is untestable off-device. The idle-auto-hide path is affected identically. |
| D2 | Perceived focus latency from the 200 ms `--motion-duration` on focus properties | 200 ms is fine on a desktop and often reads as sluggish on a TV, but this is a judgement call that has to be made *looking at the TV*. |
| D3 | Actual magnitude of the Home 60 s block | The 417 ms figure is dev-Mac. Read `window.__ninetyPerf` `home:local-match` on-device. |
| D4 | Real PPV/unmapped bucket size for a real provider playlist | Drives which row of the §3 table applies. Read via devtools on-device. |
| D5 | PNG vs JPEG decode cost for the Match hero | Measure Event Details open latency before/after conversion on the TV, not on a Mac. |
| D6 | Whether `longtask` PerformanceObserver is implemented on this Tizen WebKit | `startLongTaskObserver` feature-detects and silently no-ops. If unsupported, the long-task half of the diagnostics is simply absent and manual marks are the only signal. |
| D7 | Real parse+merge wall time for the user's own provider | §Performance measured 501 ms on a Mac for a synthetic 5.2 MB M3U. |

---

## Focus/navigation architecture

### Current strengths — preserve these

- **`useModalFocusScope`** ([useModalFocusScope.ts](src/core/platform/useModalFocusScope.ts))
  is the right abstraction and is used consistently: FilterPopup, EventPicker,
  PaneMenu, and both Player popups. It captures the opener, moves focus in, becomes
  the sole Back target, and on close restores the opener *only if it still exists*
  (`doesFocusableExist`) — the stale-key problem is already solved.
- **`backHandler`'s LIFO stack** with a stable per-mount wrapper closure
  ([useBackHandler.ts](src/core/platform/useBackHandler.ts)) — a background screen
  re-rendering cannot reorder itself above a modal. This is subtle and correct.
- **`focusRecovery.ts`** — pure, tested, and actually wired up at the places lists
  shrink (BrowseCascade country/category removal, CategoryChannelsScreen unfavourite).
- **`ChannelRow`** is the model implementation: explicit Left/Right/Up/Down targets
  rather than geometry, a derived stable star key, and — importantly —
  `focusable: showFavorite` so a CSS-hidden star is not a dead landing spot.
- **`VirtualChannelList`** caps mounted rows at `windowSize + 2·overscan` = 50 and
  handles the "no shift needed → focus directly" case that caused the physical-Samsung
  Favorites scroll bug.
- **Settings and onboarding remain the strongest focus implementations in the app**
  and should be treated as the reference, as the brief assumed.

### The one weakness: there is no written focus-state contract

Three different focus vocabularies are in use, and which one a surface gets appears
historical rather than decided:

| vocabulary | strength | used by |
|---|---|---|
| **A.** `background: surface-focus` + `border-color: border-focus` | strong (two channels) | Settings rows/rail/league cards, onboarding pick-cards/expanders/skip/back, Home scroll-chevron |
| **B.** offset ring `box-shadow: 0 0 0 3px <bg>, 0 0 0 5px border-focus` | strong | TopNav avatar, onboarding Continue, Home `watch-now` |
| **C.** border-colour only, 1px | weak | Home `.event-card`, Event Details `.stream-row` |
| **D.** background + 1.5px accent border + radius | strong | `ListRow`, `ChannelRow` |

And the non-focus states are inconsistent about whether they may borrow accent:

| surface | `selected`/`active` treatment | collides with focus? |
|---|---|---|
| `.settings-row.selected` | `background: surface-elevated` only | no |
| `.settings-league-card.selected` | `background: surface-elevated` only | no |
| `.pick-card.selected` | `border-color: #33513a` (dimmed green) + elevated bg | no — deliberately dimmed |
| `.list-row.active` / `.ch-row.active` | accent **text** colour only | no — different channel |
| **`.stream-row.top-pick`** | **`border-color: var(--accent)` + accent glow** | **yes — total collision** |

### Recommended contract (to adopt in Session 2)

Write this into `tokens.css` as a comment and apply it uniformly:

1. **`--accent` as a *border or ring* is reserved for FOCUS.** Nothing else may wear
   an accent border at rest.
2. **`selected` / `active` / `current`** express themselves via *surface elevation*,
   *text colour*, or a *dimmed* accent derivative (`#33513a`-style) — never the focus
   border. Precedent: `.pick-card.selected`.
3. **`recommended` / `top pick`** is the same class as `selected`: a tint plus a
   badge/label, never the focus vocabulary. Row order already carries most of the rank
   signal.
4. **Every focusable must change at least two visual channels on focus** (e.g.
   background *and* border), so that no single competing state can neutralise it.
   Vocabulary A or D by default; B where the control sits on artwork.
5. **Focus transitions must be immediate.** Transition non-focus properties as much as
   you like; `border-color`, `background`, `box-shadow` and `outline-color` on
   `.focused` should be `0ms` (or ≤ 60 ms). Currently 200 ms app-wide via
   `--motion-duration` and 160 ms in Event Details.
6. **Nothing invisible may hold focus.** A hidden container must either unmount its
   children or set `focusable: false` on them. `ChannelRow`'s `showFavorite` handling
   is the pattern; the Player OSD is the violation.

> **[Extended 2026-08-27, Session 2 — see TV_NAVIGATION_HARDENING_REPORT.md]**
> Two things this section understated:
>
> **a) `.stream-row.top-pick` is not the only accent-border collision.** The same shape
> was found on three more surfaces while applying the contract:
> `.league-pill.active` (Schedule — the selected league and the focused league were
> indistinguishable), `.toolbar-btn.active` (Player — an open Quality menu left two
> buttons wearing the full focus vocabulary), and `.fav-btn.active` (channel preview —
> a favorited-unfocused button read as more selected than a focused-unfavorited one).
> All four are fixed via a new `--border-selected` token.
>
> **b) A seventh rule is needed: focus MEMORY is module-global.** norigin stores
> `lastFocusedChildKey` on the container's entry in a module-level singleton keyed by
> focus key, so it *outlives the component*. Any screen where "reveal returns to where
> you were" matters must either own that memory itself (`saveLastFocusedChild: false`
> plus a per-mount ref, which is what the Player toolbar now does) or accept that a new
> mount can inherit the previous mount's target. Related: `focusOnPresetKey` is **on by
> default**, so a component mounting with the key the service currently considers focused
> is immediately focused — the same trap in the other direction.

### Per-surface navigation review

Everything below was checked for: initial focus, arrow behaviour, OK, Back, first/last
item, async ready, empty, error, dynamic removal, modal entry/exit, scroll-follow,
return-from-child.

| Surface | Verdict |
|---|---|
| **TopNav** | Fine. `downFocusKey` escape hatch for the setup screen where nothing sits under the avatar. |
| **Home** | Fine structurally (`forceFocus` on `watch-now`, `home-screen` trackChildren root). Weak focus visual on `.event-card` (vocabulary C). |
| **Schedule** | Good. Explicit pill↔fixture Up/Down wiring, `preferredChildFocusKey` falls back to Back while loading, explicit `setFocus(ALL_PILL)` on ready. Same ready-transition race shape as Event Details but far less visible. |
| **Event Details** | Logical focus correct; visual focus broken (§Confirmed 2). Explicit `onArrowUp` from first row → Back. Candidate-list toggle correctly moves focus before unmounting itself. |
| **Channels (BrowseCascade)** | The most hardened screen in the app. Level-keyed focus restoration incl. the `preview` case, explicit toolbar `downTarget` that follows search mode, `pickFallbackAfterRemoval` on both country and category removal. |
| **Favorites / Recently Watched** | Fine. `forceFocus` moves to Back when the list is empty; `pickFallbackAfterRemoval` on unfavourite. |
| **Search** | Fine. `isSearching` keyed off the raw query (instant mode switch), recompute debounced 200 ms. |
| **Filter popup** | Fine — `useModalFocusScope` with an explicit `preferredChildFocusKey`. |
| **Channel preview** | Fine. Selection is immediate; only media (100 ms) and EPG (250 ms) are debounced. Stable `PREVIEW_WATCH`/`PREVIEW_FAVORITE` keys. |
| **Player** | **Broken while OSD hidden** (§Confirmed 1). Back hierarchy itself is correct — see below. |
| **Multiview** | Fine. `isFocusBoundary`, panes keyed on `assignmentId`, `forceFocus` only applies at mount (verified in norigin: `addFocusable` runs in a `[]`-dep effect) so unrelated re-renders cannot steal focus back to pane 0. |
| **Multiview Event Picker / Pane Menu** | Fine — both on `useModalFocusScope`. |
| **Settings + dialogs** | Reference-quality. Rail↔pane wiring is explicit; Back restores to the opening avatar via App's `previousScreenRef`. |
| **Onboarding** | Reference-quality. |
| **Playlist setup / reconnect** | Fine. |

**Player Back hierarchy — satisfies the desired contract.** Popups register their
`useModalFocusScope` Back handler after (so above) the screen's, so:
`popup → close popup` ✓, `visible OSD → hideMenu()` ✓, `hidden OSD → onBack()` ✓.
One cosmetic wart: Back on a visible OSD *also* triggers the reveal listener, which
sees the stale `menuVisible === true` closure and schedules a pointless 6 s idle timer.
Harmless; fix while you're in there.

**Where geometry is relied on and an explicit relationship would be safer:**
- `setFocus(TOOLBAR_FOCUS_KEY)` in the Player (no `preferredChildFocusKey`) — this is
  precisely what makes the P0 land on `Channel List`.
- Norigin's default child pick inside `top-nav` and `home-screen` — low risk, both are
  simple single rows.

---

## Performance findings

### What is actually expensive

| Work | Measured (dev Mac) | When it runs | Blocking? |
|---|---|---|---|
| `mergeChannelSources` (30,925 entries) | **447 ms** | every connect / resync / recovery | **yes, one task** |
| `parseM3u` (5.2 MB, 30,925 entries) | 53 ms | same | yes, one task |
| **parse + merge total** | **501 ms** | same | **yes, one task** |
| `ChannelIndex` construction (30,925) | 77 ms | per playlist generation | **no** — `warmChannelIndexAsync` chunks at 2,000 with yields |
| Home local matching, 30 events @ 25 % unmapped | **417 ms** | **every 60 s, every screen** | **yes, one task** |
| `ChannelIndex.search` (30,925) | 0.60 ms | per debounced keystroke (200 ms) | no — fine |
| `getEntry` / `getChannelsForCategory` | 0.019 / 0.094 µs | per D-pad move | no — genuinely O(1) |

**The old "one remote press scans 30,000 channels" failure mode has not returned.**
The benchmark's own O(1) assertion holds: `getEntry` is 0.77× at 15× the playlist size.
`ChannelIndex`, the memoised `getChannelIndex` WeakMap, the frozen favourites-first
list order, the 100/250 ms preview debounces, the 200 ms search debounce, the windowed
list and the `preloadPlayerEngine` warm-up are all doing their jobs. **Do not remove
any of them.**

### Rendering / re-render behaviour

- **Player is immune to prop churn.** `usePlayerSession` memoises the controller on
  `[player]` where `player = useMemo(..., [])`; `sourceUrls`/`options` are read only at
  construction. `choices`/`entries`/`initialEntryIndex` are lazy `useState` initialisers.
  Already regression-tested.
- **Multiview panes are immune too** — `MultiviewPane` and `PaneResolver` are both keyed
  on `pane.assignmentId`, and `useMultiviewPaneResolution`'s effect deps are
  `[pane.assignmentId]` alone.
- **But both still *re-render*** on every `library.channels` change and on every
  `homeFeed` tick (a new `HomeFeedState` object every 60 s propagates through App into
  `MultiviewScreen`'s `homeFeed` prop and `ChannelPlayerScreen`'s `channels` prop).
  Cheap in isolation; not free while four decoders are running. Worth `React.memo` on
  `MultiviewPane`, and worth not passing `homeFeed` down at all unless the picker is
  open.
- **`updateFocusable` runs on nearly every render** for every focusable, because
  norigin's second effect depends on the `onEnterPress`/`onArrowPress` handler
  identities and call sites pass fresh inline closures. Bounded by virtualisation to
  ~50 rows, so this is a P2 note, not a problem.

### Bundle

`npm run build` produces:

```
index    256.28 kB (gzip 79.66)   ← main
hls      516.07 kB (gzip 159.25)  ← dynamic import, warmed on Channels open
mpegts   260.59 kB (gzip 60.20)   ← dynamic import
platform  63.71 kB (gzip 20.49)
… 20 further route/feature chunks
```

Engine chunks are correctly dynamic (`await import('hls.js')` / `'mpegts.js'`) with a
targeted `preloadPlayerEngine` warm-up sampled from one real channel URL. This is
already right. The 500 kB warning is on `hls.js` itself and is not actionable.

---

## Playlist lifecycle

### Current architecture, traced

```
cold launch
  └─ usePlaylistLibrary hydration effect (never blocks first paint)
       ├─ hydratePlaylistLibrary()            → cached channels per playlist
       ├─ install(playlists, loaded)
       │    ├─ combinePlaylistChannels()      → new Channel[] reference
       │    ├─ warmChannelIndexAsync()        → chunked, OFF the install render
       │    └─ setState({...})                → ONE atomic swap
       ├─ setHydration('done')
       └─ for (needsRecovery)  await recoverOne()   ← sequential, deliberately
                                                      ONLY for playlists with no cache

manual Sync (Settings)  → resyncPlaylist / resyncAll → syncPlaylist → install()
add / replace / remove  → commitPlaylistChannels → install()

periodic refresh        → ✗ DOES NOT EXIST
launch refresh (cached) → ✗ DOES NOT EXIST
resume refresh          → ✗ DOES NOT EXIST
```

**What is already right and must be kept:**

- `install()` is genuinely atomic — playlists, loaded, channels and generationId land
  in one `setState`, so no consumer can observe a torn combination.
- The index is pre-warmed *before* the state swap, so a ~30 k index build never lands
  on the same task as the screen transition.
- Failure never destroys the old playlist: `resyncPlaylist` only writes on success and
  its error message correctly says "existing playlist kept".
- `stateRef` re-reads after every await, so interleaved operations don't drop each
  other's writes.
- Recovery is sequential, not parallel — correct for a low-powered TV.

### Playback isolation — verdict: **already guaranteed, with two future hazards**

For the "an active stream must NEVER be disrupted" requirement, as it stands today:

| requirement | solo Player | Multiview |
|---|---|---|
| no reload / remount | ✓ controller memoised on `[]` | ✓ keyed on `assignmentId` |
| no URL change | ✓ `entries` frozen at mount | ✓ `sourceUrls` read once |
| no re-rank of the active source | ✓ | ✓ resolver deps are `[assignmentId]` |
| no quality change / failover / video / audio reset | ✓ | ✓ |
| no focus reset | ✓ | ✓ `forceFocus` is mount-only |

**Two places a naive Session-3 scheduler would break this:**

- **H1 — `MultiviewPaneVideo`'s source-sync effect**
  ([MultiviewPane.tsx:152-158](src/features/multiview/MultiviewPane.tsx#L152-L158))
  calls `controller.selectSource()` — a real reload — whenever `pane.sourceIndex`
  changes externally. It is safe today only because nothing re-resolves panes on a
  playlist change. **If a refresh is ever wired to re-run pane resolution, every live
  pane reloads.** The rule for Session 3: a new generation must not touch
  `MultiviewSession`.
- **H2 — `VirtualChannelList`'s window reset**
  ([VirtualChannelList.tsx:79-83](src/features/channels/VirtualChannelList.tsx#L79-L83))
  fires `setWindowStart(0)` on any `channels` identity change. Since
  `channelsInCategory` is memoised on `[channelIndex, …]`, a new generation yanks a
  user browsing row 4,000 back to row 0 and strands focus on an unmounted key. Narrowly
  reachable today (a cold-launch recovery completing while Channels is already open);
  **guaranteed** once periodic refresh lands.
- **H3 — Event Details re-matches on `channels` identity**
  ([EventDetailsScreen.tsx:98](src/features/eventDetails/EventDetailsScreen.tsx#L98)):
  deps are `[event.id, channels, xtream, identityIndex]`, so a new generation resets
  the screen to "Finding the best streams…" *and* re-fires the
  `setFocus(topPickFocusKey)` effect — **yanking focus back to row 1 while the user is
  on row 5.** The effect is already correctly guarded against *score* ticks (keyed on
  `event.id`, not the event object); it is not guarded against playlist churn.
- **H4 — `useChannelIdentityIndex`** deps are `[channels, playlistGenerationId]`, so
  every generation triggers a full worker rebuild + projection. Correct for a genuine
  change; needs to be budgeted if refresh runs every 10–15 minutes.

### Target architecture for Session 3

```
cached playlist  →  app usable immediately            (already true)
      ↓
background provider refresh                            (new: launch + interval + resume)
      ↓
fully prepare the new generation OFF the live tree:
   download → parse → merge → warmChannelIndexAsync → build identity index
      ↓
atomic install, gated:
   - if a Player or Multiview session is ACTIVE → hold the generation, install on exit
   - else install immediately
```

The "prepare fully, then swap" half already exists inside `install()`. What is missing
is (a) the scheduler, and (b) the **active-playback gate**, which is the piece that
turns today's accidental isolation into a guaranteed one.

Cadence: every launch for resyncable playlists, then ~10–15 min while running, plus
`visibilitychange` on resume. Needs jittered backoff on failure and a hard "never
overlap" in-flight guard — `useHomeFeed`'s `inFlightRef` is a good local precedent.

---

## P0 — Session 2, before any performance work

| # | Issue | Where |
|---|---|---|
| P0-1 | Hidden Player OSD owns focus; first OK exits playback | `ChannelPlayerScreen.tsx` / `.css` |
| P0-2 | Match View top pick visually indistinguishable focused vs unfocused | `EventDetailsScreen.css` |
| P0-3 | Focus transitions animated over 160–200 ms | `tokens.css` + 8 CSS files |
| P0-4 | Adopt and document the focus-state contract; fix `.event-card` (vocabulary C) | `tokens.css`, `HomeScreen.css` |

## P1 — Session 3 — **DONE (2026-08-27), see TV_PERFORMANCE_PLAYLIST_REPORT.md**

> **Annotation, Session 3.** All five P1 items are implemented. Two places where this
> audit's analysis turned out to be incomplete, both found by measuring rather than
> reading:
>
> 1. **§3 named the wrong dominant cost in Home's matching pass.** `foldForMatching`
>    per channel is real (and is now precomputed as `ChannelIndexEntry.matchName`), but
>    it is the smaller half. The dominant cost was **un-memoized
>    `significantWords(teamName)` inside `textMatchesTeam`** — called once per
>    (channel, team) pair, i.e. ~465,000 times per refresh at 30 events against a
>    7,750-channel bucket, allocating ~7 objects each time. Memoizing it is most of the
>    15x win; the fold and the bucket copies are the rest.
> 2. **A latent bug not in this audit at all.** `usePlaylistLibrary`'s operations
>    re-read `stateRef.current` after an `await`, but `stateRef` was only advanced
>    during *render* — and a `setState` from a promise chain does not commit before
>    that chain's next microtask. The launch-sync pass this session added would have
>    silently discarded its own downloaded generation. `install()` and
>    `updateDefinitions()` now advance `stateRef` synchronously.
>
> Everything else in §P1 and in §Playlist lifecycle held up exactly as written,
> including all four hazards H1-H4, which are now closed and covered by tests.

## P1 — Session 3

| # | Issue | Where |
|---|---|---|
| P1-1 | Home 60 s refresh blocks the main thread on every screen | `useHomeFeed.ts`, `channelMatch.ts` |
| P1-2 | No playlist refresh after launch | `usePlaylistLibrary.ts` |
| P1-3 | Active-playback gate for generation install (H1–H4) | `usePlaylistLibrary.ts`, `App.tsx`, `EventDetailsScreen.tsx`, `VirtualChannelList.tsx` |
| P1-4 | 501 ms synchronous parse+merge | `mergeChannels.ts`, `connectPlaylist.ts` |
| P1-5 | 19 MB of PNG artwork | `public/backgrounds/Match_hero/` |

## P2 — Later

| # | Issue |
|---|---|
| P2-1 | `React.memo` on `MultiviewPane`; stop threading `homeFeed` into Multiview unless the picker is open |
| P2-2 | Rename shadowed `ROOT_FOCUS_KEY` → `SCREEN_FOCUS_KEY` in 3 screens |
| P2-3 | Event Details `loading → ready` focus race (sub-frame) |
| P2-4 | Player: Back on a visible OSD schedules a pointless idle timer |
| P2-5 | Resolve the two pre-existing lint warnings |
| P2-6 | Remove the temporary boot-diag hooks (`__ninetyBootMounted`) once beta is stable |

---

## Exact implementation map

### P0-1 · Hidden OSD must not hold focus

- **File:** `src/features/player/ChannelPlayerScreen.tsx`
- **Component:** `ChannelPlayerScreen`, `ToolbarButton`
- **Root cause:** the OSD is hidden by `opacity: 0` only, so its buttons keep geometry
  and focusable registration; focus is explicitly parked there at mount and by
  `hideMenu()`; norigin's window keydown listener runs before the screen's reveal
  listener, so one OK both reveals and activates.
- **Intended fix (in preference order):**
  1. Thread `focusable={menuVisible}` into every `ToolbarButton`'s `useFocusable` —
     the exact pattern `ChannelRow`'s `showFavorite` already uses. Nothing invisible
     stays a spatial-nav target.
  2. In the reveal listener, when `!menuVisible`, **consume the press**:
     `showMenu()` and `event.stopImmediatePropagation()` — but this only works if the
     listener is registered *before* norigin's, which it is not. So instead: gate the
     activation, not the event. With (1) in place there is nothing to activate, which
     is why (1) is the primary fix.
  3. Give the toolbar an explicit `preferredChildFocusKey` pointing at **Pause**, not
     `Channel List`, so that even a mis-ordered press cannot exit playback. Defensive,
     cheap, do it regardless.
  4. Keep `hideMenu()`'s `setFocus(TOOLBAR_FOCUS_KEY)` — it is still the right anchor
     once (1) makes the buttons unfocusable while hidden; verify focus lands correctly
     on the *next* reveal.
- **Regression risk:** *medium.* `focusable: false` on all toolbar buttons means that
  while hidden there is **nothing focusable on the Player screen at all**. Confirm
  that (a) the first keypress still reveals the OSD (it is a plain window listener, so
  yes — it does not need focus), and (b) focus resolves into the toolbar on reveal.
  This is the reason the mount-time pre-focus exists; it must be re-tested, not just
  re-read.
- **Tests required:**
  - New: OSD hidden + OK → `onBack` **not** called, overlay becomes visible.
  - New: OSD hidden + Right → focus does not move; overlay becomes visible.
  - New: idle auto-hide → OK → `onBack` not called.
  - New: OSD visible + OK on `Channel List` → `onBack` **is** called (don't break the real path).
  - Existing: `ChannelPlayerScreen.playerIdentity.test.tsx`, `…qualityVariants.test.tsx` must stay green.
  - Hardware: D1.

### P0-2 · Match View top-pick / focus collision

- **File:** `src/features/eventDetails/EventDetailsScreen.css`
- **Selectors:** `.stream-row.top-pick` (L551), `.stream-row.focused` (L566),
  `.stream-row.top-pick.focused` (L571)
- **Root cause:** `--accent` and `--border-focus` are the same colour; `top-pick`
  claims an accent border + accent glow at rest, leaving focus with only a 1px ring to
  distinguish itself.
- **Intended fix:**
  - `.stream-row.top-pick` — drop `border-color: var(--accent)` and the outer glow.
    Replace with the established `selected` vocabulary: a dimmed green border
    (`#33513a`, matching `.pick-card.selected`) plus the existing faint centre tint.
  - Consider moving the "top pick" claim to an explicit **badge** on the row
    (`StreamRow` already has a `.stream-row-meta` group) so rank is *stated* rather
    than encoded in a colour that competes with focus.
  - `.stream-row.focused` — upgrade from vocabulary C to D: add
    `background: var(--surface-focus)` alongside the accent border, so focus changes
    two channels.
  - `.stream-row.top-pick.focused` — should now simply be
    `.top-pick` tint + full focus treatment, with no special-casing needed.
  - **Do not touch** the `background-color` transition exclusion comment at L524-532 —
    it documents a real Chromium paint bug, not a preference.
- **Regression risk:** *low* (CSS only). Watch the multi-layer `background` shorthand
  + `color-mix` interaction called out in that comment.
- **Tests required:** no unit test can assert "looks focused". Rely on
  `StreamRow.test.tsx` for class application, and **hardware photo comparison**:
  top-pick unfocused vs top-pick focused vs row-2 focused, all three shot from ~3 m.

### P0-3 · Immediate focus feedback

- **Files:** `src/core/designsystem/tokens.css` (add e.g. `--motion-focus: 0ms`), then
  `TopNav.css:34,77`, `HomeScreen.css:309`, `EventDetailsScreen.css:533,798`,
  `onboardingShared.css:296`, `LeagueBrowser.css:100`, `PlaylistSetupScreen.css:186`,
  `SettingsScreen.css:89`, `MultiviewPane.css:9`, `BrowseCascadeScreen.css:210`.
- **Root cause:** `--motion-duration: 200ms` is applied directly to the properties that
  carry focus (`border-color`, `background`, `box-shadow`, `outline-color`, `color`).
- **Intended fix:** introduce `--motion-focus` and use it for focus-carrying
  properties only. Leave layout/opacity motion on `--motion-duration` —
  `BrowseCascadeScreen.css:102`'s `flex-basis 220ms` column animation is a deliberate
  layout transition and should stay.
- **Regression risk:** *low.* Purely perceptual; the risk is it now looks *harsh*,
  which is a tuning question for the TV (D2). Start at `0ms`, tune up to ~60 ms if it
  reads as jumpy.
- **Tests required:** none automated. Hardware A/B.

### P0-4 · Focus-state contract

- **Files:** `tokens.css` (document the six rules), `HomeScreen.css:312` (`.event-card`
  → vocabulary A or D), audit pass over the table in §Focus architecture.
- **Regression risk:** *low* if scoped to the two known vocabulary-C offenders. **Do
  not** restyle Settings/onboarding — they are the reference.
- **Tests required:** none automated; visual sweep of all 14 surfaces on hardware.

### P1-1 · Home refresh main-thread cost

- **Files:** `src/data/sports/useHomeFeed.ts` (Effect 2, L429-596),
  `src/data/sports/channelMatch.ts` (`matchViaPpvChannelName` L225-259),
  `src/data/channelIndex.ts` (`getPpvOrUnmappedChannels`)
- **Root cause:** per-event iteration over the whole PPV/unmapped bucket with a fresh
  `foldForMatching` allocation per channel; all three free stages synchronous, so
  `Promise.all` produces one unbroken task. Runs on a 60 s interval regardless of
  active screen.
- **Intended fix — four independent wins, in order of value:**
  1. **Precompute the folded name once per channel**, in `ChannelIndexEntry`. The entry
     already carries `foldedName` (plain lowercase) — add the `foldForMatching`
     uppercase fold beside it and have `matchViaPpvChannelName` read it. Turns
     `O(events × bucket × len)` into `O(events × bucket)` with zero allocation.
     Cheapest, biggest win, no behaviour change.
  2. **Stop copying the bucket.** `getPpvOrUnmappedChannels()` returns
     `[...this.ppvOrUnmappedChannels]` — one large array allocation per event. Expose a
     `readonly` view or an iterator.
  3. **Yield between events** in Effect 2 — chunk the `nearTerm` loop with the same
     `yieldToMainThread()` helper `warmChannelIndexAsync` already uses, so a long pass
     is interruptible rather than one 400 ms task.
  4. **Skip the whole pass while a Player or Multiview session is active.** Home is not
     on screen; nothing consumes the result until the user returns, and App *already*
     calls `homeFeedState.refresh()` on Player exit for exactly this reason.
- **Regression risk:** (1) and (2) are *low* — pure refactors with existing coverage in
  `channelMatch.test.ts`. (3) is *medium*: introduces interleaving where there was none;
  the `cancelled` guard already exists and must be re-checked after every yield.
  (4) is *medium* and is a **behaviour** change — live scores would stop updating
  behind the Player. Confirm this is acceptable before implementing; it may be better
  to keep the network fetch and skip only the local matching.
- **Tests required:** `channelMatch.test.ts` (unchanged results), `useHomeFeed.test.ts`
  (cancellation across yields; no state write after unmount), plus a new benchmark
  script mirroring the one used in this audit so the win is measurable. Hardware: D3, D4.

### P1-2 / P1-3 · Playlist refresh scheduler + playback gate

- **Files:** `src/data/playlists/usePlaylistLibrary.ts` (primary), `src/App.tsx`
  (must expose "is playback active"), plus the H2/H3 call sites.
- **Root cause:** no scheduler exists; and the current playback isolation is
  *incidental* (nothing re-resolves) rather than *enforced*.
- **Intended fix:**
  - Add a refresh scheduler in `usePlaylistLibrary`: on hydration completion for every
    `isResyncable` playlist, then a ~10–15 min interval, then on `visibilitychange`.
    Reuse the existing `inFlightRef` no-overlap pattern; add jittered exponential
    backoff on failure. Keep recovery sequential.
  - Add a **pending-generation gate**: when a prepared generation is ready and playback
    is active, hold it and install on playback exit. `App.tsx` already knows
    (`screen === 'player' || screen === 'multiview'`); thread a stable
    `isPlaybackActive` ref into the library rather than a prop that re-renders it.
  - **H2:** make `VirtualChannelList`'s reset effect distinguish "genuinely different
    list" from "same list, new generation" — key on a caller-supplied list identity
    (e.g. `${country}::${category}`) rather than the array reference.
  - **H3:** give Event Details' match effect a `playlistGenerationId` dep instead of
    `channels`, and suppress the `setFocus(topPickFocusKey)` effect when the transition
    was caused by a generation change rather than a fresh mount.
  - **H1:** add a regression test asserting that installing a new generation while a
    Multiview session is live does not call `controller.selectSource`.
- **Regression risk:** **high** — this is the change most able to break playback. It
  must land behind the gate, with the H1–H4 tests written *first*.
- **Tests required:**
  - Player: generation install mid-playback → no reload, no URL change, no remount
    (extend `playerIdentity.test.tsx`).
  - Multiview: generation install → `selectSource` not called on any live pane.
  - Channels: generation install while scrolled deep → window position and focus preserved.
  - Event Details: generation install → no reset to "Finding the best streams…", focus stays put.
  - Library: no overlapping refreshes; failure keeps the previous generation; backoff advances.

### P1-4 · Synchronous parse + merge (501 ms)

- **Files:** `src/features/channels/mergeChannels.ts` (447 ms — 89 % of the cost),
  `src/data/m3u/parseM3u.ts` (53 ms), `src/data/playlists/connectPlaylist.ts`
- **Root cause:** `mergeChannelSources` does `normalizeChannelName` + `parseCategory`
  per entry and allocates two `Set`s and three arrays per group, all in one loop.
- **Intended fix:** **move it into a Worker.** This is safe to recommend because the
  app **already ships one**: `createChannelIdentityWorker()` uses
  `new Worker(new URL('./channelIdentityWorker.ts', import.meta.url), { type: 'module' })`
  and the chunk is present in the Tizen build output
  (`dist/assets/channelIdentityWorker-DTwJsa1Z.js`, confirmed this session). Copy that
  module's `WorkerFactory` injection pattern so the merge stays unit-testable in Node
  without a real Worker, and so a construction failure degrades to the current
  synchronous path rather than crashing.
  - Fallback if the Worker route is rejected: chunk the merge loop with
    `yieldToMainThread()`, exactly as `warmChannelIndexAsync` does.
  - `RawChannel[]` and `Channel[]` are plain data, so structured-clone cost is the main
    thing to measure before committing (the 5.2 MB text / 30 k objects is not trivial).
- **Regression risk:** *medium.* Merge semantics are subtle (the plural-`sport` fold,
  the country|category|name merge key) and are load-bearing for channel identity.
  Behaviour must be byte-identical.
- **Tests required:** `mergeChannels.test.ts` unchanged; add a Worker-vs-sync
  equivalence test over a synthetic 30 k playlist; `benchmark:channel-index` before/after.
  Hardware: D7.

### P1-5 · Artwork

- **Files:** `public/backgrounds/Match_hero/*.png` (10 files),
  `public/backgrounds/test_image.png`, `src/data/sports/competitionArtwork.ts`
  (paths only — no code change needed if extensions change, but the map's string
  literals must be updated together with the files, and
  `src/data/sports/publicAssets.test.ts` already asserts every `backgrounds/…` literal
  resolves to a real file, so it will catch a mismatch).
- **Root cause:** photographic, alpha-free banners shipped as PNG.
- **Intended fix:** convert to **JPEG** at quality ~82. Not WebP and **not AVIF** —
  Tizen WebKit support varies by year of TV and this is a beta targeting real hardware;
  JPEG is universally safe and captures nearly all of the win. Expect ~150–250 KB each
  (~8–10× reduction), taking the `.wgt` from 19 MB to roughly 2–3 MB. Keep 2172×724 —
  it is only ~1.13× the 1920 display width, which is reasonable.
- **Regression risk:** *low.* Verify no visible banding in the dark centre band where
  crests and team names sit; if there is, raise quality or use a slight gradient dither.
- **Tests required:** `publicAssets.test.ts` (must stay green), `competitionArtwork.test.ts`.
  Hardware: D5 — measure Event Details open latency before/after on the TV.

---

## Baseline test results

Run on this branch, clean tree, before any change. **All green — treat any failure in
Session 2 as a regression you introduced.**

| Command | Result |
|---|---|
| `npm test` | ✅ **106 files, 1565 tests, all passed** — 9.40 s |
| `npm run lint` | ✅ **0 errors, 2 warnings** (both pre-existing — see below) |
| `npm run build` | ✅ built in 402 ms |
| `npm run build:tizen` | ✅ `dist-tizen/ninety-tv.wgt`, 19 MB |
| `VITE_PERF_DIAGNOSTICS=1 npm run build:tizen` | ✅ succeeds; diagnostic block retained |
| `npm run benchmark:channel-index` | ✅ see below |

**Pre-existing lint warnings (baseline, not regressions):**
```
OnboardingStepper.tsx:21:14   react(only-export-components)
EventDetailsScreen.tsx:132:69 react-hooks(exhaustive-deps) — favoriteCountries, favoriteChannels
```
The second is **deliberate and documented** (L113-119: re-deriving on every favourite
toggle would reshuffle the list mid-navigation). Do not "fix" it.

**`benchmark:channel-index`, 30,925 channels:**
```
mergeChannelSources:        402.972 ms
ChannelIndex construction:   77.177 ms
per-lookup (µs): getEntry=0.019  getChannelsForCategory=0.094  getSiblings=1.299  search=600.389
O(1) proof — large/small lookup ratio at 15.5× the playlist size:
  getEntry 0.769×   getChannelsForCategory 1.490×
```

**Additional measurements taken during this audit** (throwaway scripts, deleted):
```
parseM3u (5.2 MB, 30,925 entries):                    53 ms
mergeChannelSources:                                 447 ms
  → total synchronous parse+merge:                   501 ms

Home local matching, 30,925-ch playlist, one main-thread task:
   3,100-channel PPV bucket · 30 events              177 ms
   7,750-channel PPV bucket · 30 events              417 ms
  15,475-channel PPV bucket · 30 events              861 ms
```

All figures are dev-Mac (Darwin 25.2.0, Node 24.15.0). **Assume 3–6× slower on the
target TV.**

---

## Physical Samsung validation requirements

Build with `VITE_PERF_DIAGNOSTICS=1 npm run build:tizen`, sign, install, then pull
`window.__ninetyPerf` via the Tizen remote debugger
(`copy(JSON.stringify(window.__ninetyPerf))`).

### Must be confirmed before Session 2 implementation

1. **D1 — Player OSD.** Open a channel, wait 6 s for auto-hide, press **OK once**.
   Record whether the app leaves playback. Repeat immediately at mount (press OK as
   soon as video starts). Also press Right once while hidden and record which toolbar
   button is focused when the OSD appears.
2. **P0-2 baseline photo.** Open a match with a top pick. Photograph, from ~3 m:
   (a) top pick focused, (b) after pressing Down, (c) after pressing Up back to the top
   pick. These are the before-shots for the fix.
3. **D2 — focus latency.** Hold Down through a long channel list and judge whether
   focus feedback trails the press.

### Must be measured before Session 3 implementation

4. **D3 — `home:local-match`.** Sit on Home for 5 minutes; read every `home:local-match`
   measure. Then repeat *while a stream plays* and check `longTasks` for correlated
   entries.
5. **D4 — real bucket size.** With the real provider playlist connected:
   `window.__ninetyExportChannels.filter(c => !c.hasEpgChannelId).length` (dev build) or
   read the index bucket directly. This selects the row of the §3 table that applies.
6. **D7 — real parse+merge.** Connect the real playlist and read
   `playlist:hydrate` and the `mergeChannels:start` marks.
7. **D6 — long-task support.** Confirm `__ninetyPerf.longTasks` is non-empty at some
   point. If it stays empty through a known-heavy operation, the observer is
   unsupported on this WebKit and manual marks are the only signal available.

### Must be re-validated after Session 3

8. **Playback isolation, on hardware.** Start a stream, force a playlist resync from
   Settings on a second device/window if possible — or trigger the new scheduler with a
   shortened interval — and confirm: no video interruption, no audio glitch, no focus
   move, no quality change. Repeat with 4-pane Multiview.
9. **Channels deep-scroll survival.** Scroll to ~row 4,000 in a large category, trigger
   a refresh, confirm position and focus are preserved.
10. **Event Details survival.** Sit on a match's stream list at row 5, trigger a
    refresh, confirm no "Finding the best streams…" flash and no focus jump.
11. **D5 — artwork.** Time Event Details open for a competition with a hero, before and
    after JPEG conversion.

---

## Notes for the next session

- The comments in this codebase are unusually good and mostly accurate, but they
  describe *intent*. Two places where intent and current behaviour diverge, both found
  this session: the Player's pre-focus comment explains why focus is parked on a hidden
  toolbar without noting that this makes the toolbar activatable; and Event Details'
  focus comment correctly claims logical focus is fixed, which is true and is not the
  bug users are reporting.
- `TIZEN-PLAN.md` (120 KB) and `NINETY_DATA_QUALITY_EPG_BLUEPRINT.md` (67 KB) were not
  read in full this session. If Session 3 touches the Tizen packaging or the EPG
  resolver contract, read the relevant sections first.
- Do not remove: `ChannelIndex`, `warmChannelIndexAsync`, `VirtualChannelList`'s
  overscan/window-shift logic, the frozen favourites-first list order, the preview
  debounce split (100 ms media / 250 ms EPG), `preloadPlayerEngine`, or
  `usePlayerSession`'s empty-dep memoisation. Each of them is load-bearing and several
  are the fix for a previously-reported physical-TV bug.
