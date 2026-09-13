# Ninety Playback and Channel-Routing Review

## Executive assessment

Ninety has a good separation between its TV interface, session/failover policy, and playback engines. The `Player` contract is small enough to support a future Samsung-native engine without rewriting the screens. Its HLS choice is also strong: hls.js remains a focused, actively maintained HLS engine with adaptive bitrate, live-edge control, gap handling, track selection, and explicit error recovery.

The main weakness was not the overall design. It was a set of edge cases at the boundaries between event resolution, merged playlist sources, URL classification, and failure recovery. Those cases explain why a URL could work in another IPTV client while Ninety showed black, or why a session could freeze without rotating to a working source.

The audit corrected those cases and now implements the hybrid player that the comparison identified: Samsung AVPlay for full-screen playback on Tizen, with the existing HTML/hls.js/mpegts.js path retained for browsers, Multiview, and same-source fallback. Samsung explicitly recommends AVPlay for adaptive streaming, additional subtitle formats, and 4K/UHD playback, and exposes native buffering, error, time, and track callbacks.^1

## Current architecture

```text
Event + broadcast evidence
        |
        v
Channel identity resolver ---> exact playlist Channel(s)
        |                              |
        |                       merged source URLs
        v                              |
Event stream grouping/ranking --------+
        |
        v
Player session controller
  - bounded recovery
  - mirror/quality failover
  - manual source selection
        |
        +--> Samsung AVPlay -> native full-screen pipeline (Tizen)
        |         |
        |         +-- rejected/stalled source --> same URL through HTML fallback
        |
        +--> hls.js --------> MediaSource + <video>
        +--> mpegts.js -----> transmux -> MediaSource + <video>
        +--> native --------> <video src>
```

This layering is worth keeping. Player replacement should happen behind the platform-neutral `Player` interface, not inside Event Details or the full-screen player UI.

## Correctness findings and completed changes

### Event-to-channel trust

The Ninety API has five event/broadcast classifications: `CONFIRMED`, `PROBABLE`, `AMBIGUOUS`, `UNKNOWN`, and `REJECTED`. The client previously ignored that classification and attempted every returned relation. As a result, a locally well-resolved playlist channel could become watchable even when the event-to-broadcast relation was ambiguous or explicitly contradicted.

The matching stage now accepts only `CONFIRMED` and `PROBABLE`. `AMBIGUOUS`, `UNKNOWN`, and `REJECTED` cannot route playback or make the UI claim that Ninety knows the broadcaster.

### EPG evidence was widened to unverified sibling sources

A merged `Channel` can contain URLs from multiple IPTV panels. The EPG fallback previously checked only the first queryable URL and, after a match, sent every sibling URL to playback. That crossed an important trust boundary: EPG proves a specific panel stream, not every URL sharing a normalized channel name.

The fallback now checks each Xtream source using that source's own credentials and retains only URLs whose own EPG contains the event. This directly prevents an EPG-proven event from opening an unverified sibling source.

### Black-screen URL misclassification

Raw MPEG-TS detection previously required the literal URL to end in `.ts`. Common URLs such as `channel.ts?token=...`, uppercase extensions, and extensionless Xtream `/live/user/password/123` URLs fell through to native HTML video. Chromium-based TVs generally cannot consume a continuous raw TS stream through plain `video.src`; mpegts.js must transmux it to fragmented MP4 for MediaSource.^2

Source classification now ignores query strings/fragments, handles case, and recognizes the extensionless Xtream live form.

### Infinite startup black screen

The player had no deadline while waiting for the first `playing` event. A source or engine that neither started nor emitted an error could remain black indefinitely.

Each load now has a 12-second startup deadline. If no playback begins, the session receives a network failure and can rotate to another candidate.

### Rebuffer freeze escaped stall detection

The video `waiting` event changed player state from `playing` to `loading`. The old watchdog only ran in `playing`/`paused`, so it disabled itself at the exact point a real rebuffer began.

Ninety now distinguishes initial loading from post-start rebuffering. Once a source has played, lack of media-time progress remains watched during `waiting`; seven seconds without meaningful progress produces a bounded stall recovery.

### MPEG-TS timestamp-gap failure

mpegts.js defaults `fixAudioTimestampGap` to `true`, filling silent audio frames when timestamps jump.^3 A large provider discontinuity can make that synchronous compensation pathological; the observed failure generated millions of silent frames and exhausted the JavaScript stack without a normal player error.

Ninety now disables that repair. The trade-off is deliberate: a brief audio discontinuity is preferable to a permanently frozen live stream. This setting should remain part of the physical-device test matrix because badly timestamped providers differ.

### HLS fatal recovery

hls.js documents `startLoad()` for fatal network recovery and `recoverMediaError()` for fatal media recovery.^4 Ninety previously forwarded the first fatal event directly to source failover.

The HLS engine now makes one bounded recovery attempt of the appropriate kind. A repeated fatal event is still surfaced to the session controller, which then tries another source. Late callbacks from a destroyed HLS or MPEG-TS instance are generation-guarded so an old source cannot fail a newer one.

### Long-session failover exhaustion

Failed source indexes accumulated for the whole screen lifetime. Three unrelated transient failures over a two-hour match could permanently exhaust three otherwise healthy mirrors.

After 30 seconds of real playback progress, old failure history is cleared. Manual source selection also starts a fresh bounded pass. Rapid failure loops remain bounded because a source must actually advance media time before earlier candidates become eligible again.

### Source ranking and duplication

An untagged source could inherit an `8K`/`UHD` label from a sibling source through channel-wide raw-name metadata. This could put the wrong URL first. Quality estimation now prefers source-owned metadata and does not borrow quality from a sibling when the source has its own original name.

Duplicate URLs inside one merged channel are also removed. Failover will not reopen the same dead URL under a different label.

### Dependency maintenance

mpegts.js was updated from 1.8.1 to 1.8.2. The patch repairs worker bundles that could be emptied during the project's webpack migration. Worker mode remains disabled pending Samsung-device validation; changing execution threads without testing Tizen's memory and MediaSource behaviour would be speculative.

### Samsung-native full-screen playback

Full-screen Tizen sessions now prefer a `createTizenAvPlayer()` implementation behind the existing `Player` contract. It follows AVPlay's `open` → listener registration → `prepareAsync` → `play` lifecycle, maps native buffering/time/completion callbacks into `PlayerState`, exposes native audio/subtitle tracks, maps seeking to AVPlay's live APIs, and releases the native decoder on every load and disposal.

Both prepare and first-frame waits have 12-second deadlines. A native runtime error or a post-start loss of time progress also moves the same URL to the HTML engine before the session controller considers another source. This distinction matters: AVPlay incompatibility is an engine failure, not evidence that a different provider/channel is needed. Once a session falls back, it remains on HTML to avoid running retained MSE and process-global AVPlay resources against each other.

Multiview deliberately remains on independent HTML/MSE players. Samsung's in-app native Multiview capability is firmware-dependent and needs a separate per-model decoder/resource validation before it can safely replace that path.

## Comparison with other player approaches

| Approach | Strengths | Limits for Ninety | Assessment |
|---|---|---|---|
| hls.js | Focused HLS engine; ABR; live-edge controls; mature error/gap handling; audio/subtitle renditions | HLS only; browser MediaSource and device codec limits still apply | Keep for browser HLS and fallback |
| mpegts.js | Direct continuous HTTP MPEG-TS support; low-latency design; transmuxes TS to fMP4; optional worker and jitter stash | More exposed to malformed timestamps; limited multi-audio path; MSE/JS CPU and memory cost | Necessary for raw Xtream TS in browsers, but harden and monitor |
| Shaka Player | Broad HLS/DASH/DRM feature set; configurable retry, buffering, ABR, and live modes^5 | Its MPEG-TS support is for media carried by HLS/manifest workflows, not a drop-in continuous Xtream TS replacement; larger migration with no clear benefit for current inputs | Good future choice if DASH/DRM becomes a product requirement, not a fix for today's raw TS issue |
| Video.js/VHS | Mature UI/plugin ecosystem and HLS/DASH playback | Ninety already owns a TV/D-pad UI; another UI framework adds weight without replacing the raw-TS engine | No migration benefit |
| Samsung AVPlay | Native Samsung pipeline; explicit buffering/error callbacks; track enumeration/switching; adaptive streaming; 4K/8K guidance^1,6 | Tizen-only; stateful lifecycle; display rectangle/object integration; model-specific testing; Multiview needs separate capability handling | Best next step for full-screen Tizen playback |

The current engine pair is therefore reasonable for a cross-platform web app. Replacing hls.js with Shaka or Video.js would not solve the continuous raw-TS path that dominates many Xtream playlists. The biggest quality jump on Samsung hardware is native AVPlay, not another browser library.

## Freezing: server or app?

Without the exact failing URLs and on-device diagnostics from the 16:00 Premier League window, the provider's contribution cannot be proven retrospectively. Concurrent popular matches often expose overloaded origin or restream capacity, and a single-bitrate raw TS source cannot adapt down the way a multi-variant HLS stream can.

There were nevertheless definite app-side amplifiers:

- A real rebuffer disabled Ninety's old watchdog.
- A stalled startup had no deadline.
- Certain valid TS URLs were sent to the wrong engine.
- A mpegts.js timestamp-gap path could fail silently.
- HLS fatal errors skipped the engine's own recovery API.
- Old transient failures permanently removed mirrors from the session.

Those defects explain why the same provider stream could appear more resilient in another IPTV application. The external app may use a native decoder, a larger jitter buffer, a reconnect policy, or an HLS variant rather than the same continuous TS delivery path.

## Recommended roadmap

### 1. Ship and validate the current hardening

Run a physical-device matrix on at least the oldest supported Tizen 6.5 television and one newer model:

- 30-minute HLS and raw TS sessions.
- A known timestamp-discontinuous source.
- Network interruption and restoration.
- Expiring/query-token TS URLs and extensionless Xtream URLs.
- Single-stream and four-pane Multiview.
- Provider congestion during a popular live event.

Success criteria should include time-to-first-frame, rebuffer count/duration, recovery outcome, memory after channel changes, A/V sync, and whether the selected logical channel stays stable.

### 2. Validate the new Samsung AVPlay adapter on physical TVs

The adapter is implemented and selected at runtime for full-screen sessions. Validate its state transitions, native display rectangle, subtitle rendering, audio switching, live seeking, mute behavior, same-source HTML fallback, and stop/close cleanup across the supported Tizen model range. Samsung's lifecycle and valid-state rules make physical-device coverage essential.^1

Keep the existing HTML/MSE implementation for Multiview until `IN_APP_MULTIVIEW` support is verified per target model.

### 3. Prefer adaptive manifests when providers expose them

If an Xtream account provides both raw `.ts` and `.m3u8`, prefer HLS for full-screen playback after a small compatibility probe or provider capability record. hls.js can change rendition when bandwidth drops; a raw single-bitrate TS stream cannot. Do not mechanically rewrite `.ts` to `.m3u8` because many panels do not enable that output.

### 4. Add privacy-safe playback telemetry

Record locally, without credentials or full URLs:

- engine and anonymized source identity;
- startup duration and outcome;
- error type/detail category;
- rebuffer start/end and duration;
- buffered seconds, `readyState`, and `networkState` at failure;
- automatic source switches and whether the replacement played for 30 seconds;
- current HLS bandwidth estimate/level when available.

This is the evidence needed to separate provider starvation, decoder failure, main-thread contention, and matching mistakes. A diagnostic export should be user-triggered and redact URL credentials/tokens.

### 5. Device-test worker and buffer settings

mpegts.js documents a jitter stash (enabled by default) and optional worker transmuxing.^3 Test, rather than guess, these variants:

- main-thread transmuxing versus `enableWorker`;
- default stash versus larger initial stash during congested sports streams;
- current timestamp-gap setting on clean and discontinuous feeds;
- memory and decoder pressure with one versus four players.

Samsung warns that TVs have limited decoder/buffer resources, recommends releasing media immediately, and advises conservative buffers for high-bitrate content.^7 Ninety already destroys engines and clears the video element on disposal, matching Samsung's prescribed release sequence; the next concern is the number and bitrate of simultaneous Multiview streams.

## Decision

Keep the existing abstraction and the hls.js/mpegts.js browser engines. The audited implementation is materially more resilient after the bounded recovery, source-specific matching, stall fixes, and Samsung-native full-screen path. AVPlay is now the preferred full-screen engine when the Samsung API is available; the next release gate is verification against real provider streams on physical supported TVs, with the same-source HTML fallback retained as the safety net.

## Sources

1. Samsung Developer. [Playback Using AVPlay](https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html). Accessed September 2026.
2. xqq. [mpegts.js project overview and design](https://github.com/xqq/mpegts.js). Accessed September 2026.
3. xqq. [mpegts.js API and configuration](https://github.com/xqq/mpegts.js/blob/master/docs/api.md). Accessed September 2026.
4. video-dev. [hls.js API: fatal error recovery](https://github.com/video-dev/hls.js/blob/master/docs/API.md). Accessed September 2026.
5. Shaka Player. [Configuration tutorial](https://github.com/shaka-project/shaka-player/blob/main/docs/tutorials/config.md). Accessed September 2026.
6. Samsung Developer. [4K/8K UHD Video](https://developer.samsung.com/smarttv/develop/guides/multimedia/4k-8k-uhd-video.html). Accessed September 2026.
7. Samsung Developer. [Web App (HTML5) Memory Optimization Guide](https://developer.samsung.com/smarttv/develop/guides/web-app-memory-optimization-guide.html). Accessed September 2026.
