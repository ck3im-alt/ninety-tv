# Ninety TV — Controller Navigation & Focus Hardening

**Date:** 2026-08-27
**Branch:** `fix/ci-node-version` (base `b91f404`)
**Input:** [TV_HARDENING_AUDIT.md](TV_HARDENING_AUDIT.md)
**Scope:** controller navigation, focus visibility, focus determinism, Player OSD input.
No playlist-scheduler / performance work was started — that remains Session 3.

Everything below was verified against the current source before it was changed. Where the
audit's conclusion turned out to be incomplete, that is called out explicitly and
`TV_HARDENING_AUDIT.md` has been annotated.

---

## Root causes fixed

### 1. P0 — The Player could exit playback from an invisible OK press

**Confirmed in the current source, exactly as the audit described.**

`.player-overlay` is hidden with `opacity: 0` and `pointer-events: none`. It stays
mounted and laid out (it has to — it fades back in), and `pointer-events` is a *mouse*
concept: a D-pad has no pointer. So all seven toolbar buttons kept full spatial-nav
registration while invisible. Focus was deliberately parked there — at mount, and again
by `hideMenu()` after every 6-second idle timeout — and norigin's `keydown` listener is
bound inside `init()` in `main.tsx`, i.e. *before* `createRoot().render()`, so it runs
ahead of the screen's own "any key reveals the OSD" listener. One OK press therefore both
revealed the OSD **and** fired the focused button, which norigin's origin-closest child
resolution made `Channel List` → `onBack()`.

The dominant path was not mount but idle auto-hide, which happens several times during
every match. To a beta tester it reads as *"the app randomly quit playback."*

**Root cause, stated precisely:** an invisible container was allowed to hold actionable
spatial focus, and the reveal listener could not defend against it because it runs
*after* the library that activates the button.

**Fix — an explicit model, not an event-ordering trick:**

| OSD state | What holds focus | What OK does |
|---|---|---|
| hidden | the toolbar **container** (`player-toolbar`) — a real, mounted, non-actionable anchor | nothing; the window listener reveals the OSD and that is all |
| revealing | — | the reveal happens in a later task than the keypress, so one press can never both reveal and activate |
| visible | a real, visible button — the last one the viewer used, else Play/Pause | exactly what it always did |

Implemented as:

1. `focusable={menuVisible}` on **every** `ToolbarButton`. This is the pattern `ChannelRow`
   already uses for its CSS-hidden star. It closes both paths at once: norigin's
   `getNextFocusKey` filters children by `focusable`, *and* its `onEnterPress` dispatch
   re-checks `component.focusable` before firing.
2. With no focusable children, `setFocus(TOOLBAR_FOCUS_KEY)` resolves to the container
   itself. A container has no `onEnterPress` — so the hidden state has a valid focus
   anchor (spatial nav still has something to navigate *from*) that cannot be activated.
3. One effect keyed on `menuVisible` owns focus placement in both directions. The
   duplicate `setFocus` inside `hideMenu()` was removed: it ran *before* React committed
   `menuVisible: false`, so it resolved to a still-focusable button only for the effect to
   re-anchor a moment later.
4. The reveal target is **named explicitly** (`revealTargetRef`), not left to
   `preferredChildFocusKey`. norigin silently falls back to "child closest to the origin"
   whenever a preferred key is not a participating focusable — and on this toolbar that
   child is `Channel List`. An existence check resets the ref to Play/Pause if the
   remembered target has unmounted (Multiview is conditional).
5. Play/Pause is the default landing target, never Channel List. Defence in depth: the
   worst case of any mis-ordered press is now "pause", not "quit".
6. Back is excluded from the reveal listener. It has its own complete meaning at every
   level of this screen, and treating it as a generic wake press made it do two
   contradictory things at once.

**One thing the audit missed:** norigin's `lastFocusedChildKey` lives on a module-level
singleton keyed by focus key, so it *outlives the component*. A second playback session
could inherit the previous session's last toolbar button instead of the deliberate
default. The toolbar now sets `saveLastFocusedChild: false` and keeps its own per-mount
memory. This surfaced as cross-test pollution before it could surface on hardware.

### 2. P0 — Match View: the recommendation was drowning the focus cue

**Confirmed, and confirmed as *not* a logical-focus bug.** `topPickFocusKey` is the
container's `preferredChildFocusKey` *and* an explicit `setFocus` on the `loading → ready`
transition; OK has always played the right stream. Initial focus was left alone.

`--accent` and `--border-focus` are the same value (`#76f04b`). `.stream-row.top-pick`
took `border-color: var(--accent)` plus a 24px accent glow **at rest**, so the top pick
was already wearing the app's focus border before the remote touched it. Focusing it added
a 1px accent ring, drawn immediately outside an already-accent border, under a glow
present in both states — not a perceivable change at 1920×1080 across a room. Focusing
row 2 went from a near-invisible blended border to full accent, which is exactly why
"press Down and it looks normal."

**Fix:** state the rank in words, tint the row quietly, and give focus both channels.

- `.stream-row.top-pick` → `--border-selected` (dimmed green) + a lighter tint. No accent
  border, no outer glow.
- New `TOP PICK` badge in `StreamRow`, beside the name. Deliberately **not** a
  `.stream-row-badge` and **not** inside `.stream-row-meta`: that group is the
  fixed-width alignment unit for the row's *metadata*, and a ranking claim is not
  metadata. It also survives the row being focused, which a colour cannot.
- `.stream-row.focused` → background **and** border **and** a 2px ring, so the edge
  survives against a top pick's tint.
- `.stream-row.top-pick.focused` restates the full focus treatment rather than inheriting
  it — `.top-pick`'s multi-layer `background` shorthand would otherwise win on source
  order.

### 3. Event Details' Back button was not a child of its own screen container

**Not in the audit — found while writing the regression test, which failed on a claim
the source comment made.**

`useFocusable({ focusKey: BACK_FOCUS_KEY })` was a bare call in `EventDetailsScreen`'s
body. Hooks run before JSX, so the ambient `FocusContext` there is still App's, not the
screen's own — Back registered as a **sibling** of `event-details-screen`, not a child of
it. That silently broke the container's documented fallback: while matches load the screen
has no other focusable children, so `setFocus('event-details-screen')` found *no children
at all* and resolved to the container itself, an element with no `onEnterPress`. During
the exact window where the viewer most needs to know the remote still works, focus was on
nothing and reaching the on-screen Back button depended on a geometric search across the
whole screen root. (The hardware Back key was always fine — that goes through
`backHandler`, not focus.)

Fixed by extracting `BackButton` into its own component rendered inside the provider.
`EventDetailsScreen.focus.test.tsx` now asserts the documented behaviour directly.

### 4. TopNav answered two questions with one signal

`.nav-item.active` and `.nav-item.focused` were both `color: var(--accent)` — plus a
`text-shadow: 0 0 0 var(--accent)` on focused, which has zero blur and zero offset and is
therefore literally invisible. On Home with focus on Home the two states were identical;
moving focus one tab across left **two** tabs looking exactly the same.

Fixed by splitting the vocabularies: active keeps the accent underline (a channel focus
never uses) and brightens its label to `--text-primary`; focused takes a surface + border
pill. The padding and the transparent border are permanent, so focusing a tab colours them
in rather than resizing the bar.

### 5. Focus was animated, so it trailed the remote

`--motion-duration: 200ms` (and 160ms in Event Details) was applied directly to the
properties that *carry* focus. Ten quick D-pad presses queued ten fades. Added
`--motion-focus: 0ms` and moved every focus-carrying transition onto it, leaving
layout/decorative motion on `--motion-duration` (BrowseCascade's deliberate `flex-basis`
column animation and the Player overlay's own fade are untouched).

Kept as a token rather than hard-coded `0s` so it can be nudged to ~60ms from one place if
it reads as harsh on the panel.

### 6. Home's card rail scrolled smoothly under focus

`.scroll-row` had `scroll-behavior: smooth`, and every card's focus effect calls
`scrollIntoView`. Holding Right queued a ~300ms animation per press, so the rail visibly
trailed the highlight. Removed. The chevron — a deliberate paged jump, where smooth motion
genuinely helps — already asks for it explicitly via `scrollBy({ behavior: 'smooth' })`
and is unaffected.

### 7. Six more surfaces where a non-focus state wore focus's clothes

Found by sweeping every `.focused` rule in the app against the new contract:

| Surface | Was | Now |
|---|---|---|
| `.league-pill.active` (Schedule) | `border-color: var(--accent)` — **the same collision as the top pick**; the selected league and the focused league were indistinguishable | `--border-selected` + elevated surface; focused takes surface + border |
| `.toolbar-btn.active` (Player) | focus border **and** focus surface, so an open Quality menu left two buttons looking focused | elevated surface + `--border-selected`, accent text |
| `.fav-btn.active` (channel preview) | accent border — a favorited-unfocused button read as *more* selected than a focused-unfavorited one | accent text only; the label already says "★ Favorited" |
| `.stream-row-favorite.focused` | accent text + a 70% surface tint, which a favorited-at-rest star half-matched | surface + inset accent outline, matching `.ch-row-favorite` |
| `.event-card.focused` (Home) | 1px border colour — the app's weakest cue, on its busiest surface | surface + border + 2px ring (it sits over hero artwork) |
| `.event-details-back.focused` | text colour only — and it is the *only* focusable while matches load | surface + border |
| `.option-row.focused`, `.filter-row.focused`, `.pane-menu-row.focused` | background only, down lists of identical rows | + inset 2px outline (no layout shift) |
| `.search-field.focused` | 1px → 1.5px border, nudging the input text half a pixel | 1.5px at rest, recolours + tints on focus |

Settings, onboarding and the Browse Cascade were **not** restyled — they are the reference
implementations and already satisfy the contract.

### 8. P2 cleanups taken while in the files

- `ROOT_FOCUS_KEY` → `SCREEN_FOCUS_KEY` in `SettingsScreen`, `ScheduleScreen`,
  `PlaylistSetupScreen`. The values were correct, but a local constant shadowing norigin's
  exported one meant `useFocusable({ focusKey: ROOT_FOCUS_KEY })` read as the library
  constant and meant the opposite.
- Back on a visible OSD no longer arms a pointless 6-second idle timer.
- Every Player toolbar control now has an explicit, stable focus key instead of norigin's
  mount-order `sn:focusable-item-N` (the conditional Multiview button silently shifted the
  keys of everything after it).
- The `loading → ready` `setFocus` race is now guarded: focus is claimed only from the
  loading fallback or from nothing, never from a row the user is already on.

---

## Files changed

**Focus contract / tokens**
- `src/core/designsystem/tokens.css` — `--motion-focus`, `--border-selected`, and the
  written six-state focus contract.

**Player (P0-A)**
- `src/features/player/ChannelPlayerScreen.tsx`
- `src/features/player/ChannelPlayerScreen.css`

**Event Details (P0-B + determinism)**
- `src/features/eventDetails/EventDetailsScreen.tsx`
- `src/features/eventDetails/EventDetailsScreen.css`
- `src/features/eventDetails/StreamRow.tsx`
- `src/features/eventDetails/StreamSections.tsx`
- `src/features/eventDetails/eventDetailsFocusKeys.ts` *(new)*

**TopNav**
- `src/features/navigation/TopNav.css`

**Other surfaces**
- `src/features/home/HomeScreen.css`
- `src/features/schedule/ScheduleScreen.css` / `.tsx`
- `src/features/channels/CategoryChannelsScreen.css`
- `src/features/channels/FilterPopup.css`
- `src/features/channels/SearchField.css`
- `src/features/multiview/MultiviewPane.css`
- `src/features/onboarding/onboardingShared.css`
- `src/features/onboarding/LeagueBrowser.css`
- `src/features/settings/SettingsScreen.css` / `.tsx`
- `src/features/setup/PlaylistSetupScreen.css` / `.tsx`

**Tests (new)**
- `src/features/player/ChannelPlayerScreen.osdFocus.test.tsx`
- `src/features/eventDetails/EventDetailsScreen.focus.test.tsx`
- `src/features/navigation/TopNav.test.tsx`

---

## Final focus-state rules

Written into `tokens.css` so it lives with the values it governs. Six states can be true of
one element at once; the ranking is absolute.

1. **FOCUSED** — where the remote is. Exactly one per screen. Must change **at least two**
   visual channels (e.g. background *and* border) so no other state can neutralise it, and
   must not shift layout (transparent border/ring at rest, coloured on focus).
   Vocabulary **A** = `surface-focus` + `border-focus`; vocabulary **B** = offset ring, for
   controls on artwork or on an accent fill. Transitioned with `--motion-focus`.
2. **ACTIVE / CURRENT** — the screen or item the app is presently on. Stays visible while
   focus is elsewhere; stays quieter than focus. Surface elevation, accent *text*, a rail
   or an underline. Never the focus border, never an accent ring.
3. **SELECTED / TOGGLED** — the user chose this. Surface elevation + `--border-selected`,
   plus an explicit mark where one fits.
4. **RECOMMENDED / TOP PICK** — Ninety's own ranking claim. Same budget as selected, plus a
   **worded badge**. Row order already carries most of it. This rule exists because it was
   broken.
5. **FAVORITED** — filled glyph + `--accent` as *text* colour only.
6. **DISABLED** — `--text-disabled`, and **not focusable**. Anything that cannot be acted
   on must be out of the spatial-nav tree, not merely dimmed — and so must anything
   invisible (`focusable: false` while a container is hidden).

`--accent` as a *border or ring* is reserved for focus. Nothing else may wear one at rest.

---

## Event Details changes

- **Initial focus unchanged** — still the top-ranked stream, still via `topPickFocusKey`,
  still fired once on the `loading → ready` transition. The reported symptom was visual.
- **Recommendation vs focus split** into independent signals (badge + tint vs surface +
  border + ring), so they can never re-merge without a test failing.
- **Back button moved into the screen's focus context** (see root cause 3).
- **Explicit focus keys**, in one place (`eventDetailsFocusKeys.ts`): screen root, Back,
  the candidate expander, and a derived `${rowKey}-favorite` for every star.
- **Explicit row ↔ favourite navigation**, mirroring `ChannelRow`. Despite the visual
  nesting, a row and its star are *siblings* in the focus tree (StreamRow introduces no
  `FocusContext`), so geometry alone could send Right from one row to a **different** row's
  star, or Left from a star past its own row. Both directions are now stated.
- **Up from the first row's star** goes to Back, the same place the row itself goes — the
  top edge behaves identically whichever column the viewer is in. Previously it fell
  through to a geometric search with nothing above it.
- **Ready-transition focus guard** — focus is claimed only from the loading fallback or
  from nothing, never from a row that still exists.
- Up/Down *within* the row list still uses geometry. That is unambiguous (one vertical
  run) and matches `ChannelRow`, the app's most-hardened list.

**Deliberately not done:** the match effect still keys on the `channels` array identity, so
a genuinely new playlist generation still resets this screen to "Finding the best
streams…". That is **H3** in the audit and belongs with the playlist scheduler that
creates the condition — fixing it here would mean adding a `playlistGenerationId` prop for
a code path nothing currently triggers. The score-tick and favourite-toggle paths, which
*are* live today, are both covered by tests.

---

## Player OSD changes

- Toolbar buttons are `focusable={menuVisible}` — nothing invisible is a spatial-nav target.
- The toolbar container is the hidden state's neutral, non-actionable focus anchor.
- One `menuVisible` effect owns focus placement in both directions.
- Reveal target is named explicitly and existence-checked; defaults to Play/Pause.
- `saveLastFocusedChild: false` + per-mount reveal memory, so a new session starts from the
  deliberate default rather than inheriting the last one's.
- Explicit stable focus keys for all seven controls.
- Back excluded from the reveal listener.
- Back hierarchy unchanged and now covered: **popup → close popup**, **visible OSD → hide
  OSD**, **hidden OSD → leave Player**.
- `.toolbar-btn.active` no longer wears the focus vocabulary; `.option-row.focused` gained
  a second channel.

The nastiest ordering case — the idle timer hiding an OSD that has a popup open, so the
popup's "restore my opener" cleanup fires against a button on its way to being
unfocusable — is covered by a test and lands on the neutral anchor.

---

## TopNav changes

- `active` = accent underline + brightened label. `focused` = surface + border pill.
- Padding and the transparent border are permanent — no layout shift, no neighbouring tab
  nudging sideways under a held D-pad.
- Focus transitions moved to `--motion-focus`.
- No behavioural change: `focusable: onSelect != null`, `downFocusKey` and the geometric
  Down-out-of-the-bar path are all as they were, and are now covered by tests.

---

## Other screen changes

- **Home** — `.event-card` upgraded to surface + border + ring; rail focus-follow made
  instant. Structure untouched (`home-screen` trackChildren root, `watch-now` `forceFocus`).
  Returning from a child screen still lands on the hero: deterministic and predictable, and
  not a defect — per-screen focus memory would be a feature, not a fix.
- **Schedule** — the `active`/`focused` pill collision fixed. Pill↔fixture navigation
  untouched.
- **Channels** — **no logic changed at all.** `ChannelIndex`, `VirtualChannelList`'s
  windowing and overscan, async index warming, the 100/250ms preview debounce split, the
  200ms search debounce, `pickFallbackAfterRemoval` and `ChannelRow`'s explicit favourite
  navigation are all exactly as they were. Only CSS (`fav-btn`, `SearchField`,
  `FilterPopup` rows) changed. The benchmark confirms no scan-per-keypress regression.
- **Modals** — audited, no changes needed. Every real overlay (Filter, both Player popups,
  Settings dialogs, playlist dialogs, Team Picker, Multiview Event Picker and Pane Menu,
  Admin) goes through `useModalFocusScope`, which captures the opener, moves focus in, is
  `isFocusBoundary`, owns Back via the LIFO stack, and restores the opener only if it still
  exists. I specifically checked for the one way containment could leak — an intermediate
  focusable container between a modal's root and its leaves, which would let
  `smartNavigate` recurse past the boundary — and **no modal has one**.
- **Settings / onboarding** — not restyled and not rewritten. Only the shadowed constant
  rename and the transition-timing token.

---

## Tests added

**29 new tests**, all behaviour-focused.

`ChannelPlayerScreen.osdFocus.test.tsx` (15)
- hidden OSD: buttons mounted but focus is on the non-actionable container
- **first OK with the OSD hidden does not call `onBack`; it only reveals**
- **first OK after the 6-second idle auto-hide does not call `onBack`**
- the direction of the waking press does not decide where focus lands
- reveal establishes visible focus on Play/Pause, with the `.focused` class rendered
- a later reveal returns to the control the viewer last used
- visible OSD + focused Channel List + OK **does** call `onBack` (the real path still works)
- visible OSD + OK on Play/Pause toggles playback
- popup: focus moves in, Back closes it, opener restored
- idle-hide with a popup open re-anchors safely and the next OK is inert
- subtitles popup scopes focus and hands it back
- 10 rapid OK presses from hidden never reach `onBack`
- the OSD stays up while the viewer keeps pressing
- Back hierarchy: hidden → leave Player (without flashing the OSD); visible → hide OSD and
  re-anchor

`EventDetailsScreen.focus.test.tsx` (12)
- Back is the only target while matches load *(this failed before the Back-button fix)*
- ready → focus moves to the top-ranked stream, which is also the top pick
- first OK plays the top-ranked stream's best variant
- focus is not stolen back if the user already moved
- the recommendation is stated in words, on the top pick and nowhere else
- **top-pick and focused are two independent signals** — moving focus to row 2 leaves
  exactly one of each, on different rows
- Right from a row lands on *that* row's star; Left returns to *that* row
- Up from the first row and from its star both reach Back
- a score tick (new event object, same id) does not re-match, re-render the list, or move
  focus
- a favourite toggle does not reorder the list but does update the star
- the focused row disappearing lands focus somewhere deterministic and actionable

`TopNav.test.tsx` (6)
- active marks the current screen without claiming focus, with exactly one underline
- active and focused on separate tabs stay distinguishable (one of each, ever)
- both states coexist legibly on one tab
- every wired tab and the avatar are reachable targets
- unwired tabs are excluded from the focus tree (asserted through norigin's own
  `focusable`-filtered container resolution)
- Down out of the bar honours `downFocusKey`

One piece of test hygiene worth knowing about: norigin's service is a module-level
singleton and `cleanup()` does not reset the key it considers focused. Its
`focusOnPresetKey` option (**on by default**) then re-focuses any component that mounts
with that exact key. Each new test file parks focus on a neutral key in `beforeEach`.
Without it, a test ending on `player-channel-list` handed the next test a pre-focused
Channel List button — which is also what surfaced the cross-mount `lastFocusedChildKey`
issue in root cause 1.

---

## Test / build results

| Command | Baseline (audit) | Now |
|---|---|---|
| `npm test` | ✅ 106 files, 1565 tests | ✅ **109 files, 1598 tests, all passed** (9.4 s) |
| `npm run lint` | ✅ 0 errors, 2 warnings | ✅ **0 errors, the same 2 pre-existing warnings** |
| `npm run build` | ✅ 402 ms | ✅ 378 ms |
| `npm run build:tizen` | ✅ `ninety-tv.wgt` | ✅ `ninety-tv.wgt` |
| `VITE_PERF_DIAGNOSTICS=1 npm run build:tizen` | ✅ | ✅ |
| `npm run benchmark:channel-index` | see audit | ✅ no regression |

Both lint warnings are pre-existing and deliberate. The `exhaustive-deps` one on
`EventDetailsScreen.tsx` is documented in the source: re-deriving the ranking on every
favourite toggle would reshuffle the list mid-navigation. There is now a test for exactly
that.

Benchmark, 30,925 channels: `mergeChannelSources` 397.6 ms, `ChannelIndex` construction
83.0 ms, `getEntry` 0.030 µs, `getChannelsForCategory` 0.108 µs. The O(1) proof holds
(1.57× / 1.63× at 15.5× the playlist size). Nothing in this session touched that path — the
figures are within run-to-run variance of the audit's.

---

## Remaining device-only concerns

Nothing here was validated on a physical Samsung TV. **jsdom has no layout — every
`getBoundingClientRect` returns 0×0 — so no geometric navigation claim in this report is
proven on hardware.** The tests above deliberately assert only explicit, non-geometric
relationships for that reason.

| # | Concern | Why it needs the TV |
|---|---|---|
| R1 | That the Player fix holds on real geometry | The *hazard* is proven and closed in jsdom, and the fix does not depend on layout (it removes focusables rather than relying on where they sit). But D1 from the audit — where norigin's origin-closest resolution actually lands — was the precondition, and only hardware settles it. **Re-run D1: play a channel, wait 6 s, press OK once.** |
| R2 | Whether `--motion-focus: 0ms` reads as *harsh* rather than *immediate* | A judgement call that has to be made looking at the panel (audit D2). One token, one place, tune to ~60 ms if needed. |
| R3 | Whether the new top-pick treatment still reads as a recommendation at 3 m | The badge is 11px. Photograph from ~3 m: top pick focused, row 2 focused, top pick unfocused. |
| R4 | The 2px focus rings on `box-shadow` | The audit flagged animated shadows as a possible TV repaint cost. These are no longer *animated* (0 ms), which should make them cheaper, not dearer — but confirm no flicker under a held D-pad. |
| R5 | Up/Down between stream rows, and between their stars | Still geometric by design. Verify the star column steps cleanly row-to-row. |
| R6 | TopNav pill padding at 1920×1080 | The bar gained horizontal padding per tab; confirm the three tabs plus logo and meta still sit comfortably. |
| R7 | Home rail focus-follow now that smooth scrolling is off | Confirm it snaps rather than jumps disorientingly when a card is half off-screen. |
| R8 | Everything in the audit's §Physical Samsung validation that this session did not address (D3–D7) | Unchanged — those belong to Session 3. |

---

## Exact Samsung remote validation checklist

Build with `VITE_PERF_DIAGNOSTICS=1 npm run build:tizen`, sign, install.

### A. Player OSD — the P0. Do this first.

1. Open any channel from Channels. As soon as video starts, **press OK once.**
   → OSD appears. Playback continues. You are **not** returned to the channel list.
2. Press OK again on the now-visible, focused **Pause** button. → playback pauses.
3. Press OK again (it now reads Play). → playback resumes.
4. Let the OSD auto-hide (6 s, no input). **Press OK once.**
   → OSD reappears, focus on Pause. **Still in the Player.** *This is the exact failure a
   beta tester would have hit repeatedly.*
5. Repeat step 4 five times in a row.
6. From a hidden OSD, press **Right** once. → OSD appears with **Pause** focused (not the
   second button, not Channel List).
7. Hold OK for ~2 s from a hidden OSD. → OSD appears; playback may toggle pause/play;
   you never leave the Player.
8. Move to **Mute**, wait 6 s for auto-hide, press OK. → OSD returns **on Mute**.
9. Open **Quality/Source**. → focus is on the currently playing choice. Press **Back**.
   → popup closes, OSD stays up, focus back on the Quality button.
10. Open **Quality/Source** and do nothing for 6 s. → popup and OSD both close. Press OK.
    → OSD returns; **you do not leave the Player**.
11. Open **Text**. If the stream has no subtitle tracks, the popup says so. Press Back.
    → popup closes, focus back on Text.
12. **Back** with the OSD visible → OSD hides, still playing.
    **Back** with the OSD hidden → leave the Player. It must **not** flash the OSD on the
    way out.
13. Add to **Multiview** from the toolbar, then repeat 1, 4 and 12 inside Multiview.

### B. Match View

14. Open a match with several streams. → the **top row is focused and obviously so**:
    lit background, bright green border, ring. Photograph from ~3 m.
15. The top row also shows a **TOP PICK** badge. Press **Down**. → the badge stays on row 1,
    the focus treatment moves to row 2. Both are unmistakable and different.
16. Press **Up** back to row 1. → focus returns; it looks the same as in 14.
17. From row 1, press **Up** again. → the **Back** button, which is now clearly focused
    (lit box, not just green text).
18. From any row, press **Right**. → **that row's** star, not a neighbour's. Press **Left**
    → back to the same row. Repeat on the first, a middle, and the last row.
19. From the first row's star, press **Up**. → Back.
20. Press OK on the top row. → the correct stream plays, best quality first.
21. Open a match while on a slow connection so "Finding the best streams…" is visible for a
    moment. → **Back is focused and visibly so** throughout. Press OK on it → you leave.
22. Sit on a live match at row 3 for 2 minutes (scores tick every ~60 s). → no flash back
    to "Finding the best streams…", focus does not move.
23. Toggle a favourite star on row 3. → the star fills; **the list does not reorder**.
24. Expand "N more channels that might have it". → focus lands on the first candidate row.
25. Scroll to the last candidate row and press Down. → nothing jumps; focus stays.

### C. TopNav

26. On Home, look at the bar. → **Home** has the underline; whichever tab the remote is on
    has the pill. If they are the same tab, both are visible at once.
27. Press Right/Left along the whole bar and past both ends. → the pill follows every
    press with no lag; at each end nothing moves and focus is not lost.
28. Reach the **avatar**. → its offset ring is obvious against the hero artwork.
29. Press **Down** from each tab and from the avatar. → focus enters the page below.
30. Press **Up** from the top row of the page. → back into the bar, and the page scrolls to
    show it.
31. Enter Channels, then Back to Home. → the bar reads correctly for the screen you are on.
32. Open **Settings** from the avatar, press Back. → focus returns to the avatar.

### D. Focus responsiveness

33. Hold **Down** through a long channel list for ~3 s and release. → the highlight is on
    the row the list settled on the instant it settles; no queue of fades finishing after
    you stopped. If it reads *harsh* rather than *immediate*, raise `--motion-focus` to
    60 ms (`tokens.css`, one place).
34. Press Right ten times quickly along Home's Live Now rail. → the rail keeps up; the
    highlight never trails off-screen. Then press the row's **chevron** — that jump should
    still be smooth.
35. Same test on Match View's stream list and on the Schedule fixture list.

### E. Regression sweep (nothing here was meant to change)

36. **Channels:** country → category → channel → preview. Favourite a channel from the row
    star and from the preview pane. Search. Filter. Recently Watched. Favorites. Scroll deep
    into a large category and check the virtualization boundary in both directions. Unfavourite
    the focused row in Favorites → focus lands somewhere sensible.
37. **Schedule:** move along the league pills — the **selected** pill and the **focused**
    pill must now look different. Down into the fixtures, Up back to the pills.
38. **Settings:** rail ↔ pane, every dialog opens with focus inside it, Back closes it and
    restores the opener.
39. **Onboarding:** run a fresh install through all three steps. Uneven-grid row navigation
    and the true-edge blocking must be exactly as before.
40. **Multiview:** 4 panes, pane menu, event picker.

---

## Changes to the audit

`TV_HARDENING_AUDIT.md` has been annotated in two places where implementation proved a
conclusion incomplete:

1. §Confirmed 2 — Event Details' Back button was **not** a child of the screen container,
   so the "Back is the only resolvable target while matches load" claim was false. Noted.
2. §Focus/navigation architecture — a seventh contract rule was needed
   (`saveLastFocusedChild` is module-global and outlives the component), and the
   `.stream-row.top-pick` collision is not unique: `.league-pill.active`,
   `.toolbar-btn.active` and `.fav-btn.active` had the same shape. Noted.

Everything else in the audit held up exactly as written.

---

## Not started (Session 3)

Untouched, deliberately: Home's 60 s local-matching cost (P1-1), the playlist refresh
scheduler and its active-playback gate (P1-2/P1-3, incl. hazards H1–H4), the 501 ms
synchronous parse+merge (P1-4), and the 19 MB of PNG artwork (P1-5). Home's refresh cadence
is unchanged, no background playlist sync was added, and no Worker or chunking was
introduced.
